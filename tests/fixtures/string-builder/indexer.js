import {managedFixture} from '../../managed-fixtures.js';
import {builderPlatform, builderType, builderContract} from './append-char.js';

export const indexerParameters = row => row.write ? ['int', 'char'] : ['int'];
export const indexerName = row => row.write ? 'set_Chars' : 'get_Chars';
export const indexerArguments = row => row.write ? [row.index, row.value] : [row.index];

/** Build the same sequence of appended segments without exposing storage to the test caller. */
export function segmentedBuilder(engine, segments = ['ab', '\0', '\ud800', 'cd\udc00']) {
  const builder = builderPlatform(engine, '');
  const {platform, reference, call} = builder;
  platform.heap.withRoots([reference], () => {
    for (const segment of segments) call('Append', ['string'], [platform.heap.string(segment)]);
  });
  return builder;
}

/** Independent ordinary CIL calls native Chars accessors, preserving the builder after a setter fault. */
export function builderIndexerAssembly(row) {
  return managedFixture({fields: [{name: 'Builder', type: builderType}],
    methods: [{name: 'Main', result: row.write ? 'void' : 'char', maxStack: 3, body(writer, context) {
      const field = 0x04000000 | context.fields.Builder;
      if (row.segments === null) writer.op('ldnull');
      else writer.op('newobj', context.member(builderType, '.ctor', 'void', [], false));
      writer.op('stsfld', field);
      for (const segment of row.segments ?? []) {
        writer.op('ldsfld', field).op('ldstr', 0x70000000 + context.md.userString(String.fromCharCode(...segment)));
        writer.op('callvirt', context.member(builderType, 'Append', builderType, ['string'], false)).op('pop');
      }
      writer.op('ldsfld', field).op('ldc.i4', row.index);
      if (row.write) writer.op('ldc.i4', row.value).op('conv.u2');
      writer.op('callvirt', context.member(builderType, indexerName(row), row.write ? 'void' : 'char', indexerParameters(row), false));
      writer.op('ret');
    }}]});
}

export function invokeIndexer(platform, reference, row) {
  return platform.invoke(builderContract(indexerName(row), indexerParameters(row)), [reference, ...indexerArguments(row)]);
}
