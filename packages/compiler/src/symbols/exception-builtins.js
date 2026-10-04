import {
  Builtins
} from '@sharpforge/bytecode';
import {
  exceptionTypeName
} from './exception-identity.js';

const primitiveNames = new Map([
  ['System.String', 'string'],
  ['System.Int32', 'int'],
  ['System.Boolean', 'bool'],
  ['System.Object', 'object'],
  ['System.Void', 'void']
]);
const typeName = type => primitiveNames.get(type.toDisplayString()) ?? exceptionTypeName(type);
const signature = (owner, name, parameters) => owner + '::' + name + '(' + parameters.join(',') + ')';
const bySignature = new Map();
for (const builtin of Builtins) {
  const descriptor = builtin?.exceptionRuntime;
  if (descriptor) bySignature.set(signature(descriptor.owner, descriptor.name, descriptor.parameters), builtin);
}

/** Keep the binder's hierarchy, overloads and parameter names; attach execution only to exact admitted signatures. */
export function attachExceptionBuiltins(type) {
  const owner = exceptionTypeName(type);
  for (const member of type.getMembers()) {
    if (member.kind !== 'Method' || member.builtin || member.contract) continue;
    const key = signature(owner, member.name, member.parameters.map(parameter => typeName(parameter.type)));
    const builtin = bySignature.get(key);
    if (builtin) member.builtin = builtin;
  }
}
