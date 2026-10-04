import { encodeTypeSignature, methodSignature } from '@sharpforge/cil';
import { TypeKind } from '../packages/clr/src/index.js';
import { graphContext } from './clr-types-graph-fixtures.js';
import { managedFixture } from './managed-fixtures.js';

export function arrayContext(options = {}) {
  const context = graphContext(options);
  const types = context.types;
  const object = types.intrinsic('System.Object');
  types.defineIntrinsic('System.Void', { kind: TypeKind.ValueType, baseType: types.intrinsic('System.ValueType') });
  types.defineIntrinsic('System.String', { baseType: object });
  const interfaces = ['System.ICloneable', 'System.Collections.IList', 'System.Collections.ICollection',
    'System.Collections.IEnumerable', 'System.Collections.IStructuralComparable', 'System.Collections.IStructuralEquatable']
    .map(name => types.defineIntrinsic(name, { kind: TypeKind.Interface }));
  types.defineIntrinsic('System.Array', { baseType: object, interfaces });
  for (const name of ['IEnumerable', 'ICollection', 'IList', 'IReadOnlyCollection', 'IReadOnlyList']) {
    types.defineIntrinsic(`System.Collections.Generic.${name}\`1`, { kind: TypeKind.Interface, genericArity: 1 });
  }
  return context;
}

export function arrayMembers() {
  const tokens = {};
  const image = managedFixture({ name: 'ArrayMembers', entry: null, methods: [], decorate({ md }) {
    const array = md.add(27, [md.blob(encodeTypeSignature({ kind: 'array', element: { kind: 'primitive', name: 'int' },
      rank: 2, sizes: [], lowerBounds: [] }))]);
    tokens.constructor = md.member(array, '.ctor', methodSignature('void', ['int', 'int'], false));
    tokens.boundedConstructor = md.member(array, '.ctor', methodSignature('void', ['int', 'int', 'int', 'int'], false));
    tokens.accessor = md.member(array, 'Get', methodSignature('int', ['int', 'int'], false));
    tokens.invalidConstructor = md.member(array, '.ctor', Uint8Array.of(0x25, 2, 1, 8, 8));
  } });
  return { image, ...tokens };
}
