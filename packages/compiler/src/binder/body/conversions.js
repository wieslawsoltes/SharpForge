/**
 * Conversions of bound expressions: implicit conversion with the Roslyn diagnostics for a failure (CS0029,
 * CS0266, CS0031, CS0037, CS0428, CS1660 ...), constant folding of converted constants, value and condition contexts,
 * read/write bookkeeping for unused-symbol warnings and the best common type of a set of expressions.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { bestCommonType } from '../implicit-types.js';
import { TypeKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { ConstantValue, isFoldError } from '../../constants/constant-value.js';
import { foldConversion } from '../../constants/fold.js';
import { Conversion, ConversionKind } from '../../conversions/classify.js';
import { numericKind } from '../../conversions/numeric.js';
import { classifyConstantNarrowing } from '../../conversions/constant-narrowing.js';
import { isNullableType, stripNullable } from '../../conversions/nullable.js';
import { delegateInvoke } from '../../overload/type-inference.js';
import { isAccessible } from '../accessibility.js';
import { anonymousFunctionAnchor } from '../anonymous-methods.js';
import { reportTupleLiteralFailure } from '../tuples.js';
import { isWriteAUse } from '../../flow/write-is-a-use.js';

const keywordOf = type =>
  numericKind(type) ??
  { System_Boolean: 'bool', System_String: 'string', System_Char: 'char', System_Object: 'object' }[type?.specialType] ??
  null;

/** Class mixin (composed into the owning class by its index module). */
/** True for a type that is, or is an array of, an error type: a conversion to it is not worth a second diagnostic. */
const hasErrorElement = type => {
  for (let current = type; current; current = current.elementType) if (current.isErrorType?.()) return true;
  return false;
};
const isFunctionExpression = e => e.form === 'lambda' || e.kind === 'MethodGroup';

export const ConversionBinding = Base =>
  class extends Base {
    // ---- conversions ----
    /** Converts a bound expression to a type implicitly, reporting the Roslyn diagnostic when no conversion exists. */
    convert(e, type, node = e.syntax, { argument = null } = {}) {
      if (!type || e.hasErrors || hasErrorElement(type) || e.type?.isErrorType?.()) return e;
      if (isFunctionExpression(e) && this.isFunctionTypeTarget(type)) return this.convertThroughFunctionType(e, type, node);
      if (e.kind === 'TypeExpression' || e.kind === 'NamespaceExpression') {
        this.report(e.syntax, DiagnosticId.CS0119, [
          e.kind === 'TypeExpression' ? this.display(e.referencedType) : e.namespace.toDisplayString(),
          e.kind === 'TypeExpression' ? 'type' : 'namespace',
        ]);
        return this.bad(node);
      }
      if (e.type && !e.literal && !e.form && !e.constantValue && e.type.equals(type)) return e;
      const c = this.conversions.classifyFromExpression(e, type);
      if (c.exists && c.isImplicit && !c.isAmbiguous) return this.applyConversion(e, type, c, node);
      this.reportConversionFailure(e, type, node, c);
      return this.bad(node, { operand: e });
    }
    /**
     * The operand of a user-defined conversion whose parameter is a tuple (`implicit operator Vec2((double X, double
     * Y) t)` for `Vec2 v = (1.5, -2)`): the tuple conversion that precedes the operator is part of the bound tree,
     * because it works element by element and cannot be done on the finished value like a numeric conversion.
     */
    tupleOperandOfUserConversion(e, c, node) {
      const parameterType = c.method?.parameters?.[0]?.type;
      if (!parameterType?.isTupleType || (e.type && e.type.equals(parameterType))) return e;
      if (e.form !== 'tupleLiteral' && !e.type?.isTupleType) return e;
      const standard = this.conversions.classifyFromExpression(e, parameterType);
      return standard.exists && !standard.isUserDefined ? this.applyConversion(e, parameterType, standard, node) : e;
    }
    applyConversion(e, type, c, node = e.syntax, isExplicit = false) {
      if (c.kind === ConversionKind.Identity && e.type && !e.constantValue?.isEnum && e.type.equals(type)) return e;
      if (
        e.materialize &&
        (c.kind === ConversionKind.ObjectCreation ||
          c.kind === ConversionKind.CollectionExpression ||
          e.isTargetTypedConditional ||
          e.isTargetTypedSwitch)
      )
        return e.materialize(type);
      if (e.form === 'tupleLiteral') this.finishTupleLiteralElements(e, type, c);
      if (e.form === 'lambda' && c.kind === ConversionKind.AnonymousFunction) {
        e.boundAs = type;
        // The body is bound for the delegate type here, whoever converts the lambda (an initializer value, an operand
        // of `?:`, an element of a tuple or a collection); a speculative conversion leaves it to the final one.
        if (!this.quiet && !e.hasErrors) this.finishLambda(e, type);
        return this.node('Conversion', node, type, { operand: e, conversion: c, isExplicit });
      }
      e = this.tupleOperandOfUserConversion(e, c, node);
      const result = this.node('Conversion', node, type, {
        operand: e,
        conversion: c,
        isExplicit,
        isImplicitIdentity: c.kind === ConversionKind.Identity,
        // A numeric conversion in a checked context traps on overflow; code generation reads the context from the node.
        ...(this.checked ? { isChecked: true } : {}),
      });
      // A constant string converted to ReadOnlySpan<char> by the C# 14 span conversion has no side effect (CS0219 applies).
      if (c.kind === ConversionKind.ImplicitSpan && e.constantValue) result.isCompileTimeValue = true;
      if (e.constantValue) {
        const target = type.typeKind === TypeKind.Enum ? type : keywordOf(stripNullable(type));
        if (target && !isNullableType(type)) {
          const folded = foldConversion(e.constantValue, target, { checked: !this.uncheckedContext });
          if (isFoldError(folded)) {
            this.report(node, folded.error.code, folded.error.args);
            result.hasErrors = true;
          } else if (folded) result.constantValue = folded;
        } else if (e.constantValue.isNull && type.isReferenceType === true)
          result.constantValue = ConstantValue.null(keywordOf(type) ?? 'object');
      }
      return result;
    }
    reportConversionFailure(e, type, node, c) {
      const to = this.display(type);
      if (c?.isAmbiguous) {
        this.report(node, DiagnosticId.CS0457, [
          c.candidates[0].toDisplayString(),
          c.candidates[1]?.toDisplayString() ?? '',
          this.display(e.type),
          to,
        ]);
        return;
      }
      if (e.literal === 'null') {
        this.report(node, DiagnosticId.CS0037, [to]);
        return;
      }
      if (e.form === 'tupleLiteral' && reportTupleLiteralFailure(this, e, type)) return;
      if (e.form === 'methodGroup') {
        const r = e.lastConversionError,
          at = e.nameNode && node === e.syntax ? e.nameNode : node;
        if (r && delegateInvoke(type)) {
          // A wrong return type is reported on the whole method group expression, the other mismatches on the method name.
          this.report(r.code === DiagnosticId.CS0407 || r.code === DiagnosticId.CS1113 ? node : at, r.code, r.args);
          return;
        }
        this.report(at, DiagnosticId.CS0428, [e.name, to]);
        return;
      }
      if (e.form === 'lambda') {
        const r = e.lastConversionError;
        if (r) for (const x of r) this.report(x.node ?? node, x.code, x.args);
        else if (e.isAnonymousMethod && ['System_Object', 'System_Delegate', 'System_MulticastDelegate'].includes(type.specialType))
          this.report(anonymousFunctionAnchor(e.syntax, node), DiagnosticId.CS8917);
        else this.report(anonymousFunctionAnchor(e.syntax, node), DiagnosticId.CS1660, [e.isAnonymousMethod ? 'anonymous method' : 'lambda expression', to]);
        return;
      }
      if (this.reportTargetTypedFailure(e, type)) return;
      if (e.form === 'collection' && e.elements) {
        this.reportCollectionFailure(e, type);
        return;
      }
      if (e.form === 'implicitNew') {
        this.report(node, DiagnosticId.CS8752, [to]);
        return;
      }
      if (!e.type) {
        this.report(node, DiagnosticId.CS0029, ['?', to]);
        return;
      }
      if (e.type.specialType === 'System_Void') {
        this.report(node, DiagnosticId.CS0029, ['void', to]);
        return;
      }
      const from = this.display(e.type);
      // Numeric constants: CS0031 when the value does not fit, CS0664 for a double literal assigned to float/decimal.
      if (e.constantValue && !e.constantValue.isNull) {
        const a = this.conversions.kindOf(e.type),
          b = this.conversions.kindOf(stripNullable(type));
        if (a && b) {
          const r = classifyConstantNarrowing(a, e.constantValue.isIntegral ? e.constantValue.bigint : null, b, {
            isRealLiteral: e.kind === 'Literal' && a === 'double',
            display: e.constantValue.displayValue,
          });
          if (r && r.code && r.code !== DiagnosticId.CS0266) {
            this.report(node, r.code, r.args);
            return;
          }
        }
      }
      const explicit = this.conversions.classifyExplicit(e.type, type);
      this.report(node, explicit.exists ? DiagnosticId.CS0266 : DiagnosticId.CS0029, [from, to]);
    }
    /** Binds an expression that must produce a value (not a type, namespace or bare method group). */
    value(syntax, options) {
      return this.asValue(this.expression(syntax, options));
    }
    asValue(e) {
      if (e.hasErrors) {
        if (e.kind === 'Local') e.local.reads++;
        return e;
      }
      if (e.kind === 'TypeExpression') {
        this.report(e.syntax, DiagnosticId.CS0119, [this.display(e.referencedType), 'type']);
        return this.bad(e.syntax);
      }
      if (e.kind === 'NamespaceExpression') {
        this.report(e.syntax, DiagnosticId.CS0119, [e.namespace.toDisplayString(), 'namespace']);
        return this.bad(e.syntax);
      }
      // Outside its declaring type an event is not a value: it can only be subscribed to (SF-A02-T07.6).
      if (e.kind === 'EventAccess' && !this.inDeclaringType(e.event)) {
        const at = e.syntax.kind === 'SimpleMemberAccessExpression' ? e.syntax.name : e.syntax;
        this.report(at, DiagnosticId.CS0070, [e.event.toDisplayString(), this.display(e.event.containingType)]);
        return this.bad(e.syntax);
      }
      return this.markRead(e);
    }
    markRead(e) {
      if ((e.kind === 'PropertyAccess' || (e.kind === 'IndexerAccess' && e.property.containingType)) && !e.readChecked) {
        e.readChecked = true;
        const p = e.property;
        if (!p.getMethod && p.setMethod) this.report(e.syntax, DiagnosticId.CS0154, [p.toDisplayString()]);
        else if (
          p.getMethod &&
          p.getMethod.declaredAccessibility !== p.declaredAccessibility &&
          !isAccessible(p.getMethod.originalDefinition ?? p.getMethod, this.c.containingType?.originalDefinition ?? null, {
            withinModule: this.d.assembly.module,
          })
        )
          this.report(e.syntax, DiagnosticId.CS0271, [p.toDisplayString()]);
      }
      if (e.kind === 'Local') {
        e.local.reads++;
      } else if (e.kind === 'FieldAccess') {
        const f = e.field.originalDefinition ?? e.field;
        f.reads = (f.reads ?? 0) + 1;
      } else if (e.kind === 'MethodGroup' && e.methods.length === 1 && e.methods[0].methodKind === MethodKind.LocalFunction)
        e.methods[0].uses = (e.methods[0].uses ?? 0) + 1;
      return e;
    }
    markWrite(e, value) {
      if (e.kind === 'Local') {
        e.local.writes++;
        if (value && isWriteAUse(e.local.type, value)) e.local.nonConstantWrite = true;
      } else if (e.kind === 'FieldAccess') {
        const f = e.field.originalDefinition ?? e.field;
        f.writes = (f.writes ?? 0) + 1;
        if ((value && !(value.constantValue || value.literal || value.kind === 'Default')) || !value) f.nonConstantWrite = true;
        // Writing a field of a struct-typed field writes (part of) that field too.
        if (e.receiver?.kind === 'FieldAccess' && e.receiver.type?.isValueType === true) this.markWrite(e.receiver, null);
      }
    }
    /** A field whose reference is taken (`ref o.f`) may be written through the alias: it counts as assigned (no CS0649). */
    markAliased(e) {
      if (e.kind === 'FieldAccess') this.markWrite(e, null);
      return e;
    }
    /** Binds and converts to bool (conditions), accepting `operator true`. */
    condition(syntax) {
      const e = this.value(syntax);
      if (e.hasErrors || !e.type) return e.type ? e : this.convert(e, this.core.bool);
      if (e.type.specialType === 'System_Boolean') return e;
      const c = this.conversions.classifyFromExpression(e, this.core.bool);
      if (c.exists && c.isImplicit) return this.applyConversion(e, this.core.bool, c);
      const op = this.d.operators.trueOperator(e.type);
      if (op) return this.node('UserDefinedCondition', syntax, this.core.bool, { operand: e, method: op });
      return this.convert(e, this.core.bool);
    }
    /** The best common type of a set of expressions (spec 12.6.3.15): the candidate type every expression converts to. */
    /** C# 10: `object`, `System.Delegate` and `System.MulticastDelegate` accept a lambda or method group through its natural type. */
    isFunctionTypeTarget(type) {
      if (this.version.number < 10) return false;
      return type.specialType === 'System_Object' || type.equals(this.core.delegate) || type.equals(this.core.multicastDelegate);
    }
    /** Converts a lambda or method group to its natural delegate type and that to `type`; CS8917 when it has none. */
    convertThroughFunctionType(e, type, node) {
      const natural = this.naturalFunctionType(e);
      if (!natural) {
        this.report(anonymousFunctionAnchor(e.syntax, node), DiagnosticId.CS8917);
        return this.bad(node, { operand: e });
      }
      const delegate = this.convert(e, natural, node);
      if (e.form === 'lambda' && !delegate.hasErrors) this.finishLambda(e, natural);
      if (delegate.hasErrors) return delegate;
      return this.applyConversion(delegate, type, this.conversions.classifyImplicit(natural, type), node);
    }
    /** The best common type of bound expressions (implicitly typed arrays, inferred lambda return types), or null. */
    bestCommonType(values) {
      const types = [];
      for (const value of values) {
        const type = value.type ?? this.functionTypeOf(value);
        if (type && type.specialType !== 'System_Void') types.push(type);
      }
      return bestCommonType(types, (from, to) => this.conversions.classifyImplicit(from, to).exists);
    }
    /** C# 10: the natural delegate type a lambda or method group contributes to a best common type, or null. */
    functionTypeOf(value) {
      const isFunction = value.form === 'lambda' || value.kind === 'MethodGroup';
      return isFunction && this.version.number >= 10 ? this.naturalFunctionType(value) : null;
    }
    operandDisplay(e) {
      return e.literal === 'null'
        ? '<null>'
        : e.kind === 'MethodGroup'
          ? 'method group'
          : e.form === 'lambda'
            ? 'lambda expression'
            : e.literal === 'default'
              ? 'default'
              : this.display(e.type);
    }
    operand(e, type) {
      if (!type || (!e.type && !e.literal)) return e;
      if (e.type && e.type.equals(type)) return e;
      const c = this.conversions.classifyFromExpression(e, type);
      return c.exists ? this.applyConversion(e, type, c) : e;
    }
    convertQuiet(e, type) {
      const c = this.conversions.classifyFromExpression(e, type);
      return c.exists ? this.applyConversion(e, type, c) : e;
    }
    /** Constant expression evaluation used by const fields, enum members, parameter defaults and case labels. */
    constant(syntax, type = null) {
      const e = this.value(syntax);
      if (e.hasErrors) return { errors: true, bound: e };
      const converted = type ? this.convert(e, type, syntax) : e;
      return { constant: converted.constantValue, type: converted.type, bound: converted, errors: !!converted.hasErrors };
    }
  };
