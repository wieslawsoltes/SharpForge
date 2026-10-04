/**
 * Lowering of value expressions: literals and constants, variables, member reads, operators, assignments,
 * conversions and interpolated strings.
 */
import { findContracts } from '@sharpforge/framework';
import { TypeKind } from '../../symbols/types.js';
import { isRegisteredReferenceUpcast } from '../../conversions/registered-reference.js';
import { needsPrimitiveBox, primitiveBoxContract } from '../../primitive-boxing.js';
import { n } from './node-factory.js';
import { interpolatedText } from '../../binder/csharp6.js';
import {registeredFieldLiteral} from '../registered-fields.js';

const foldableTypes = new Set(['int', 'double', 'bool', 'string']);
const formatValue = () => findContracts('SharpForge.Runtime.Formatting', 'FormatValue', true)[0];

/** Class mixin: value expressions. */
export const ExpressionTranslation = Base =>
  class extends Base {
    /** Lowers an expression whose value is used. */
    expression(node) {
      if (node.hasErrors) return this.unsupported('an expression the binder could not bind', node.syntax);
      const constant = this.constant(node);
      if (constant) return constant;
      const handler = this['expr' + node.kind];
      if (!handler) return this.unsupported(`${describe(node.kind)} expressions`, node.syntax);
      return handler.call(this, node);
    }
    /** Lowers an expression evaluated for its side effects only (its value is discarded by the caller). */
    effect(node) {
      if (node.kind === 'ConditionalAccess') return this.conditionalAccess(node, true);
      if (node.kind === 'Assignment' && node.left.kind === 'Discard') return this.effect(node.right);
      return this.expression(node);
    }
    /** A folded constant as a literal, when the node has one the image can hold. */
    constant(node) {
      const value = node.constantValue;
      if (!value || node.kind === 'Lambda') return null;
      // A constant converted from a type the runtime lacks (a char widened to int) must not slip through as a number.
      if (node.kind === 'Conversion' && node.operand?.type) this.imageType(node.operand.type, node.syntax);
      if (value.isNull) return n.nullLiteral(node.type ? this.imageType(node.type, node.syntax) : 'object');
      const type = node.type ? this.imageType(node.type, node.syntax) : null;
      if (node.kind === 'FieldAccess' && value.isEnum && value.enumType === node.type &&
          this.g.bridge.registryName(node.type) === type) {
        // The existing enum field IR emits Op.ENUM, retaining the registered carrier on both engines.
        return {kind: 'FieldAccess', legacyType: type, isExpression: true, receiver: null, field: null, constantValue: value};
      }
      if (!type || !foldableTypes.has(type)) return null;
      const raw = typeof value.value === 'bigint' ? Number(value.value) : value.value;
      return n.literal(raw, type);
    }
    exprLiteral(node) {
      if (node.literal === 'null' || node.literal === 'default') return n.nullLiteral(node.type ? this.imageType(node.type, node.syntax) : 'object');
      return this.unsupported('a literal of a type the runtime does not have', node.syntax);
    }
    exprDefault(node) {
      return this.defaultValue(this.imageType(node.type, node.syntax));
    }
    exprNameOf(node) {
      return n.literal(node.constantValue?.value ?? '', 'string');
    }
    exprLocal(node) {
      return this.variable(node.local, node.syntax);
    }
    exprParameter(node) {
      return this.variable(node.parameter, node.syntax);
    }
    exprThis(node) {
      return this.frame.thisExpr ? this.frame.thisExpr() : this.unsupported('this in this position', node.syntax);
    }
    exprFieldAccess(node) {
      return registeredFieldLiteral(node.field) ?? this.assignStatic(node, this.fieldReference(node));
    }
    /** A field as a readable and assignable node. */
    fieldReference(node) {
      const record = this.g.fieldOf(node.field, node.syntax);
      return record.isStatic ? n.staticField(record) : n.field(this.memberReceiver(node), record);
    }
    /** Runs the type initializer of a static field's class before `value` (a read of, or an assignment to, that field). */
    assignStatic(target, value) {
      if (target.kind !== 'FieldAccess' || !target.field.isStatic) return value;
      const ensure = this.g.typeInitializerCall(target.field);
      return ensure ? n.sequence([], [ensure], value) : value;
    }
    exprArrayAccess(node) {
      if (node.indices.length !== 1) return this.unsupported('multi-dimensional arrays', node.syntax);
      return n.arrayElement(this.expression(node.array), this.expression(node.indices[0]));
    }
    exprArrayLength(node) {
      return n.arrayLength(this.expression(node.operand ?? node.array ?? node.receiver));
    }
    exprArrayCreation(node) {
      const elementType = this.imageType(node.type.elementType, node.syntax);
      if (node.type.rank !== 1) return this.unsupported('multi-dimensional arrays', node.syntax);
      if (node.elements) {
        const elements = node.elements.map(e => this.objectArgument(this.expression(e), elementType));
        return n.newArray(elementType, n.literal(elements.length, 'int'), elements);
      }
      const length = this.expression(node.sizes[0]);
      // Arrays of reference types start as null and numeric arrays as zero: exactly what NEWARR gives.
      return n.newArray(elementType, length);
    }
    exprUnary(node) {
      if (node.method) return n.call(this.g.methodOf(node.method, node.syntax), null, [this.expression(node.operand)]);
      if (node.isLifted) return this.unsupported('nullable value types', node.syntax);
      return n.unary(node.operator, this.expression(node.operand), this.imageType(node.type, node.syntax), !!node.isChecked);
    }
    exprBinary(node) {
      if (node.isLifted) return this.unsupported('nullable value types', node.syntax);
      const left = this.expression(node.left),
        right = this.expression(node.right);
      if (node.method) {
        if (node.isLogical) return this.unsupported('user-defined conditional logical operators', node.syntax);
        return n.call(this.g.methodOf(node.method, node.syntax), null, [left, right]);
      }
      if (node.family === 'delegate') return this.delegateArithmetic(node, left, right);
      const delegateEquality = this.delegateEquality(node, left, right);
      if (delegateEquality) return delegateEquality;
      if (node.operator === '>>>') return this.unsupported('the unsigned right shift operator', node.syntax);
      return n.binary(node.operator, left, right, this.imageType(node.type, node.syntax), !!node.isChecked);
    }
    exprConditional(node) {
      const type = this.imageType(node.type, node.syntax);
      return this.choose(this.expression(node.condition), this.expression(node.whenTrue), this.expression(node.whenFalse), type);
    }
    /**
     * `condition ? whenTrue : whenFalse`. The branches of the operator meet on the evaluation stack, which holds one
     * representation only: when an `object`-typed choice has a primitive branch, each branch is stored into an
     * `object` temporary instead (the store is where a primitive is boxed).
     */
    choose(condition, whenTrue, whenFalse, type) {
      const isPrimitive = value => ['int', 'double', 'bool'].includes(value.legacyType);
      if (type !== 'object' || !(isPrimitive(whenTrue) || isPrimitive(whenFalse))) return n.conditional(condition, whenTrue, whenFalse, type);
      const result = this.holder('object', 'choice'),
        store = value => n.expressionStatement(n.assign(result.read(), value));
      return n.sequence([], [result.init(n.nullLiteral('object')), n.ifStatement(condition, store(whenTrue), store(whenFalse))], result.read());
    }
    exprCoalesce(node) {
      if (node.leftConversion && !node.leftConversion.isIdentity) return this.unsupported('nullable value types', node.syntax);
      if (node.right.form === 'throw') {
        const left = this.once(this.expression(node.left));
        const thrown = n.throwStatement(this.expression(node.right.operand), this.span(node.right.syntax));
        const check = n.ifStatement(n.equals(left.read(), n.nullLiteral(left.read().legacyType)), thrown);
        return n.sequence(left.locals, [...left.effects, check], left.read());
      }
      return n.coalesce(this.expression(node.left), this.expression(node.right), this.imageType(node.type, node.syntax));
    }
    exprCoalesceAssignment(node) {
      const target = this.target(node.left);
      return this.assignStatic(node.left, {
        kind: 'NullCoalescingAssignmentOperator',
        legacyType: target.legacyType,
        isExpression: true,
        left: target,
        right: this.expression(node.right),
      });
    }
    exprAssignment(node) {
      if (node.left.kind === 'Discard') return this.expression(node.right);
      const left = node.left;
      if (left.kind === 'IndexerAccess' && this.g.isSource(left.property)) return this.sourceIndexerStore(left, this.expression(node.right));
      return this.assignStatic(left, n.assign(this.target(left), this.expression(node.right)));
    }
    exprCompoundAssignment(node) {
      const left = node.left;
      if (left.type?.typeKind === TypeKind.Delegate) return this.delegateCompound(node);
      if (node.method) return this.unsupported('compound assignment through a user-defined operator', node.syntax);
      if (left.kind === 'IndexerAccess' && this.g.isSource(left.property))
        return this.unsupported('compound assignment to a user-defined indexer', node.syntax);
      const target = this.target(left);
      return this.assignStatic(left, n.compoundAssign(node.operator, target, this.expression(node.right), !!node.isChecked));
    }
    exprIncrement(node) {
      if (node.method) return this.unsupported('increment through a user-defined operator', node.syntax);
      return this.assignStatic(node.operand, n.increment(node.operator, this.target(node.operand), !!node.isPostfix, !!node.isChecked));
    }
    /** An assignment target: the lowered node is one the emitter can load from and store to. */
    target(node) {
      switch (node.kind) {
        case 'Local':
        case 'Parameter':
        case 'ArrayAccess':
          return this.expression(node);
        case 'FieldAccess':
          return this.fieldReference(node);
        case 'PropertyAccess':
          return this.autoPropertyField(node) ?? this.propertyReference(node);
        case 'IndexerAccess':
          return this.indexerReference(node);
        case 'EventAccess':
          return this.exprEventAccess(node);
        default:
          return this.unsupported(`assignment to ${describe(node.kind)}`, node.syntax);
      }
    }
    /** A getter-only auto-property is assigned (in its constructor or initializer) through its backing field. */
    autoPropertyField(node) {
      const property = node.property.originalDefinition ?? node.property;
      if (property.setMethod || !this.g.isSource(property)) return null;
      const record = this.g.autoProperties.get(node.property);
      if (!record) return null;
      return record.isStatic ? n.staticField(record) : n.field(this.memberReceiver(node), record);
    }
    exprConversion(node) {
      const kind = node.conversion?.kind,
        operand = node.operand;
      switch (kind) {
        case 'InterpolatedString':
          // The string is not built: the object keeps the format and the arguments, to be formatted later.
          return this.unsupported(
            `an interpolated string as '${node.type.toDisplayString()}' (the registry has no FormattableStringFactory.Create)`,
            node.syntax,
          );
        case 'Identity':
        case 'ImplicitReference':
        case 'ImplicitEnumeration':
        case 'ExplicitEnumeration':
          return this.retyped(this.expression(operand), node);
        case 'NullLiteral':
        case 'DefaultLiteral':
          return this.defaultValue(this.imageType(node.type, node.syntax));
        case 'ImplicitNumeric':
        case 'ExplicitNumeric':
        case 'ImplicitConstant': {
          const from = this.imageType(operand.type, operand.syntax),
            to = this.imageType(node.type, node.syntax),
            value = this.expression(operand);
          return from === to ? value : n.convert(value, to, !!node.isChecked);
        }
        case 'Boxing':
          return this.box(operand, node);
        case 'AnonymousFunction':
          return this.lambda(operand, node.type);
        case 'MethodGroup':
          return this.methodGroupDelegate(node);
        case 'ImplicitUserDefined':
        case 'ExplicitUserDefined':
          return this.userDefinedConversion(node);
        case 'ExplicitReference':
        case 'Unboxing':
          return this.unsupported('casts that need a runtime type check', node.syntax);
        default:
          return this.unsupported(`${describe(kind ?? 'unknown')} conversions`, node.syntax);
      }
    }
    /** A reference conversion changes only the static type: the value is the same object. */
    retyped(value, node) {
      const type = this.imageType(node.type, node.syntax);
      // Registered upcasts preserve the reference; arbitrary source hierarchies remain unsupported.
      if (value.legacyType !== type && type !== 'object' && value.kind !== 'Literal' && node.conversion?.kind === 'ImplicitReference' &&
          (this.g.isSource(node.operand.type) || !isRegisteredReferenceUpcast(value.legacyType, type)))
        return this.unsupported(`converting '${node.operand.type?.toDisplayString()}' to '${node.type.toDisplayString()}'`, node.syntax);
      return value.legacyType === type || value.kind !== 'Literal' ? value : { ...value, legacyType: type };
    }
    /**
     * General object conversions retain the execution profile's representation.
     * Contract arguments and object-array elements preserve primitive identity through `objectArgument`.
     */
    box(operand, node) {
      if (operand.type?.typeKind === TypeKind.Enum) return this.unsupported('boxing an enum value', node.syntax);
      return this.expression(operand);
    }
    /** Arguments of a framework contract: a primitive passed as `object` is boxed with its static type, as the profile does. */
    contractArguments(contract, args) {
      if (!contract) return args;
      return args.map((value, i) => this.objectArgument(value, contract.parameters[i]));
    }
    /** Preserve primitive identity for a contract argument or an object-array element. */
    objectArgument(value, target) {
      return needsPrimitiveBox(target, value.legacyType)
        ? n.frameworkCall({ contract: primitiveBoxContract() }, null, [value, n.literal(value.legacyType, 'string')], 'object')
        : value;
    }
    userDefinedConversion(node) {
      const method = node.conversion.method ?? node.method;
      if (!method || !this.g.isSource(method)) return this.unsupported('user-defined conversions of framework types', node.syntax);
      return n.call(this.g.methodOf(method, node.syntax), null, [this.expression(node.operand)]);
    }
    /** `$"a{x,5:F2}"` is `"" + "a" + Formatting.FormatValue(x, "F2", 5, "<type>")`, the lowering of the execution profile. */
    exprInterpolatedString(node) {
      let result = n.literal('', 'string'),
        index = 0;
      for (const content of node.syntax.contents) {
        let part;
        if (content.kind === 'Interpolation') {
          const width = node.alignments?.[index],
            bound = node.parts[index++];
          if (bound.type?.typeKind === TypeKind.Enum) return this.unsupported('formatting an enum value', content);
          const format = content.formatClause ? n.literal(content.formatClause.formatStringToken.valueText, 'string') : n.nullLiteral('string');
          const alignment = content.alignmentClause ? this.alignmentOf(content.alignmentClause, width) : n.literal(0, 'int');
          part = this.interpolationHole(bound, format, alignment);
        } else part = n.literal(interpolatedText(content), 'string');
        result = n.binary('+', result, part, 'string');
      }
      return result;
    }
    /** The alignment of a hole: the constant the binder computed, else the literal as written. */
    alignmentOf(clause, width = null) {
      const value = width ?? Number(clause.value.toString().trim());
      return Number.isInteger(value) ? n.literal(value, 'int') : this.unsupported('a computed interpolation alignment', clause);
    }
    /** One formatted interpolation hole (lowering/conditional-access.js refines it for value-typed `a?.b`). */
    interpolationHole(node, format, alignment) {
      return this.formattedValue(this.expression(node), format, alignment);
    }
    formattedValue(value, format, alignment) {
      return n.frameworkCall({ contract: formatValue() }, null, [value, format, alignment, n.literal(value.legacyType, 'string')], 'string');
    }
    exprConditionalReceiver(node) {
      return this.conditionalReceiver ? this.conditionalReceiver() : this.unsupported('a null-conditional receiver', node.syntax);
    }
    exprThrow(node) {
      return this.unsupported('throw expressions in this position', node.syntax);
    }
  };

/** `ObjectCreation` -> "object creation", for diagnostics. */
function describe(kind) {
  return String(kind)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
}
