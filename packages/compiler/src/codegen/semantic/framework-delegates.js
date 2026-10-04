import {frameworkType, findContracts} from '@sharpforge/framework';
import {n} from './node-factory.js';

/** Native framework delegates keep the source method and receiver as their identity. */
export function delegateInfo(translator, type, syntax, frameworkType) {
  if (!frameworkType) return translator.g.delegates.classOf(type, syntax);
  const invoke = type.delegateInvokeMethod;
  if (!invoke || invoke.parameters.some(parameter => parameter.refKind && parameter.refKind !== 'none'))
    return translator.unsupported('this framework delegate signature', syntax);
  return {frameworkType, returnType: translator.imageType(invoke.returnType, syntax),
    parameters: invoke.parameters.map(parameter => ({name: parameter.name, type: translator.imageType(parameter.type, syntax)}))};
}

/** Direct conversions avoid constructing an unrelated source delegate wrapper. */
export function frameworkDelegateValue(translator, node, type) {
  if (node.constantValue?.isNull || node.kind === 'Literal' && node.literal === 'null') return n.nullLiteral(type);
  if (node.kind === 'DelegateCreation') return frameworkDelegateValue(translator, node.operand, type);
  if (node.kind === 'Conversion' && ['Identity', 'ImplicitReference'].includes(node.conversion?.kind))
    return frameworkDelegateValue(translator, node.operand, type);
  if (node.kind === 'Lambda') return translator.lambda(node, node.boundAs ?? node.type, type);
  if (node.kind === 'Conversion' && node.conversion?.kind === 'AnonymousFunction') return translator.lambda(node.operand, node.type, type);
  if (node.kind === 'Conversion' && node.conversion?.kind === 'MethodGroup') {
    return translator.methodGroupDelegate(node, type);
  }
  const value = translator.expression(node);
  return value.legacyType === type ? value
    : translator.unsupported('incompatible delegate type at a framework boundary', node.syntax);
}

/** Framework delegate variables use the same representation as callback parameters. */
export function registeredDelegateInfo(generator, type, syntax) {
  if (generator.isSource(type)) return null;
  const name = generator.bridge.registryName(type) ?? type.registryName ?? generator.frameworkConstructions.imageTypeOf(type);
  const definition = frameworkType(name);
  if (definition?.kind !== 'delegate') return null;
  const invoke = type.delegateInvokeMethod;
  if (!invoke || invoke.parameters.some(parameter => parameter.refKind && parameter.refKind !== 'none'))
    return generator.unsupported('this framework delegate signature', syntax);
  return {type, frameworkType: definition.name, record: {name: definition.name},
    returnType: definition.result, parameters: definition.parameters.map((parameter, index) =>
      ({name: invoke.parameters[index]?.name ?? 'arg' + index, type: parameter}))};
}

export function frameworkDelegateCall(info, operation, args) {
  const invoke = operation === 'Invoke', owner = invoke ? info.frameworkType : 'System.Delegate';
  const contract = findContracts(owner, operation, !invoke)[0];
  if (!contract) throw new Error('Missing framework delegate operation ' + operation);
  return n.frameworkCall({contract}, invoke ? args[0] : null, invoke ? args.slice(1) : args,
    invoke ? info.returnType : operation === 'op_Equality' ? 'bool' : info.frameworkType);
}
