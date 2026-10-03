import { TypeKind } from '../packages/clr/src/index.js';
import { arrayContext } from './clr-types-array-fixtures.js';

export async function assignabilityFixture(image) {
  const context = arrayContext();
  const types = context.types;
  const module = (await context.loadFromStream(image)).manifestModule;
  const entries = new Map();
  const definitions = { root: 'IRoot', childInterface: 'IChild', base: 'Base', child: 'Child', unrelated: 'Unrelated', pair: 'Pair', enum: 'Code' };
  for (const [name, definition] of Object.entries(definitions)) entries.set(name, await types.find(module, `Fixture.${definition}`));
  const primitives = { object: 'Object', string: 'String', int: 'Int32', uint: 'UInt32', long: 'Int64', byte: 'Byte', sbyte: 'SByte',
    ushort: 'UInt16', ValueType: 'ValueType', Array: 'Array' };
  for (const [name, primitive] of Object.entries(primitives)) entries.set(name, types.intrinsic(`System.${primitive}`));
  for (const [name, primitive] of [['bool', 'Boolean'], ['char', 'Char']]) entries.set(name,
    types.defineIntrinsic(`System.${primitive}`, { kind: TypeKind.ValueType, baseType: entries.get('ValueType') }));
  for (const name of ['object', 'string', 'int', 'uint', 'long', 'byte', 'sbyte', 'bool', 'char', 'ushort', 'enum', 'base', 'child']) {
    entries.set(`${name}[]`, types.szArray(entries.get(name)));
  }
  entries.set('int[*]', types.array(entries.get('int'), 1));
  entries.set('base[,]', types.array(entries.get('base'), 2));
  entries.set('child[,]', types.array(entries.get('child'), 2));
  entries.set('child[,,]', types.array(entries.get('child'), 3));
  for (const [contract, element] of [['IList', 'int'], ['IList', 'uint'], ['IList', 'object'], ['IReadOnlyList', 'object']]) {
    entries.set(`${contract}<${element}>`, entries.get(`${element}[]`).interfaces.find(type =>
      type.genericDefinition === types.intrinsic(`System.Collections.Generic.${contract}\`1`)));
  }
  return { context, types, module, entries };
}
