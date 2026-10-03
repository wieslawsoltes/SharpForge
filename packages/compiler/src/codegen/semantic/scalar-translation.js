/** Exact scalar values and runtime profiles for the semantic lowering path. */
import {Builtins, numericTypeNames, decimalFromBits} from '@sharpforge/bytecode';
import {numeric, constantValue, numericDefault} from '../../numeric.js';
import {scalarStringBuiltin} from '../../scalar-queries.js';
import {findContracts} from '@sharpforge/framework';
import {n} from './node-factory.js';

const numericKinds = new Set(['ImplicitNumeric', 'ExplicitNumeric', 'ImplicitConstant', 'IntPtr',
  'ImplicitEnumeration', 'ExplicitEnumeration']);
const native = type => ['System_IntPtr', 'System_UIntPtr'].includes(type?.specialType);

function dependsOnNative(node) {
  return !!node && (native(node.type) || ['operand', 'left', 'right', 'whenTrue', 'whenFalse']
    .some(key => node[key] && dependsOnNative(node[key])));
}

export function scalarConstantValue(value, type) {
  let raw = value?.value ?? value;
  if (type === 'decimal' && raw?.toBits) raw = decimalFromBits(raw.toBits());
  return numeric(type) ? constantValue(raw, type) : raw;
}

function runtimeBuiltin(method) {
  const definition = method?.originalDefinition ?? method;
  return method?.builtin ?? definition?.builtin;
}

function profileCall(translator, node, method, creation = false) {
  const builtin = runtimeBuiltin(method);
  if (!(builtin?.numeric || builtin?.arrayRuntime || builtin?.synchronization)) return null;
  const descriptor = builtin.numeric ?? builtin.arrayRuntime ?? builtin.synchronization;
  const args = translator.arguments(node, method);
  const receiver = !descriptor.isStatic && !creation && node.receiver ? translator.expression(node.receiver) : null;
  const type = creation ? translator.imageType(node.type, node.syntax) : translator.imageType(method.returnType, node.syntax);
  if (creation) return {kind: 'ObjectCreationExpression', legacyType: type, isExpression: true, type: {},
    constructorMethod: {builtin}, args, initializers: [], collectionInitializers: []};
  // Console/Convert object overloads preserve native signedness through the declared format profile.
  const argumentType = args[0]?.legacyType;
  const formatted = builtin.numeric && ['nint', 'nuint'].includes(argumentType) && args.length === 1 &&
    ['System.Console', 'System.Convert'].includes(descriptor.owner) ? Builtins.find(entry => entry?.numeric?.owner === descriptor.owner &&
      entry.numeric.name === descriptor.name && entry.numeric.formatType === argumentType) : null;
  return n.frameworkCall({builtin: formatted ?? builtin}, receiver, args, type);
}

/** Outer mixin leaves source control and ref-argument handling in their respective translators. */
export const ScalarTranslation = Base => class extends Base {
  constant(node) {
    const value = node.constantValue;
    if (!value || node.kind === 'Lambda' || dependsOnNative(node)) return null;
    const type = node.type ? this.imageType(node.type, node.syntax) : null;
    if (type && numeric(type) && !value.isEnum) return n.literal(scalarConstantValue(value, type), type);
    return super.constant(node);
  }

  defaultValue(type) {
    return numeric(type) ? n.literal(numericDefault(type), type) : super.defaultValue(type);
  }

  defaultArgument(parameter, node) {
    if (node.callerInfo?.has(parameter.ordinal) || parameter.defaultSyntax && !parameter.defaultBound) {
      return super.defaultArgument(parameter, node);
    }
    const type = this.imageType(parameter.type, node.syntax);
    if (!numeric(type)) return super.defaultArgument(parameter, node);
    const value = parameter.explicitDefaultValue ?? parameter.defaultValue;
    return value === undefined || value === null ? this.defaultValue(type) : n.literal(scalarConstantValue(value, type), type);
  }

  exprCall(node) {
    return profileCall(this, node, node.method) ?? super.exprCall(node);
  }

  frameworkCreation(node) {
    if (this.imageType(node.type, node.syntax) === 'decimal' && !(node.args?.length)) return this.defaultValue('decimal');
    return profileCall(this, node, node.constructor, true) ?? super.frameworkCreation(node);
  }

  frameworkInvocation(node, method) {
    const profiled = profileCall(this, node, method);
    if (profiled) return profiled;
    if (method.name === 'ToString' && !method.parameters.length && node.receiver) {
      const value = this.expression(node.receiver), builtin = scalarStringBuiltin(value.legacyType);
      if (builtin) return n.frameworkCall({builtin}, null, [value], 'string');
    }
    return super.frameworkInvocation(node, method);
  }

  propertyReference(node) {
    const getter = node.property.getMethod;
    if (runtimeBuiltin(getter)?.numeric || runtimeBuiltin(getter)?.arrayRuntime) {
      return profileCall(this, {...node, args: []}, getter);
    }
    return super.propertyReference(node);
  }

  exprUnary(node) {
    if (!node.isLifted && numeric(this.imageType(node.type, node.syntax)) &&
      numeric(this.imageType(node.operand.type, node.syntax))) {
      return n.unary(node.operator, this.expression(node.operand), this.imageType(node.type), !!node.isChecked);
    }
    return super.exprUnary(node);
  }

  exprBinary(node) {
    const leftType = this.imageType(node.left.type, node.syntax), rightType = this.imageType(node.right.type, node.syntax);
    if (!node.isLifted && numeric(leftType) && numeric(rightType)) {
      return n.binary(node.operator, this.expression(node.left), this.expression(node.right),
        this.imageType(node.type), !!node.isChecked);
    }
    if (node.operator === '+' && (leftType === 'string' || rightType === 'string')) {
      const text = operand => {
        const value = this.expression(operand), builtin = scalarStringBuiltin(value.legacyType);
        return builtin ? n.frameworkCall({builtin}, null, [value], 'string') : value;
      };
      return n.binary('+', text(node.left), text(node.right), 'string');
    }
    return super.exprBinary(node);
  }

  exprCompoundAssignment(node) {
    return numeric(this.imageType(node.left.type, node.syntax)) ? this.assignStatic(node.left,
      n.compoundAssign(node.operator, this.target(node.left), this.expression(node.right), !!node.isChecked)) :
      super.exprCompoundAssignment(node);
  }

  exprIncrement(node) {
    return numeric(this.imageType(node.operand.type, node.syntax)) ? this.assignStatic(node.operand,
      n.increment(node.operator, this.target(node.operand), !!node.isPostfix, !!node.isChecked)) : super.exprIncrement(node);
  }

  exprConversion(node) {
    const kind = node.conversion?.kind;
    if (numericKinds.has(kind)) {
      const type = this.imageType(node.type, node.syntax), value = this.expression(node.operand);
      return value.legacyType === type ? value : n.convert(value, type, !!node.isChecked);
    }
    return super.exprConversion(node);
  }

  userDefinedConversion(node) {
    const type = this.imageType(node.type, node.syntax), from = this.imageType(node.operand.type, node.syntax);
    if (numeric(type) && numeric(from)) return n.convert(this.expression(node.operand), type, !!node.isChecked);
    return super.userDefinedConversion(node);
  }

  contractArguments(contract, args) {
    if (!contract) return args;
    return args.map((value, index) => {
      if (contract.parameters[index] !== 'object' || !numericTypeNames.includes(value.legacyType)) {
        return super.contractArguments({parameters: [contract.parameters[index]]}, [value])[0];
      }
      const boxing = findContracts('SharpForge.Runtime.Formatting', 'BoxValue', true)[0];
      return n.frameworkCall({contract: boxing}, null, [value, n.literal(value.legacyType, 'string')], 'object');
    });
  }
};
