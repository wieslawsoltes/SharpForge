import { codedIndex } from '@sharpforge/cil';
import { AssemblyLoadSession, TypeKind } from '../packages/clr/src/index.js';
import { managedFixture } from './managed-fixtures.js';

/** Explicit small test BCL; production framework registration remains a separate work item. */
export function graphContext(options = {}) {
  let types;
  const context = new AssemblyLoadSession().createContext({ ...options, typeOptions: {
    resolveExternalType({ assemblyName, namespace, name }) {
      return assemblyName.name === 'System.Runtime' ? types.intrinsic(`${namespace}.${name}`) : null;
    }, ...options.typeOptions,
  } });
  types = context.types;
  const object = types.defineIntrinsic('System.Object');
  const value = types.defineIntrinsic('System.ValueType', { baseType: object });
  const interfaces = ['IComparable', 'ISpanFormattable', 'IFormattable', 'IConvertible']
    .map(name => types.defineIntrinsic(`System.${name}`, { kind: TypeKind.Interface }));
  types.defineIntrinsic('System.Enum', { baseType: value, interfaces });
  for (const name of ['SByte', 'Byte', 'Int16', 'UInt16', 'Int32', 'UInt32', 'Int64', 'UInt64']) {
    types.defineIntrinsic(`System.${name}`, { kind: TypeKind.ValueType, baseType: value });
  }
  return context;
}

export function cyclicGraph() {
  return managedFixture({ name: 'CyclicTypes', entry: null, methods: [], decorate({ md }) {
    const next = md.add(2, [1, md.string('Next'), md.string('Fixture'), codedIndex('TypeDefOrRef', 0x02000002), 1, 1]);
    md.rows[2][1][3] = codedIndex('TypeDefOrRef', next);
  } });
}
