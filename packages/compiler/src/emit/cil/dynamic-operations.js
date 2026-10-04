/** Data-only call-site descriptions; emission consumes the same plan used for metadata (SF-A02-T55). */
import {
  DynamicBinderFlags as Flags, dynamicArgument, dynamicArguments, dynamicGroupReceiver, dynamicReceiver,
  isDynamicType, isDynamicBinary, isDynamicConversion, isDynamicLocation, dynamicAssignmentValue,
} from './dynamic-arguments.js';

// System.Linq.Expressions.ExpressionType values form the public runtime binder ABI.
const binaryOperations = Object.freeze({
  '+': 0, '&': 2, '/': 12, '==': 13, '^': 14, '>': 15, '>=': 16, '<<': 19,
  '<': 20, '<=': 21, '%': 25, '*': 26, '!=': 35, '|': 36, '>>': 41, '-': 42,
});
const unaryOperations = Object.freeze({ '-': 28, '+': 29, '!': 34, '--': 49, '++': 54, '~': 82 });
const compoundOperations = Object.freeze({
  '+': 63, '&': 64, '/': 65, '^': 66, '<<': 67, '%': 68, '*': 69, '|': 70, '>>': 72, '-': 73,
});

/** Description of a property/indexer store; its value retains its original static type. */
export function dynamicStore(target, value, core, { flags = 0 } = {}) {
  const index = target.kind === 'DynamicElementAccess';
  return {
    operation: index ? 'SetIndex' : 'SetMember', flags,
    name: index ? null : target.name,
    arguments: [dynamicReceiver(target.receiver, core, target.receiverRefKind), ...(index ? dynamicArguments(target.args, core) : []), value],
    returnType: core.object,
  };
}

function compound(node, core) {
  if (!isDynamicType(node.left.type) && !isDynamicType(node.operation?.type)) return [];
  const flags = node.isChecked ? Flags.CheckedContext : 0;
  const descriptions = [['value', {
    operation: 'BinaryOperation', flags, operator: compoundOperations[node.operator],
    arguments: [dynamicArgument(node.left, core), dynamicArgument(node.right, core)], returnType: core.object,
  }]];
  if (isDynamicLocation(node.left)) {
    descriptions.push(['set', dynamicStore(node.left, dynamicArgument(null, core), core, {
      flags: flags | Flags.ValueFromCompoundAssignment,
    })]);
    if (node.left.kind === 'DynamicMemberAccess' && ['+', '-'].includes(node.operator)) {
      descriptions.push(['event', {
        operation: 'IsEvent', flags: 0, name: node.left.name,
        arguments: [dynamicArgument(node.left.receiver, core)], returnType: core.bool,
      }]);
      descriptions.push(['accessor', {
        operation: 'InvokeMember', flags: Flags.InvokeSpecialName | Flags.ResultDiscarded,
        name: (node.operator === '+' ? 'add_' : 'remove_') + node.left.name, typeArguments: [],
        arguments: [dynamicArgument(node.left.receiver, core), dynamicArgument(node.right, core)], returnType: core.object,
      }]);
    }
  } else if (!isDynamicType(node.left.type)) {
    descriptions.push(['convert', {
      operation: 'Convert', flags: flags | Flags.ConvertExplicit,
      arguments: [dynamicArgument(null, core)], returnType: node.left.type,
    }]);
  }
  return descriptions;
}

function binary(node, core) {
  if (!isDynamicBinary(node)) return [];
  const logical = node.operator === '&&' || node.operator === '||';
  const flags = (node.isChecked ? Flags.CheckedContext : 0) | (logical ? Flags.BinaryOperationLogical : 0);
  const operator = logical ? binaryOperations[node.operator[0]] : binaryOperations[node.operator];
  const descriptions = [['value', {
    operation: 'BinaryOperation', flags, operator,
    arguments: [dynamicArgument(node.left, core), dynamicArgument(node.right, core)], returnType: core.object,
  }]];
  if (logical) descriptions.push(['test', {
    operation: 'UnaryOperation', flags: 0, operator: node.operator === '&&' ? 84 : 83,
    arguments: [dynamicArgument(node.left, core)], returnType: core.bool,
  }]);
  return descriptions;
}

/** Descriptor of a late-bound invocation, whose void-returning form is selected only for a discarded result. */
function invocation(node, core, context, discarded) {
  const target = node.receiver;
  const member = target.kind === 'DynamicMemberAccess' || target.kind === 'MethodGroup';
  const receiver = target.kind === 'MethodGroup' ? dynamicGroupReceiver(target, context, core)
    : member ? dynamicReceiver(target.receiver, core) : dynamicArgument(target, core);
  const simple = target.kind === 'MethodGroup' && target.invokeSimpleName;
  return {
    operation: member ? 'InvokeMember' : 'Invoke',
    flags: (discarded ? Flags.ResultDiscarded : 0) | (simple ? Flags.InvokeSimpleName : 0),
    name: member ? target.name : null,
    typeArguments: member ? target.typeArguments?.map(type => type.type ?? type) ?? [] : [],
    arguments: [receiver, ...dynamicArguments(node.args, core)],
    returnType: discarded ? core.void : core.object,
  };
}

/** The call-site variants needed by one bound expression; an absent operator is reported by the planner. */
export function dynamicOperations(node, core, context) {
  const plain = (operation, args, extras = {}) => ({ operation, flags: 0, arguments: args, returnType: core.object, ...extras });
  const checked = node.isChecked ? Flags.CheckedContext : 0;
  switch (node.kind) {
    case 'DynamicInvocation':
      return [['value', invocation(node, core, context, false)], ['effect', invocation(node, core, context, true)]];
    case 'DynamicMemberAccess':
      return [['value', plain('GetMember', [dynamicReceiver(node.receiver, core)], { name: node.name })],
        ['set', dynamicStore(node, dynamicArgument(null, core), core)]];
    case 'DynamicElementAccess':
      return [...(node.receiver.kind === 'DynamicMemberAccess' ? [['value', plain('GetMember',
        [dynamicArgument(node.receiver.receiver, core)], {
          key: node.receiver, name: node.receiver.name, flags: Flags.ResultIndexed,
        })]] : []),
      ['value', plain('GetIndex', [dynamicArgument(node.receiver, core), ...dynamicArguments(node.args, core)])],
        ['set', dynamicStore(node, dynamicArgument(null, core), core)]];
    case 'DynamicObjectCreation':
      return [['value', plain('InvokeConstructor', [dynamicArgument(null, core, { staticType: node.type }),
        ...dynamicArguments(node.args, core)], { returnType: node.type })]];
    case 'Conversion':
      return isDynamicConversion(node) ? [['value', plain('Convert', [dynamicArgument(node.operand, core)], {
        returnType: node.type, flags: checked | (node.isExplicit ? Flags.ConvertExplicit : 0),
      })]] : [];
    case 'Unary':
      return isDynamicType(node.operand.type) ? [['value', plain('UnaryOperation', [dynamicArgument(node.operand, core)], {
        operator: unaryOperations[node.operator], flags: checked,
      })]] : [];
    case 'DynamicCondition':
      return [['value', plain('UnaryOperation', [dynamicArgument(node.operand, core)], { operator: 83, returnType: core.bool })]];
    case 'Binary':
      return binary(node, core);
    case 'Assignment':
    case 'CoalesceAssignment':
      return isDynamicLocation(node.left) ? [['set', dynamicStore(node.left,
        dynamicArgument(dynamicAssignmentValue(node.right), core), core)]] : [];
    case 'CompoundAssignment':
      return compound(node, core);
    case 'Increment': {
      if (!isDynamicType(node.operand.type)) return [];
      const descriptions = [['value', plain('UnaryOperation', [dynamicArgument(node.operand, core)], {
        operator: unaryOperations[node.operator], flags: checked,
      })]];
      if (isDynamicLocation(node.operand)) descriptions.push(['set', dynamicStore(node.operand, dynamicArgument(null, core), core, {
        flags: checked | Flags.ValueFromCompoundAssignment,
      })]);
      return descriptions;
    }
    case 'ArrayCreation':
    case 'ArrayAccess':
      return (node.sizes ?? node.indices ?? []).filter(size => size.kind === 'Conversion' && isDynamicConversion(size)).map(size =>
        ['value', plain('Convert', [dynamicArgument(size.operand, core)], {
          key: size, returnType: size.type, flags: Flags.ConvertArrayIndex | (size.isChecked ? Flags.CheckedContext : 0),
        })]);
    default:
      return [];
  }
}
