import {managedFixture} from '../../managed-fixtures.js';
import {builderType} from './append-char.js';

// Each source spelling must also produce the exact finite bits observed in managed local storage.
export const singleSourceCases = [
  ['00000000', '0f'], ['80000000', '-0f'], ['3dcccccd', '0.1f'],
  ['4e6e6b28', '1000000000f'], ['4e6e6b29', '1.00000006E+09f'],
  ['00000001', 'float.Epsilon'], ['7f7fffff', 'float.MaxValue'], ['ff7fffff', 'float.MinValue'],
  ['7fc00000', 'float.NaN'], ['7f800000', 'float.PositiveInfinity'], ['ff800000', 'float.NegativeInfinity']
];

/** Decode exact I4 payloads through the released CIL BitConverter intrinsic, then call real Append(Single). */
export function builderSingleAssembly(row) {
  return managedFixture({fields: [{name: 'Builder', type: builderType}, {name: 'Same', type: 'bool'}],
    methods: [{name: 'Main', result: 'void', locals: ['float'], maxStack: 2, body(writer, context) {
      const field = 0x04000000 | context.fields.Builder;
      if (row.nullReceiver) writer.op('ldnull');
      else writer.op('ldstr', 0x70000000 + context.md.userString('seed|'))
        .op('newobj', context.member(builderType, '.ctor', 'void', ['string'], false));
      writer.op('stsfld', field).op('ldc.i4', Number.parseInt(row.bits, 16) | 0);
      writer.op('call', context.member('System.BitConverter', 'Int32BitsToSingle', 'float', ['int'])).op('stloc.0');
      writer.op('ldsfld', field).op('ldloc.0');
      writer.op('callvirt', context.member(builderType, 'Append', builderType, ['float'], false));
      writer.op('ldsfld', field).op('ceq').op('stsfld', 0x04000000 | context.fields.Same).op('ret');
    }}]});
}
