import {Builtins, BuiltinMap} from '@sharpforge/bytecode';
import {codedIndex} from './metadata.js';
import {methodSignature, methodSpecSignature} from './metadata/signature-members.js';
import {sourceMemoryTypeArgument} from './source-memory-analysis.js';
import {arrayElementType, memoryTypeName, valueTypeName} from './source-memory-types.js';

const arrayBuiltins = Builtins.filter(builtin => builtin?.arrayRuntime && !builtin.arrayRuntime.internal);
const canonical = type => memoryTypeName(type);
const same = (left, right) => left.length === right.length && left.every((type, index) => canonical(type) === canonical(right[index]));

export function decodeSourceArrayBuiltin(target) {
  const signature = target.sig;
  if (target.owner !== 'System.Array' || signature?.kind !== 'method' || signature.callingConvention ||
      signature.explicitThis || signature.sentinel != null) return null;
  return arrayBuiltins.find(builtin => {
    const descriptor = builtin.arrayRuntime;
    return target.name === descriptor.name && signature.isStatic === descriptor.isStatic &&
      (signature.genericArity ?? 0) === descriptor.genericArity && same(signature.parameters, descriptor.parameters) &&
      canonical(signature.returnType) === canonical(descriptor.returnType);
  }) ?? null;
}

export const memoryBuiltin = operation => BuiltinMap.get('$memory.' + operation);

function genericArrayCall(w, c, descriptor, types) {
  const element = arrayElementType(valueTypeName(types[0]));
  const signature = methodSignature(descriptor.returnType, descriptor.parameters, descriptor.isStatic,
    c.resolveType, {genericArity: descriptor.genericArity});
  const member = c.metadata.member(c.resolveType(descriptor.owner), descriptor.name, signature);
  const spec = c.metadata.add(43, [codedIndex('MethodDefOrRef', member),
    c.metadata.blob(methodSpecSignature([c.signatures.type(element)]))]);
  w.op('call', spec).op('ldnull');
}

function emitBridge(w, c, instruction, operation, types) {
  const {method, pc, getScratch} = instruction;
  if (operation === 'spanToArray') {
    const span = valueTypeName(types[0]), slot = getScratch(span, 998);
    w.local('stloc', slot).local('ldloca', slot).op('call', c.external(span, 'ToArray', '!0[]', [], false));
    return;
  }
  const type = sourceMemoryTypeArgument(c.image, method, pc);
  w.op('pop');
  if (operation === 'typeOf') {
    w.op('ldtoken', c.resolveType(type));
    w.op('call', c.external('System.Type', 'GetTypeFromHandle', 'System.Type', ['System.RuntimeTypeHandle']));
  } else if (operation === 'cast') w.op('castclass', c.resolveType(type));
  else if (operation === 'spanFromArray') {
    const template = type.slice(0, type.indexOf('<')) + '<!0>';
    w.op('call', c.external(type, 'op_Implicit', template, ['!0[]']));
  } else if (operation === 'spanFromString') {
    w.op('call', c.external('string', 'op_Implicit', 'System.ReadOnlySpan<char>', ['string']));
  } else throw new Error('Unknown source memory bridge');
}

export function emitSourceArrayBuiltin(w, c, instruction) {
  const {a, b, input, adapt} = instruction;
  const descriptor = Builtins[a].arrayRuntime, types = input.slice(-b);
  if (descriptor.internal) return emitBridge(w, c, instruction, descriptor.operation, types);
  if (descriptor.genericArity) return genericArrayCall(w, c, descriptor, types);
  const target = [...(descriptor.isStatic ? [] : ['System.Array']), ...descriptor.parameters];
  adapt(types, target);
  w.op(descriptor.isStatic ? 'call' : 'callvirt', c.external(descriptor.owner, descriptor.name,
    descriptor.returnType, descriptor.parameters, descriptor.isStatic));
  if (descriptor.returnType === 'void') w.op('ldnull');
}
