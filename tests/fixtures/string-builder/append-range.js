import {managedFixture} from '../../managed-fixtures.js';
import {builderType} from './append-char.js';

export const rangeParameters = ['string', 'int', 'int'];
export const rangeText = row => row.value === null ? null : String.fromCharCode(...row.value);

/** Call the ordinary string-range signature, without source lowering or synthetic builtins. */
export function builderRangeAssembly(row, initial) {
  return managedFixture({fields: [{name: 'Builder', type: builderType}, {name: 'Same', type: 'bool'}],
    methods: [{name: 'Main', result: 'void', maxStack: 4, body(writer, context) {
      const field = 0x04000000 | context.fields.Builder;
      if (row.nullReceiver) writer.op('ldnull');
      else writer.op('ldstr', 0x70000000 + context.md.userString(initial))
        .op('newobj', context.member(builderType, '.ctor', 'void', ['string'], false));
      writer.op('stsfld', field).op('ldsfld', field);
      if (row.value === null) writer.op('ldnull');
      else writer.op('ldstr', 0x70000000 + context.md.userString(rangeText(row)));
      writer.op('ldc.i4', row.startIndex).op('ldc.i4', row.count);
      writer.op('callvirt', context.member(builderType, 'Append', builderType, rangeParameters, false));
      writer.op('ldsfld', field).op('ceq').op('stsfld', 0x04000000 | context.fields.Same).op('ret');
    }}]});
}
