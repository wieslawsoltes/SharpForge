import {managedFixture} from '../../managed-fixtures.js';
import {builderType} from './append-char.js';

/** Emit real 64-bit stack values; UInt64's upper half is carried by the signed Int64 bit pattern. */
export function builderInt64Assembly(row) {
  return managedFixture({fields: [{name: 'Builder', type: builderType}, {name: 'Same', type: 'bool'}],
    methods: [{name: 'Main', result: 'void', maxStack: 2, body(writer, context) {
      const field = 0x04000000 | context.fields.Builder;
      if (row.nullReceiver) writer.op('ldnull');
      else writer.op('ldstr', 0x70000000 + context.md.userString(row.initial))
        .op('newobj', context.member(builderType, '.ctor', 'void', ['string'], false));
      writer.op('stsfld', field).op('ldsfld', field).op('ldc.i8', BigInt.asIntN(64, BigInt(row.input)));
      writer.op('callvirt', context.member(builderType, 'Append', builderType, [row.type], false));
      writer.op('ldsfld', field).op('ceq').op('stsfld', 0x04000000 | context.fields.Same).op('ret');
    }}]});
}

// The existing constant folder rejects the positive token in -9223372036854775808L before applying unary minus.
export const int64Literal = row => row.type === 'long' && row.input === '-9223372036854775808'
  ? 'long.MinValue' : row.input + (row.type === 'ulong' ? 'UL' : 'L');
