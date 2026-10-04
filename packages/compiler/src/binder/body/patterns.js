/**
 * Patterns: constant, type, declaration, var, discard, relational, not/and/or and property patterns;
 * other forms are bound leniently so their variables enter scope.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { TypeKind, ErrorTypeSymbol } from '../../symbols/types.js';
import { LocalDeclarationKind } from '../../symbols/members.js';
import { ConversionKind } from '../../conversions/classify.js';
import { typeTestOutcome } from '../../conversions/reference.js';
import { isPointerType } from '../../conversions/pointer.js';
import { containsTypeParameter } from '../../symbols/substitution.js';
import { stripNullable } from '../../conversions/nullable.js';

/**
 * The type the input is known to have where a pattern has matched, for the pattern after `and`: in
 * `o is int and > 0 and var n` the relational pattern compares an `int`, and `n` is an `int`.
 */
export function narrowedTypeOf(pattern, inputType) {
  switch (pattern.kind) {
    case 'TypePattern':
    case 'DeclarationPattern':
      return pattern.testedType ?? inputType;
    case 'RecursivePattern':
      return pattern.testedType ?? pattern.inputType ?? inputType;
    case 'AndPattern':
      return narrowedTypeOf(pattern.right, narrowedTypeOf(pattern.left, inputType));
    case 'RelationalPattern':
      // `x is > 0 and var n` over an `int?`: a value that compares is not null, and `n` is an `int`.
      return inputType?.isNullableValueType ? stripNullable(inputType) : inputType;
    case 'ConstantPattern':
      return inputType?.isNullableValueType && pattern.value?.constantValue && !pattern.value.constantValue.isNull ? stripNullable(inputType) : inputType;
    default:
      return inputType;
  }
}

const unknown = ErrorTypeSymbol.unknown;

/** Class mixin: Patterns: constant, type, declaration, var, discard, relational, not/and/or and property patterns; */
export const PatternBinding = Base =>
  class extends Base {
    /** True for `Span<char>` and `ReadOnlySpan<char>`. */
    isSpanOfChar(type) {
      const definition = type.originalDefinition;
      if (!definition || (definition !== this.core.span && definition !== this.core.readOnlySpan)) return false;
      const argument = type.typeArguments?.[0];
      return (argument?.type ?? argument)?.specialType === 'System_Char';
    }
    /** Patterns: constant, type, declaration, var, discard, relational, not/and/or, parenthesized; others are bound leniently. */
    pattern(syntax, inputType, input) {
      switch (syntax.kind) {
        case 'DiscardPattern':
          return { kind: 'DiscardPattern', syntax };
        case 'ParenthesizedPattern':
          return this.pattern(syntax.pattern, inputType, input);
        case 'ConstantPattern': {
          // An identifier or member access may be a type (a type pattern).
          if (
            [
              'IdentifierName',
              'QualifiedName',
              'GenericName',
              'PredefinedType',
              'SimpleMemberAccessExpression',
              'ArrayType',
              'NullableType',
            ].includes(syntax.expression.kind)
          ) {
            const saved = this.quiet;
            this.quiet = [];
            let e;
            try {
              e = this.expression(syntax.expression);
            } finally {
              this.quiet = saved;
            }
            if (e.kind === 'TypeExpression') return this.typePattern(syntax, e.referencedType, inputType);
          }
          const e = this.value(syntax.expression);
          if (e.hasErrors) return { kind: 'ConstantPattern', syntax, hasErrors: true };
          if (!e.constantValue && e.literal !== 'null') {
            this.report(syntax.expression, DiagnosticId.CS9135, [inputType ? this.display(inputType) : '?']);
            return { kind: 'ConstantPattern', syntax, hasErrors: true };
          }
          if (inputType && !inputType.isErrorType()) {
            // C# 8: `p is null` for a pointer. C# 11: a string constant matched against a span of char.
            if (e.literal === 'null' && isPointerType(inputType)) this.d.gate(this.c.uri, syntax.expression, 'NullPointerConstantPattern');
            if (e.type?.specialType === 'System_String' && e.constantValue && this.isSpanOfChar(inputType)) {
              this.d.gate(this.c.uri, syntax.expression, 'SpanCharConstantPattern');
              return { kind: 'ConstantPattern', syntax, value: e, isSpanText: true };
            }
            const c = this.conversions.classifyFromExpression(e, inputType);
            if (c.exists && c.isImplicit) return { kind: 'ConstantPattern', syntax, value: this.constantPatternValue(e, inputType, c) };
            // A value of a type parameter can be tested for null (unless it is known to be a value type) and, since
            // C# 7.1, for a constant of any type: `value is 5` is false for a T that is not an int.
            if (inputType.typeKind === TypeKind.TypeParameter && (e.literal === 'null' ? !inputType.isValueType : this.version.number >= 7.1)) {
              return { kind: 'ConstantPattern', syntax, value: e };
            }
            const explicit = e.type ? this.conversions.classifyExplicit(inputType, e.type) : null;
            if (
              explicit?.exists &&
              (explicit.isUnboxing ||
                explicit.isReference ||
                explicit.isBoxing ||
                explicit.isNullable ||
                inputType.typeKind === TypeKind.TypeParameter)
            )
              return { kind: 'ConstantPattern', syntax, value: e };
            this.reportConversionFailure(e, inputType, syntax.expression, c);
            return { kind: 'ConstantPattern', syntax, hasErrors: true };
          }
          return { kind: 'ConstantPattern', syntax, value: e };
        }
        case 'TypePattern':
          return this.typePattern(syntax, this.bindType(syntax.type).type, inputType);
        case 'DeclarationPattern': {
          const type = this.bindType(syntax.type).type,
            p = this.typePattern(syntax, type, inputType);
          this.designation(syntax.designation, type, p);
          return { ...p, kind: 'DeclarationPattern' };
        }
        case 'ListPattern':
          return this.listPattern(syntax, inputType);
        case 'SlicePattern':
          return this.straySlicePattern(syntax);
        case 'VarPattern': {
          // `var (a, b)` deconstructs the value: of a nullable tuple or struct, the value it has.
          if (syntax.designation?.kind === 'ParenthesizedVariableDesignation')
            return this.varPositionalPattern(syntax.designation, inputType ? stripNullable(inputType) : inputType, syntax);
          const p = { kind: 'VarPattern', syntax };
          this.designation(syntax.designation, inputType ?? unknown, p);
          return p;
        }
        case 'RelationalPattern': {
          const e = this.value(syntax.expression);
          if (!e.hasErrors && !e.constantValue) this.report(syntax.expression, DiagnosticId.CS0150);
          return {
            kind: 'RelationalPattern',
            syntax,
            operator: syntax.operatorToken.text,
            // A nullable input is compared by its value (`x is > 5` is false for null), so the constant has that type.
            value: inputType && !e.hasErrors ? this.convertQuiet(e, stripNullable(inputType)) : e,
          };
        }
        case 'NotPattern':
          return { kind: 'NotPattern', syntax, pattern: this.pattern(syntax.pattern, inputType, input) };
        case 'OrPattern':
          return {
            kind: syntax.kind,
            syntax,
            left: this.pattern(syntax.left, inputType, input),
            right: this.pattern(syntax.right, inputType, input),
          };
        case 'AndPattern': {
          const left = this.pattern(syntax.left, inputType, input),
            narrowed = left.hasErrors || !inputType ? inputType : narrowedTypeOf(left, inputType);
          return { kind: syntax.kind, syntax, left, right: this.pattern(syntax.right, narrowed, input), narrowedType: narrowed };
        }
        case 'RecursivePattern': {
          // Without a type the pattern matches a value that is not null: of a nullable value type, the value it has.
          const type = syntax.type ? this.bindType(syntax.type).type : inputType ? stripNullable(inputType) : inputType,
            p = syntax.type ? this.typePattern(syntax, type, inputType) : { kind: 'RecursivePattern', syntax },
            properties = [];
          for (const sub of syntax.propertyPatternClause?.subpatterns ?? []) properties.push(this.propertySubpattern(sub, type));
          const positional = syntax.positionalPatternClause ? this.positionalClause(syntax.positionalPatternClause, type) : null;
          if (syntax.designation) this.designation(syntax.designation, type ?? unknown, p);
          return { ...p, kind: 'RecursivePattern', inputType: type, properties, positional, hasPositional: !!syntax.positionalPatternClause };
        }
        default:
          this.incomplete = this.d.incomplete = true;
          for (const d of this.designationsIn(syntax)) this.designation(d, unknown, {});
          return { kind: syntax.kind, syntax, lenient: true };
      }
    }
    designationsIn(syntax) {
      const out = [],
        walk = n => {
          for (const c of n.childNodes()) {
            if (c.kind === 'SingleVariableDesignation') out.push(c);
            else walk(c);
          }
        };
      walk(syntax);
      return out;
    }
    /**
     * The constant as the pattern compares it: converted to the input type - except where that conversion only
     * changes the static type (`o is 5`, `o is Color.Red`, `o is "text"` for an `object`): there the input is
     * tested for the constant's own type and compared as that.
     */
    constantPatternValue(e, inputType, conversion) {
      const keepsType = e.literal !== 'null' && (conversion.isBoxing || conversion.isReference);
      if (keepsType) return e;
      // A nullable input is compared by its value: the constant keeps being a constant of the underlying type.
      const underlying = e.literal !== 'null' && inputType.isNullableValueType ? stripNullable(inputType) : null;
      return underlying ? this.convertQuiet(e, underlying) : this.applyConversion(e, inputType, conversion);
    }
    typePattern(syntax, type, inputType) {
      if (type.isErrorType() || !inputType || inputType.isErrorType()) return { kind: 'TypePattern', syntax, testedType: type };
      // C# 7.0 needs a conversion between the two types; C# 7.1 ('generic pattern-matching') lets an open type be tested for any type.
      if (this.version.number < 7.1 && (containsTypeParameter(inputType) || containsTypeParameter(type))) {
        const c = this.conversions.classifyExplicit(inputType, type);
        if (!c.exists || c.isUserDefined) {
          this.report(syntax.type ?? syntax, DiagnosticId.CS8314, [this.display(inputType), this.display(type), '7.0', '7.1']);
          return { kind: 'TypePattern', syntax, testedType: type, hasErrors: true };
        }
      }
      const outcome = typeTestOutcome(inputType, type, this.core);
      if (outcome === 'never' && !(inputType.typeKind === TypeKind.TypeParameter || type.typeKind === TypeKind.TypeParameter)) {
        const c = this.conversions.classifyExplicit(inputType, type);
        if (!c.exists || c.isNumeric || c.isUserDefined || c.kind === ConversionKind.ExplicitEnumeration)
          this.report(syntax.type ?? syntax, DiagnosticId.CS8121, [this.display(inputType), this.display(type)]);
      }
      return { kind: 'TypePattern', syntax, testedType: type, outcome };
    }
    designation(designation, type, pattern) {
      if (!designation) return;
      if (designation.kind === 'SingleVariableDesignation') {
        const name = designation.identifier.valueText,
          local = this.newLocal(name, type, designation.identifier, LocalDeclarationKind.Pattern);
        local.writes++;
        local.isPatternLocal = true;
        local.nonConstantWrite = true;
        this.declare(name, local, designation.identifier);
        pattern.local = local;
      } else if (designation.kind === 'ParenthesizedVariableDesignation') {
        this.incomplete = this.d.incomplete = true;
        for (const v of designation.variables) this.designation(v, unknown, {});
      }
    }
  };
