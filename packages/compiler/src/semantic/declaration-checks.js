/**
 * Declaration-level checks of every source type: hiding, overrides, abstract members, interface
 * implementation, struct layout, readonly and ref struct rules, variance, accessibility consistency and constraints.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind, Accessibility } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { inheritConstraints } from '../symbols/source/type-parameters.js';
import { checkHiding, effectiveAccessibility, isAtLeastAsAccessible } from '../binder/inheritance.js';
import { bindOverrides, checkAbstractImplementation, checkModifiers } from '../binder/overrides.js';
import { bindInterfaceImplementations, nonPublicImplicitImplementations } from '../binder/interface-impl.js';
import { checkConstructedType } from '../binder/constraints.js';
import { bindEnumMembers } from '../binder/enums.js';
import { checkStructLayout, checkStructDeclaration } from '../binder/structs.js';
import { checkReadOnlyDeclarations } from '../binder/readonly.js';
import { checkInterfaceMemberKinds } from '../binder/interface-members.js';
import { checkRefStructDeclarations, checkAsyncOrIteratorUse } from '../binder/ref-struct.js';
import { checkTypeModifierFeatures } from './type-modifier-features.js';
import { checkVarianceSafety } from '../conversions/variance.js';
import { checkNullableSignatures } from '../nullable/signature-checks.js';
import { uninitializedMembersWithoutConstructor } from '../nullable/uninitialized-members.js';
import { checkTypeModifiers, signatureNameOf } from '../binder/type-modifiers.js';
import { nullabilityViolations, declarationNameOf } from '../nullable/constraint-checks.js';
import { accessRank, baseOrSelf } from './analysis-helpers.js';

/** Class mixin: Declaration-level checks of every source type: hiding, overrides, abstract members, interface */
export const DeclarationChecks = Base =>
  class extends Base {
    bindExplicitInterfaces(type) {
      for (const m of type.getMembers()) {
        if (!m.explicitInterfaceSyntax || m.explicitInterfaceType !== undefined) continue;
        m.explicitInterfaceType = this.typeBinder.bindType(m.explicitInterfaceSyntax, m.scope ?? type.primaryScope).type;
        for (const a of [m.getMethod, m.setMethod]) if (a) a.explicitInterfaceType = m.explicitInterfaceType;
      }
    }
    checkType(type) {
      const core = this.core,
        version = this.versionOf(type.locations[0].uri).number;
      for (const d of checkTypeModifiers(type)) this.report(d.uri, d.node, d.code, d.args);
      if (type.typeKind === TypeKind.Enum) {
        bindEnumMembers(
          type,
          core,
          (syntax, scope, field) => this.evaluateConstant(syntax, scope, type, null),
          (uri, node, code, args) => this.report(uri, node, code, args),
        );
        return;
      }
      for (const d of checkHiding(type, core)) this.reportAt(d.member, d.code, d.args);
      for (const d of bindOverrides(type, core, this.conversions)) {
        this.reportAt(d.member, d.code, d.args);
      }
      for (const m of type.getMembers()) {
        if (m.hasCovariantReturn) this.gate(this.at(m).uri, this.at(m), 'covariantReturns', { name: 'covariant returns', version: 9 });
        // An override or explicit implementation takes its constraints from the member it overrides.
        if (m.inheritsConstraints && m.kind === SymbolKind.Method) {
          const base = m.overriddenMethod ?? null;
          if (base)
            inheritConstraints([...m.typeParameters], [...base.typeParameters], t =>
              t.typeKind === TypeKind.TypeParameter && base.typeParameters.includes(t)
                ? m.typeParameters[base.typeParameters.indexOf(t)]
                : t,
            );
        }
        for (const d of checkModifiers(m, type)) this.reportAt(m, d.code, d.args);
        this.checkMemberAccessibility(m, type);
        if (
          m.kind === SymbolKind.Method &&
          type.typeKind === TypeKind.Interface &&
          m.hasBody &&
          !m.isStatic &&
          m.methodKind === MethodKind.Ordinary
        )
          this.gate(this.at(m).uri, this.at(m), 'defaultInterfaceImplementation', { name: 'default interface implementation', version: 8 });
        if (type.typeKind === TypeKind.Interface && m.isStatic && (m.isAbstract || (m.modifierWords ?? []).includes('virtual')))
          this.gate(this.at(m).uri, this.at(m), 'staticAbstractMembers', { name: 'static abstract members in interfaces', version: 11 });
        if (m.kind === SymbolKind.Method)
          for (const p of m.parameters) {
            const bad =
              p.type && !p.type.isErrorType()
                ? checkAsyncOrIteratorUse(p.type, 'parameter', { isAsync: m.isAsync, isIterator: false }, version)
                : null;
            if (bad) this.reportAt(p, bad.code, bad.args);
          }
      }
      for (const d of checkAbstractImplementation(type, core)) this.reportAt(type, d.code, d.args);
      const impl = bindInterfaceImplementations(type, core);
      type.interfaceImplementations = impl.map;
      for (const d of impl.diagnostics) {
        if (d.interface) {
          const listed = [...(type.interfaceSyntax ?? [])].find(([i]) => i.equals(d.interface) || baseOrSelf(i, d.interface, core));
          if (listed) this.report(listed[1].uri, listed[1].syntax, d.code, d.args);
          else this.reportAt(type, d.code, d.args);
        } else if (d.onInterfaceName && d.member.explicitInterfaceSyntax)
          this.report(this.at(d.member).uri, d.member.explicitInterfaceSyntax, d.code, d.args);
        else this.reportAt(d.member, d.code, d.args);
      }
      if (version < 10)
        for (const d of nonPublicImplicitImplementations(type, impl.map)) {
          // The getter of an expression-bodied property is the expression itself.
          const property = d.implementation.associatedSymbol,
            at = d.implementation.locations?.[0] ?? property?.syntax?.expressionBody?.expression ?? this.at(property ?? type),
            args = [...d.args, Number.isInteger(version) ? version + '.0' : String(version), '10.0'];
          this.report(this.at(property ?? d.implementation).uri, at, DiagnosticId.CS8704, args);
        }
      for (const d of checkStructLayout(type)) this.reportAt(d.field, d.code, d.args);
      for (const d of checkStructDeclaration(type, version)) {
        if (d.feature) this.gate(this.at(d.member).uri, this.at(d.member), d.feature.name, d.feature);
        else this.reportAt(d.member, d.code, d.args);
      }
      for (const d of checkReadOnlyDeclarations(type)) this.reportAt(d.member, d.code, d.args);
      for (const d of checkInterfaceMemberKinds(type)) this.reportAt(d.member, d.code, d.args);
      for (const d of checkRefStructDeclarations(type, version)) {
        if (d.feature) {
          // Roslyn names the first interface of the base list for the ref struct interfaces gate.
          const base = d.onInterfaces ? type.declarations.find(part => part.syntax.baseList)?.syntax.baseList.types[0] : null;
          this.gate(this.at(type).uri, base ? (base.type ?? base) : this.at(type), d.feature.name, d.feature);
        }
        else if (d.onType && d.member.typeSyntax) this.report(this.at(d.member).uri, d.member.typeSyntax, d.code, d.args);
        else this.reportAt(d.member, d.code, d.args);
      }
      if (type.typeKind === TypeKind.Interface || type.typeKind === TypeKind.Delegate)
        for (const d of checkVarianceSafety(type, { staticMembers: version < 9 })) {
          const target =
            d.where && typeof d.where === 'object' && d.where.syntax?.type
              ? { uri: this.at(d.where).uri, node: d.where.syntax.type }
              : d.where === 'return' && d.member.returnTypeSyntax
                ? { uri: d.member.uri ?? this.at(d.member).uri, node: d.member.returnTypeSyntax }
                : d.where === 'type' && d.member.typeSyntax
                  ? { uri: this.at(d.member).uri, node: d.member.typeSyntax }
                  : null;
          if (target) this.report(target.uri, target.node, d.code, d.args);
          else this.reportAt(d.member, d.code, d.args);
        }
      checkTypeModifierFeatures(type, this.gate);
      // Nullable reference type signature agreement between overrides/implementations and their bases.
      if (this.nullableAt(this.at(type).uri, this.at(type).start).warnings)
        for (const d of checkNullableSignatures(type)) {
          if (d.node) this.report(this.at(type).uri, d.node, d.code, d.args, 'warning');
          else this.reportAt(d.member, d.code, d.args, 'warning');
        }
      for (const d of uninitializedMembersWithoutConstructor(type))
        if (this.nullableAt(this.at(d.member).uri, this.at(d.member).start).warnings) this.reportAt(d.member, d.code, d.args, 'warning');
    }
    /** CS0050-CS0059: a member may not expose a type less accessible than itself. */
    checkMemberAccessibility(m, type) {
      if (m.isImplicitlyDeclared || m.explicitInterfaceSyntax) return;
      const rank = Math.min(effectiveAccessibility(type), accessRank(m.declaredAccessibility));
      if (rank <= accessRank(Accessibility.Private)) return;
      const check = (t, code, args) => {
        if (t && !t.isErrorType?.() && !isAtLeastAsAccessible(t, rank)) this.reportAt(m, code, args(t));
      };
      const display = m.toDisplayString();
      if (m.kind === SymbolKind.Field) check(m.type, DiagnosticId.CS0052, t => [display, t.toDisplayString()]);
      else if (m.kind === SymbolKind.Property) {
        check(m.type, m.isIndexer ? DiagnosticId.CS0054 : DiagnosticId.CS0053, t => [display, t.toDisplayString()]);
        for (const p of m.parameters) check(p.type, DiagnosticId.CS0055, t => [display, t.toDisplayString()]);
      } else if (m.kind === SymbolKind.Event) check(m.type, DiagnosticId.CS7025, t => [display, t.toDisplayString()]);
      else if (m.kind === SymbolKind.Method && !m.isAccessor) {
        if (!m.isConstructor && m.methodKind !== MethodKind.Destructor)
          check(
            m.returnType,
            m.methodKind === MethodKind.UserDefinedOperator || m.methodKind === MethodKind.Conversion ? DiagnosticId.CS0056 : DiagnosticId.CS0050,
            t => [display, t.toDisplayString()],
          );
        for (const p of m.parameters)
          check(
            p.type,
            m.methodKind === MethodKind.UserDefinedOperator || m.methodKind === MethodKind.Conversion ? DiagnosticId.CS0057 : DiagnosticId.CS0051,
            t => [display, t.toDisplayString()],
          );
      }
    }
    /** CS8714, CS8634, CS8631 for a constructed type written where nullable warnings are enabled. */
    checkConstructionNullability(construction) {
      const type = construction.type,
        definition = type.originalDefinition,
        uri = construction.scope.uri;
      if (type.kind !== SymbolKind.NamedType || !type.typeArguments?.length || definition.typeParameters?.length !== type.typeArguments.length) return;
      if (!this.nullableAt(uri, construction.syntax.span?.start ?? construction.syntax.start ?? 0).warnings) return;
      const violations = nullabilityViolations([...definition.typeParameters], type.typeArguments, {
        display: definition.toDisplayString(),
        isAnnotationContext: (at, position) => this.nullableAt(at, position).annotations,
      });
      for (const v of violations) {
        const node = declarationNameOf(construction.syntax) ?? construction.argSyntax[v.index] ?? construction.syntax;
        this.report(uri, node, v.code, v.args, 'warning');
      }
    }
    /** Constraint checks for every constructed type written in source (deferred until all declarations are known). */
    checkConstructions() {
      const pending = this.constructions.splice(0);
      for (const c of pending) {
        const type = c.type;
        if (!type || type.isErrorType?.()) continue;
        for (const v of checkConstructedType(type, this.core)) {
          const index = v.type === type ? v.index : null,
            written = index !== null && c.argSyntax[index] ? c.argSyntax[index] : c.syntax,
            // A static type argument in a member's signature is reported on the member's name, once.
            node = v.code === DiagnosticId.CS0718 ? (signatureNameOf(c.syntax) ?? written) : written;
          this.report(c.scope.uri, node, v.code, v.args, v.severity);
        }
        this.checkConstructionNullability(c);
      }
    }
  };
