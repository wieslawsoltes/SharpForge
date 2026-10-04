/** Runtime-binding descriptions required by foreach, using and await (SF-A02-T55). */
import { DynamicBinderFlags as Flags, dynamicArgument, dynamicReceiver, isDynamicType } from './dynamic-arguments.js';

function convert(argument, returnType, flags = 0) {
  return { operation: 'Convert', flags, arguments: [argument], returnType };
}

function usingOperations(node, core) {
  const type = node.isAwait ? core.iasyncDisposable : core.idisposable;
  const resources = node.kind === 'LocalDeclaration' ? node.declarations : node.resources;
  if (!Array.isArray(resources)) return isDynamicType(resources?.type)
    ? [['dispose', convert(dynamicArgument(resources, core), type)]] : [];
  return resources.filter(resource => isDynamicType(resource.local?.type)).map(resource => {
    const expression = { kind: 'Local', local: resource.local, type: resource.local.type, syntax: node.syntax };
    return ['dispose', { ...convert(dynamicArgument(expression, core), type), key: resource }];
  });
}

function awaitOperations(node, core) {
  if (!node.isDynamic) return [];
  const argument = dynamicArgument(null, core);
  const invoke = (name, operands, discarded = false) => ({
    operation: 'InvokeMember', name, typeArguments: [], flags: discarded ? Flags.ResultDiscarded : 0,
    arguments: operands, returnType: discarded ? core.void : core.object,
  });
  const descriptions = [
    ['completed', { operation: 'GetMember', name: 'IsCompleted', flags: 0, arguments: [argument], returnType: core.object }],
    ['completedBool', convert(argument, core.bool)],
    ['result', invoke('GetResult', [argument])],
    ['resultEffect', invoke('GetResult', [argument], true)],
  ];
  if (!node.awaitable?.getAwaiter) descriptions.unshift(['awaiter', invoke('GetAwaiter', [dynamicReceiver(node.operand, core)])]);
  return descriptions;
}

/** The auxiliary call sites of one control-flow node. */
export function dynamicControlOperations(node, core) {
  if (node.kind === 'Await') return awaitOperations(node, core);
  if (node.kind === 'Using' || (node.kind === 'LocalDeclaration' && node.isUsing)) return usingOperations(node, core);
  if (node.kind !== 'ForEach' || !isDynamicType(node.collection?.type)) return [];
  const descriptions = [['enumerable', convert(dynamicArgument(node.collection, core), core.ienumerable)]];
  if (node.local && !isDynamicType(node.local.type) && node.local.type.specialType !== 'System_Object')
    descriptions.push(['element', convert(dynamicArgument(null, core), node.local.type, Flags.ConvertExplicit)]);
  return descriptions;
}
