import {
  Op
} from '@sharpforge/bytecode';
import {
  CilWriter
} from '../opcodes.js';
import {
  codedIndex
} from '../metadata.js';

/** Value ownership is recovered from CLI metadata, never from executable debug payloads. */
export function sourceTypeBase(context, descriptor, objectToken) {
  if (descriptor.name === '<Module>' || descriptor.original?.interface) return 0;
  const base = descriptor.original?.valueType ? context.resolveType('System.ValueType') : objectToken;
  return codedIndex('TypeDefOrRef', base);
}

export function sourceValueType(context, name) {
  context.sourceValueTypes ??= new Set(context.image.types.filter(type => type.valueType).map(type => type.name));
  return context.sourceValueTypes.has(name);
}

function initializeReceiver(context, writer, descriptor) {
  writer.local('ldarg', 0);
  if (descriptor.type.original?.valueType) writer.op('initobj', descriptor.type.token);
  else writer.op('call', context.external('object', '.ctor', 'void', [], false));
}

/** Shared constructor scaffolding initializes value storage without an Object constructor call. */
export function emitSourceHelper(context, descriptor) {
  const writer = new CilWriter();
  let maxStack = 2;
  if (descriptor.helper === 'allocate') {
    initializeReceiver(context, writer, descriptor);
    writer.op('ret');
  } else if (descriptor.helper === 'constructor') {
    initializeReceiver(context, writer, descriptor);
    const initializer = descriptor.type.original.initializer;
    if (initializer !== undefined) writer.local('ldarg', 0).op('call', context.methodTokens.get(initializer));
    if (descriptor.ctor) {
      writer.local('ldarg', 0);
      descriptor.parameters.forEach((parameter, index) => writer.local('ldarg', index + 1));
      writer.op('call', context.methodTokens.get(descriptor.ctor.id));
      maxStack = Math.max(2, descriptor.parameters.length + 1);
    }
    writer.op('ret');
  } else if (descriptor.helper === 'assert') {
    writer.local('ldarg', 0);
    const branch = writer.length;
    writer.op('brtrue', 0).local('ldarg', 1)
      .op('newobj', context.external('Exception', '.ctor', 'void', ['string'], false)).op('throw');
    const done = writer.length;
    writer.op('ret');
    writer.patch32(branch + 1, done - (branch + 5));
  }
  return {
    code: writer.finish(),
    locals: [],
    maxStack,
    handlers: []
  };
}

export function emitSourceValueInstruction(writer, context, {
  op,
  a
}) {
  if (op !== Op.BOX && op !== Op.UNBOXANY) return false;
  writer.op(op === Op.BOX ? 'box' : 'unbox.any', context.resolveType(context.image.constants[a])).op('nop');
  return true;
}
