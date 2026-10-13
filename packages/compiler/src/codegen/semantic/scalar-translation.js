import {findContracts} from '@sharpforge/framework';
import {isScalarType, extendedScalar, scalarImageConstant, scalarDefault} from '../scalar-values.js';
import {isTupleElement} from '../../lowering/tuples/locations.js';
import {n} from './node-factory.js';

const numericKinds = new Set(['ImplicitNumeric', 'ExplicitNumeric', 'ImplicitConstant', 'IntPtr']);
const native = type => ['System_IntPtr', 'System_UIntPtr'].includes(type?.specialType);
function dependsOnNative(node) {
  return !!node && (native(node.type) || ['operand', 'left', 'right', 'whenTrue', 'whenFalse']
    .some(key => node[key] && dependsOnNative(node[key])));
}

function formatted(value) {
  const contract = findContracts('SharpForge.Runtime.Formatting', 'FormatValue', true)[0];
  return n.frameworkCall({contract}, null, [value, n.literal('', 'string'), n.literal(0, 'int'),
    n.literal(value.legacyType, 'string')], 'string');
}

/** Preserve the binder's numeric decisions in source IR, including captured and synthesized values. */
export const ScalarTranslation = Base => class extends Base {
  constant(node) {
    const value = node.constantValue;
    if (!value || node.kind === 'Lambda' || dependsOnNative(node)) return null;
    const type = node.type ? this.imageType(node.type, node.syntax) : null;
    return isScalarType(type) && !value.isEnum ? n.literal(scalarImageConstant(value, type), type) : super.constant(node);
  }

  defaultValue(type) {
    return isScalarType(type) ? n.literal(scalarDefault(type), type) : super.defaultValue(type);
  }

  defaultArgument(parameter, node) {
    if (node.callerInfo?.has(parameter.ordinal) || parameter.defaultSyntax && !parameter.defaultBound) {
      return super.defaultArgument(parameter, node);
    }
    const type = this.imageType(parameter.type, node.syntax);
    if (!isScalarType(type)) return super.defaultArgument(parameter, node);
    const value = parameter.explicitDefaultValue ?? parameter.defaultValue;
    return value == null ? this.defaultValue(type) : n.literal(scalarImageConstant(value, type), type);
  }

  exprUnary(node) {
    // A lifted operator has nullable operands: the general path lowers it, and mapping its types here would reject them.
    if (node.isLifted) return super.exprUnary(node);
    const type = this.imageType(node.type, node.syntax);
    if (isScalarType(type) && isScalarType(this.imageType(node.operand.type, node.syntax))) {
      return n.unary(node.operator, this.expression(node.operand), type, !!node.isChecked);
    }
    return super.exprUnary(node);
  }

  exprBinary(node) {
    if (node.isLifted) return super.exprBinary(node);
    const left = this.imageType(node.left.type, node.syntax), right = this.imageType(node.right.type, node.syntax);
    if (isScalarType(left) && isScalarType(right)) {
      return n.binary(node.operator, this.expression(node.left), this.expression(node.right), this.imageType(node.type), !!node.isChecked);
    }
    // Only a concatenation with a wider scalar is formatted here: the general path knows how tuples, records and the
    // other operands turn into text.
    if (node.operator === '+' && (left === 'string' || right === 'string') && (extendedScalar(left) || extendedScalar(right))) {
      const text = operand => {
        const value = this.expression(operand);
        return extendedScalar(value.legacyType) ? formatted(value) : value;
      };
      return n.binary('+', text(node.left), text(node.right), 'string');
    }
    return super.exprBinary(node);
  }

  // int and double keep the general path: it lowers the targets that need temporaries (array elements, indexers,
  // members of a?.b). The direct form is for the wider scalar types, which that path does not know.
  exprCompoundAssignment(node) {
    const target = node.left;
    if (isTupleElement(target) || this.needsExplicitStore(node, target) || this.isFlatAccess(target)) {
      return super.exprCompoundAssignment(node);
    }
    return extendedScalar(this.imageType(target.type, node.syntax)) ? this.assignStatic(target,
      n.compoundAssign(node.operator, this.target(node.left), this.expression(node.right), !!node.isChecked)) : super.exprCompoundAssignment(node);
  }

  exprIncrement(node) {
    const target = node.operand;
    if (isTupleElement(target) || this.needsExplicitStore(node, target) || this.isFlatAccess(target)) {
      return super.exprIncrement(node);
    }
    return extendedScalar(this.imageType(target.type, node.syntax)) ? this.assignStatic(target,
      n.increment(node.operator, this.target(node.operand), !!node.isPostfix, !!node.isChecked)) : super.exprIncrement(node);
  }

  exprConversion(node) {
    if (numericKinds.has(node.conversion?.kind)) {
      const type = this.imageType(node.type, node.syntax), value = this.expression(node.operand);
      return value.legacyType === type ? value : n.convert(value, type, !!node.isChecked);
    }
    return super.exprConversion(node);
  }

  userDefinedConversion(node) {
    const type = this.imageType(node.type, node.syntax), from = this.imageType(node.operand.type, node.syntax);
    return isScalarType(type) && isScalarType(from) ? n.convert(this.expression(node.operand), type, !!node.isChecked)
      : super.userDefinedConversion(node);
  }

  box(operand, node) {
    const type = this.imageType(operand.type, node.syntax);
    if (!extendedScalar(type)) return super.box(operand, node);
    const contract = findContracts('SharpForge.Runtime.Formatting', 'BoxValue', true)[0];
    return n.frameworkCall({contract}, null, [this.expression(operand), n.literal(type, 'string')], 'object');
  }

  frameworkInvocation(node, method) {
    if (method.name === 'ToString' && !method.parameters.length && node.receiver) {
      const value = this.expression(node.receiver);
      if (isScalarType(value.legacyType)) return formatted(value);
    }
    const result = super.frameworkInvocation(node, method);
    if (['Console.Write', 'Console.WriteLine'].includes(result.intrinsic?.name) && result.args.length === 1 &&
        extendedScalar(result.args[0].legacyType)) result.args[0] = formatted(result.args[0]);
    return result;
  }
};
