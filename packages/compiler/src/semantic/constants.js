/**
 * Constant evaluation in declaration contexts: const fields (with circularity detection), enum members
 * and parameter default values.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind } from '../symbols/types.js';
import { bindEnumMembers } from '../binder/enums.js';
import { BodyBinder } from '../binder/body-binder.js';
import { isSourceSymbol } from './analysis-helpers.js';
import {registeredEnumConstant} from '../constants/registered-enum-constant.js';

/** Class mixin: Constant evaluation in declaration contexts: const fields (with circularity detection), enum members */
export const ConstantBinding = Base =>
  class extends Base {
    /** Evaluates a constant expression in a declaration context (const fields, enum members, parameter defaults). */
    evaluateConstant(syntax, scope, containingType, targetType) {
      const binder = new BodyBinder(this, {
        uri: scope.uri,
        scope,
        containingType,
        method: null,
        isStatic: true,
        isFieldInitializer: true,
        isStaticInitializer: true,
        parameters: [],
        enumInitializerOf: containingType?.typeKind === TypeKind.Enum ? containingType : null,
      });
      return binder.constant(syntax, targetType);
    }
    /** The constant value of a const field or enum member (bound on demand; circular definitions are CS0110). */
    constantOf(field) {
      if (field.isEnumMember) {
        if (field.constantValue === undefined) {
          const type = field.containingType;
          bindEnumMembers(
            type,
            this.core,
            (syntax, scope) => this.evaluateConstant(syntax, scope, type, null),
            (uri, node, code, args) => this.report(uri, node, code, args),
          );
        }
        return field.constantValue ?? null;
      }
      if (!field.isConst || (!isSourceSymbol(field) && !field.initializerSyntax)) {
        const registered = registeredEnumConstant(field, this.core.bridge.bridge ?? this.core.bridge);
        return registered ?? (field.hasConstantValue && field.constantValue instanceof Object ? field.constantValue : null);
      }
      const state = this.constantState.get(field);
      if (state === 'done') return field.constantValueObject ?? null;
      if (state === 'active') {
        this.reportAt(field, DiagnosticId.CS0110, [field.toDisplayString()]);
        this.constantState.set(field, 'done');
        field.constantValueObject = null;
        return null;
      }
      this.constantState.set(field, 'active');
      let value = null;
      if (field.initializerSyntax) {
        const r = this.evaluateConstant(field.initializerSyntax, field.scope, field.containingType, field.type);
        if (this.constantState.get(field) === 'done') return null;
        if (!r.errors) {
          const type = field.type,
            isNull = r.bound?.literal === 'null' || r.constant?.isNull,
            onlyNull = type?.isReferenceType === true && type.specialType !== 'System_String' && !type.isErrorType();
          // A const of a reference type other than string can only be null: a non-null constant initializer is CS0134.
          const written = r.constant ?? r.bound?.operand?.constantValue;
          if (onlyNull && written && !isNull) this.report(field.uri, field.initializerSyntax, DiagnosticId.CS0134, [field.toDisplayString(), type.toDisplayString()]);
          else if (r.constant) value = r.constant;
          else if (!isNull) this.report(field.uri, field.initializerSyntax, DiagnosticId.CS0133, [field.toDisplayString()]);
        }
      } else this.reportAt(field, DiagnosticId.CS0145);
      field.constantValueObject = value;
      this.constantState.set(field, 'done');
      return value;
    }
    bindConstants(type) {
      if (type.typeKind === TypeKind.Enum) return;
      for (const m of type.getMembers())
        if (m.kind === SymbolKind.Field && m.isConst) {
          this.constantOf(m);
          const t = m.type;
          if (t && !t.isErrorType() && t.isValueType === true && t.typeKind === TypeKind.Struct && !t.specialType && m.typeSyntax)
            this.report(m.uri, m.typeSyntax, DiagnosticId.CS0283, [t.toDisplayString()]);
        }
    }
    /** The default value converted to the parameter type; a value of the wrong type is CS1750 on the parameter. */
    parameterDefault(p, binder) {
      const saved = binder.quiet;
      binder.quiet = [];
      let result, raised;
      try {
        result = binder.constant(p.defaultSyntax, p.type);
      } finally {
        raised = binder.quiet;
        binder.quiet = saved;
      }
      const mismatch = raised.find(d => d.code === DiagnosticId.CS0029 || d.code === DiagnosticId.CS0266);
      if (mismatch && p.locations?.[0]) binder.report(p.locations[0], DiagnosticId.CS1750, mismatch.args);
      else for (const d of raised) binder.report(d.node, d.code, d.args);
      return result;
    }
    bindParameterDefault(p, binder) {
      if (!p.defaultSyntax || p.defaultBound) return;
      p.defaultBound = true;
      const r = this.parameterDefault(p, binder);
      if (!r.errors) {
        if (r.constant) p.explicitDefaultValue = r.constant;
        else if (
          r.bound &&
          !(
            r.bound.literal ||
            r.bound.kind === 'Default' ||
            (r.bound.kind === 'ObjectCreation' && !r.bound.args?.length) ||
            r.bound.operand?.literal ||
            r.bound.operand?.kind === 'Default' ||
            // A constant wrapped into a nullable type: `long? x = 0`.
            (r.bound.conversion?.kind === 'ImplicitNullable' && r.bound.operand?.constantValue)
          )
        )
          binder.report(p.defaultSyntax, DiagnosticId.CS1736, [p.name]);
      }
    }
  };
