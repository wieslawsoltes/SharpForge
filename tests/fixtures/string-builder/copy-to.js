import {managedFixture} from '../../managed-fixtures.js';
import {builderType, builderContract} from './append-char.js';

export const copyParameters = ['int', 'char[]', 'int', 'int'];
export const copyArguments = (row, destination) => [row.sourceIndex, destination, row.destinationIndex, row.count];

export function copyBuilderTo(platform, reference, destination, range) {
  return platform.invoke(builderContract('CopyTo', copyParameters), [reference, ...copyArguments(range, destination)]);
}

/** Ordinary CIL constructs native char arrays and calls the exact CopyTo signature without source emission. */
export function builderCopyAssembly(row) {
  return managedFixture({fields: [{name: 'Builder', type: builderType}, {name: 'Destination', type: 'char[]'}],
    methods: [{name: 'Main', result: 'void', maxStack: 5, body(writer, context) {
      const builder = 0x04000000 | context.fields.Builder;
      const destination = 0x04000000 | context.fields.Destination;
      if (row.nullReceiver) writer.op('ldnull');
      else writer.op('newobj', context.member(builderType, '.ctor', 'void', [], false));
      writer.op('stsfld', builder);
      if (!row.nullReceiver) for (const segment of row.segments) {
        writer.op('ldsfld', builder).op('ldstr', 0x70000000 + context.md.userString(String.fromCharCode(...segment)));
        writer.op('callvirt', context.member(builderType, 'Append', builderType, ['string'], false)).op('pop');
      }
      if (row.destinationLength === null) writer.op('ldnull');
      else writer.op('ldc.i4', row.destinationLength).op('newarr', context.resolve('System.Char'));
      writer.op('stsfld', destination);
      for (let index = 0; index < (row.destinationLength ?? 0); index++) {
        writer.op('ldsfld', destination).op('ldc.i4', index).op('ldc.i4', 46).op('stelem.i2');
      }
      writer.op('ldsfld', builder).op('ldc.i4', row.sourceIndex).op('ldsfld', destination);
      writer.op('ldc.i4', row.destinationIndex).op('ldc.i4', row.count);
      writer.op('callvirt', context.member(builderType, 'CopyTo', 'void', copyParameters, false)).op('ret');
    }}]});
}
