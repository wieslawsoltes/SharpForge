import {managedFixture} from '../../managed-fixtures.js';
import {builderType} from './append-char.js';

export const integerTypes = ['sbyte', 'byte', 'short', 'ushort', 'uint'];
const conversions = {sbyte: 'conv.i1', byte: 'conv.u1', short: 'conv.i2', ushort: 'conv.u2'};
export const integerLiteral = row => row.input + (row.type === 'uint' ? 'U' : '');

/** UInt32 uses the signed I4 stack bit pattern; narrow values use their real CLI conversion instructions. */
export function builderIntegerAssembly(row) {
  return managedFixture({fields: [{name: 'Builder', type: builderType}, {name: 'Same', type: 'bool'}],
    methods: [{name: 'Main', result: 'void', maxStack: 2, body(writer, context) {
      const builder = 0x04000000 | context.fields.Builder;
      if (row.nullReceiver) writer.op('ldnull');
      else writer.op('ldstr', 0x70000000 + context.md.userString(row.initial))
        .op('newobj', context.member(builderType, '.ctor', 'void', ['string'], false));
      writer.op('stsfld', builder).op('ldsfld', builder).op('ldc.i4', Number(row.input) | 0);
      if (conversions[row.type]) writer.op(conversions[row.type]);
      writer.op('callvirt', context.member(builderType, 'Append', builderType, [row.type], false));
      writer.op('ldsfld', builder).op('ceq').op('stsfld', 0x04000000 | context.fields.Same).op('ret');
    }}]});
}
