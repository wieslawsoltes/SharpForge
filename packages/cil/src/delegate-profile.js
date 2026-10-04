import {frameworkType, canonicalType} from '@sharpforge/framework';
import {genericTypeParts, substituteTypeArguments} from './field-profile.js';

const signature = (parameters, returnType = 'void') => ({isStatic: false, parameters, returnType});
const key = value => JSON.stringify([!!value.isStatic, canonicalType(value.returnType), value.parameters.map(canonicalType)]);

/** Resolve the Invoke contract without requiring executable runtime delegate methods. */
export function managedDelegateSignature(inspector, name) {
  const parts = genericTypeParts(name);
  const standard = /^System\.(Action|Func)(?:`(.*))?$/.exec(parts.definition);
  if (standard) {
    if (standard[1] === 'Action' && standard[2] === undefined && !parts.arguments.length) return signature([]);
    const arity = Number(standard[2]);
    const maximum = standard[1] === 'Action' ? 16 : 17;
    if (!/^[1-9]\d*$/.test(standard[2] ?? '') || arity > maximum || arity !== parts.arguments.length ||
        parts.arguments.some(argument => !argument)) return null;
    return standard[1] === 'Action' ? signature(parts.arguments) : signature(parts.arguments.slice(0, -1), parts.arguments.at(-1));
  }
  // Validate standard names before lookup: registry aliases may otherwise repair a malformed arity.
  const framework = frameworkType(name);
  if (framework?.kind === 'delegate') return signature(framework.parameters, framework.result ?? 'void');
  const type = inspector?.types.find(type => type.name === parts.definition);
  if (!type?.baseToken || inspector.metadata.typeName(type.baseToken) !== 'System.MulticastDelegate') return null;
  const invoke = type.methods.find(method => method.name === 'Invoke');
  if (!invoke) return null;
  const original = inspector.signature(invoke.token);
  if (original.isStatic || original.genericArity || original.callingConvention) return null;
  return signature(original.parameters.map(type => substituteTypeArguments(type, parts.arguments)),
    substituteTypeArguments(original.returnType, parts.arguments));
}

/** Constructor, invocation and equality are one finite verifier/runtime contract. */
export function supportedDelegateCall(inspector, descriptor) {
  if (descriptor.name !== '.ctor' && descriptor.name !== 'Invoke' && descriptor.name !== 'Equals') return false;
  const invoke = managedDelegateSignature(inspector, descriptor.ownerInstance ?? descriptor.owner);
  const actual = descriptor.signature;
  if (actual.genericArity || actual.callingConvention) return false;
  if (invoke && descriptor.name === '.ctor') {
    return key(actual) === key(signature(['object', 'nint'])) || key(actual) === key(signature(['object', 'System.IntPtr']));
  }
  if (invoke && descriptor.name === 'Invoke') return key(actual) === key(invoke);
  const delegateOwner = invoke || ['System.Delegate', 'System.MulticastDelegate'].includes(descriptor.owner);
  return !!delegateOwner && descriptor.name === 'Equals' && key(actual) === key(signature(['object'], 'bool'));
}
