import { signaturePrimitiveNodes } from '../metadata/signature-types.js';

const definitions = Object.create(null);

function register(names, operation, storage, elements) {
  const descriptor = Object.freeze({ operation, storage: signaturePrimitiveNodes[storage],
    elements: Object.freeze(elements.map(name => signaturePrimitiveNodes[name])) });
  for (const name of names.split(' ')) definitions[name] = descriptor;
}

// Keep storage width distinct from the intermediate stack kind (I4 and F erase it).
register('ldind.i1 ldind.u1', 'load', 'sbyte', ['bool', 'sbyte', 'byte']);
register('ldind.i2 ldind.u2', 'load', 'short', ['char', 'short', 'ushort']);
register('ldind.i4 ldind.u4', 'load', 'int', ['int', 'uint']);
register('ldind.i8', 'load', 'long', ['long', 'ulong']);
register('ldind.i', 'load', 'nint', ['nint', 'nuint']);
register('ldind.r4', 'load', 'float', ['float']);
register('ldind.r8', 'load', 'double', ['double']);
register('stind.i1', 'store', 'sbyte', ['bool', 'sbyte', 'byte']);
register('stind.i2', 'store', 'short', ['char', 'short', 'ushort']);
register('stind.i4', 'store', 'int', ['int', 'uint']);
register('stind.i8', 'store', 'long', ['long', 'ulong']);
register('stind.i', 'store', 'nint', ['nint', 'nuint']);
register('stind.r4', 'store', 'float', ['float']);
register('stind.r8', 'store', 'double', ['double']);
register('ldind.ref', 'loadReference', 'object', ['object', 'string']);
register('stind.ref', 'storeReference', 'object', ['object', 'string']);

export const memoryTransfers = Object.freeze(definitions);
