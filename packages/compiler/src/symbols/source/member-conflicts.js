/**
 * Duplicate member diagnostics: CS0102 (same name), CS0111 (same signature) and CS0542 (member named
 * like its type).
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { SymbolKind } from '../types.js';
import { MethodKind, DeclarationModifiers } from '../members.js';

/** Class mixin: Duplicate member diagnostics: CS0102 (same name), CS0111 (same signature) and CS0542 (member named */
export const MemberConflicts = Base =>
  class extends Base {
    reportConflicts(type, members) {
      const names = new Map(),
        signatures = new Map();
      for (const m of members) {
        if (m.isImplicitlyDeclared && !m.isPositional) continue;
        const uri = m.uri ?? m.locations[0]?.uri,
          at = m.locations[0];
        if (!at) continue;
        if (
          (m.name === type.name && m.kind !== SymbolKind.Method) ||
          (m.kind === SymbolKind.Method && m.methodKind === MethodKind.Ordinary && m.name === type.name)
        )
          this.report(uri, at, DiagnosticId.CS0542, [m.name]);
        if (m.kind === SymbolKind.Method) {
          if (
            m.methodKind !== MethodKind.Ordinary &&
            !m.isConstructor &&
            m.methodKind !== MethodKind.UserDefinedOperator &&
            m.methodKind !== MethodKind.Conversion
          )
            continue;
          const key = m.signatureKey + (m.methodKind === MethodKind.Conversion ? '->' + m.returnTypeWithAnnotations.toDisplayString() : '');
          if (signatures.has(key)) {
            if (!(m.modifiers & DeclarationModifiers.Partial && signatures.get(key).modifiers & DeclarationModifiers.Partial))
              this.report(uri, at, DiagnosticId.CS0111, [m.isConstructor ? type.name : m.name, type.toDisplayString()]);
          } else signatures.set(key, m);
          if (names.has(m.name) && names.get(m.name).kind !== SymbolKind.Method)
            this.report(uri, at, DiagnosticId.CS0102, [type.toDisplayString(), m.name]);
          if (!names.has(m.name)) names.set(m.name, m);
          continue;
        }
        if (m.kind === SymbolKind.Property && m.isIndexer) continue;
        if (names.has(m.name)) this.report(uri, at, DiagnosticId.CS0102, [type.toDisplayString(), m.name]);
        else names.set(m.name, m);
      }
      for (const nested of type._nested) {
        if (names.has(nested.name) && !nested.isDuplicate)
          this.report(nested.locations[0].uri, nested.locations[0], DiagnosticId.CS0102, [type.toDisplayString(), nested.name]);
      }
    }
  };
