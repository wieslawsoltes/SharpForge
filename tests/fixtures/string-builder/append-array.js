import {managedFixture} from '../../managed-fixtures.js';
import {builderType} from './append-char.js';

export const arrayParameters = row => row.startIndex === null ? ['char[]'] : ['char[]', 'int', 'int'];
export const arrayArguments = (row, value) => row.startIndex === null ? [value] : [value, row.startIndex, row.count];

export function managedCharacters(platform, units) {
  return units === null ? null : platform.heap.allocate('array', 'char[]', [...units]);
}

/** Emit ordinary char-array allocation/stores and exact native Append member references. */
export function builderArrayAssembly(row) {
  return managedFixture({fields: [{name: 'Builder', type: builderType}, {name: 'Same', type: 'bool'}, {name: 'Value', type: 'char[]'}],
    methods: [{name: 'Main', result: 'void', maxStack: 4, body(writer, context) {
      const builder = 0x04000000 | context.fields.Builder;
      const value = 0x04000000 | context.fields.Value;
      if (row.nullReceiver) writer.op('ldnull');
      else writer.op('ldstr', 0x70000000 + context.md.userString(String.fromCharCode(...row.initial)))
        .op('newobj', context.member(builderType, '.ctor', 'void', ['string'], false));
      writer.op('stsfld', builder);
      if (row.value === null) writer.op('ldnull');
      else writer.op('ldc.i4', row.value.length).op('newarr', context.resolve('System.Char'));
      writer.op('stsfld', value);
      for (let index = 0; index < (row.value?.length ?? 0); index++) {
        writer.op('ldsfld', value).op('ldc.i4', index).op('ldc.i4', row.value[index]).op('stelem.i2');
      }
      writer.op('ldsfld', builder).op('ldsfld', value);
      if (row.startIndex !== null) writer.op('ldc.i4', row.startIndex).op('ldc.i4', row.count);
      writer.op('callvirt', context.member(builderType, 'Append', builderType, arrayParameters(row), false));
      writer.op('ldsfld', builder).op('ceq').op('stsfld', 0x04000000 | context.fields.Same).op('ret');
    }}]});
}
