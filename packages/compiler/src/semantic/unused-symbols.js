/**
 * Unused-symbol warnings: CS0168 and CS0219 (locals), CS8321 (local functions), CS0164 (labels),
 * CS0169, CS0414 and CS0649 (fields).
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind, Accessibility, RefKind } from '../symbols/types.js';
import { effectiveAccessibility } from '../binder/inheritance.js';
import { accessRank, defaultText } from './analysis-helpers.js';

/** Class mixin: Unused-symbol warnings: CS0168 and CS0219 (locals), CS8321 (local functions), CS0164 (labels), */
export const UnusedSymbolWarnings = Base =>
  class extends Base {
    /** CS0168 / CS0219 (locals), CS8321 (local functions), CS0164 (labels), CS0169 / CS0414 / CS0649 (private fields). */
    reportUnused() {
      for (const body of this.bound.values()) {
        const binder = body.binder;
        if (!binder || binder.c.parent) continue;
        for (const local of binder.allLocals ?? []) {
          if (
            local.reads ||
            local.isPatternLocal ||
            local.isForEach ||
            local.isUsing ||
            local.name === '_'
          )
            continue;
          // A use before the declaration (CS0841) was not bound to the local: `true` when every such use assigned it.
          const earlyUse = binder.usedBeforeDeclaration?.get(local.name);
          if (earlyUse === false) continue;
          const at = local.locations[0];
          if (!at) continue;
          // A local whose type is an error has no value to speak of: Roslyn reports only the type error.
          const hasValue = !local.type?.isErrorType?.();
          if (earlyUse) {
            if (hasValue) this.report(binder.c.uri, at, DiagnosticId.CS0219, [local.name]);
          } else if (!local.writes || local.isCatch) this.report(binder.c.uri, at, DiagnosticId.CS0168, [local.name]);
          else if (!local.nonConstantWrite && !local.isOutVar && hasValue) this.report(binder.c.uri, at, DiagnosticId.CS0219, [local.name]);
        }
        for (const f of binder.allLocalFunctions ?? [])
          if (!f.method.uses) this.report(f.uri, f.method.locations[0], DiagnosticId.CS8321, [f.method.name]);
        for (const l of binder.allLabels ?? []) if (!l.label.uses) this.report(l.uri, l.node, DiagnosticId.CS0164);
      }
      // Roslyn reports unused-field warnings only for a compilation without errors.
      if (this.incomplete) return;
      for (const type of this.assembly.types) {
        // Interfaces have fields too: static ones from C# 8, and instance ones that are an error but still declared.
        if (type.typeKind !== TypeKind.Class && type.typeKind !== TypeKind.Struct && type.typeKind !== TypeKind.Interface) continue;
        for (const f of type.getMembers()) {
          if (f.kind !== SymbolKind.Field || f.isConst || f.isImplicitlyDeclared || !f.type || f.type.isErrorType()) continue;
          const rank = Math.min(effectiveAccessibility(type), accessRank(f.declaredAccessibility)),
            isPrivate = f.declaredAccessibility === Accessibility.Private,
            isInternal = !isPrivate && rank <= accessRank(Accessibility.Internal);
          if (!isPrivate && !isInternal) continue;
          // A ref field has no default value to warn about: what it refers to is decided where the struct is created.
          const isRefField = (!!f.refKind && f.refKind !== RefKind.None) || f.typeSyntax?.kind === 'RefType',
            neverAssigned = !isRefField && !f.isRequired;
          if (!f.reads && !f.writes) {
            if (isPrivate) this.reportAt(f, DiagnosticId.CS0169, [f.toDisplayString()]);
            else if (neverAssigned) this.reportAt(f, DiagnosticId.CS0649, [f.toDisplayString(), defaultText(f.type)]);
          } else if (!f.writes && neverAssigned) this.reportAt(f, DiagnosticId.CS0649, [f.toDisplayString(), defaultText(f.type)]);
          else if (!f.reads && isPrivate && !f.nonConstantWrite) this.reportAt(f, DiagnosticId.CS0414, [f.toDisplayString()]);
        }
      }
    }
  };
