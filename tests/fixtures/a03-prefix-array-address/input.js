import { methodSignature } from '@sharpforge/cil';
import { managedFixture } from '../../managed-fixtures.js';

function addressMethod(name, { element = 'int', rank = 2, vector = false, target = 'call', get = false, store = false } = {}) {
  const arrayName = element + (vector ? '[]' : '[' + ','.repeat(rank - 1) + ']');
  return { name, parameters: [arrayName], result: store ? 'void' : element, body(writer, context) {
    const type = vector ? { kind: 'szarray', element: { kind: 'primitive', name: element } }
      : { kind: 'array', element: { kind: 'primitive', name: element }, rank, sizes: [], lowerBounds: [] };
    const array = context.md.typeSpec(type);
    const member = context.md.member(array, get ? 'Get' : 'Address',
      methodSignature(get ? element : element + '&', Array(rank).fill('int'), false, context.resolve));
    writer.op('ldarg.0');
    for (let index = 0; index < rank; index++) writer.op('ldc.i4.0');
    writer.group(target, member, [{ name: 'readonly.' }]);
    if (store) writer.op('ldc.i4.0').op('stind.i4');
    else if (!get) writer.op(element === 'string' ? 'ldind.ref' : 'ldind.i4');
    writer.op('ret');
  } };
}

export const cases = [
  { method: addressMethod('MatrixAddress'), diagnostic: null },
  { method: addressMethod('MatrixVirtualAddress', { target: 'callvirt' }), diagnostic: null },
  { method: addressMethod('VectorAddress', { vector: true, rank: 1 }), diagnostic: null },
  { method: addressMethod('ThreeDimensionAddress', { rank: 3 }), diagnostic: null },
  { method: addressMethod('ReferenceAddress', { element: 'string' }), diagnostic: null },
  { method: addressMethod('ReadonlyGet', { get: true }), diagnostic: 'CILPC0006' },
  // This remains a deliberately unverified typed-store case, with the native decision retained.
  { method: addressMethod('ReadonlyStore', { store: true }), diagnostic: null },
];

export function prefixTypeFixture() {
  return managedFixture({ name: 'ArrayAddressPrefixes', entry: null, methods: cases.map(value => value.method) });
}
