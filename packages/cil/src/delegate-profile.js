import {frameworkType, canonicalType} from '@sharpforge/framework';
import {genericTypeParts, substituteTypeArguments} from './field-profile.js';

const signature = (parameters, returnType = 'void') => ({isStatic: false, parameters, returnType});
const key = value => JSON.stringify([!!value.isStatic, canonicalType(value.returnType), value.parameters.map(canonicalType)]);

/** Resolve the Invoke contract without requiring executable runtime delegate methods. */
export function managedDelegateSignature(inspector, name) {
  const framework = frameworkType(name);
  if (framework?.kind === 'delegate') return signature(framework.parameters, framework.result ?? 'void');
  const parts = genericTypeParts(name);
  const arity = Number(parts.definition.split('`')[1]);
  if (parts.definition === 'System.Action' && !parts.arguments.length) return signature([]);
  if (/^System.Action`\d+$/.test(parts.definition) && arity === parts.arguments.length) return signature(parts.arguments);
  if (/^System.Func`\d+$/.test(parts.definition) && arity === parts.arguments.length && arity > 0) {
    return signature(parts.arguments.slice(0, -1), parts.arguments.at(-1));
  }
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
