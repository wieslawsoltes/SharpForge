import {managedFixture} from '../../managed-fixtures.js';
import {decimalSignature, emitDecimal} from '../../a05-decimal-fixtures.js';
import {builderType} from './append-char.js';

export function decimalLiteral(row) {
  const digits = row.coefficient.padStart(row.scale + 1, '0');
  const text = row.scale ? digits.slice(0, -row.scale) + '.' + digits.slice(-row.scale) : digits;
  return (row.negative ? '-' : '') + text + 'm';
}

/** Construct exact native Decimal words and pass the value type through an ordinary CIL member call. */
export function builderDecimalAssembly(row) {
  return managedFixture({fields: [{name: 'Builder', type: builderType}, {name: 'Same', type: 'bool'}],
    methods: [{name: 'Main', result: 'void', maxStack: 6, body(writer, context) {
      const builder = 0x04000000 | context.fields.Builder;
      if (row.nullReceiver) writer.op('ldnull');
      else writer.op('ldstr', 0x70000000 + context.md.userString(row.initial))
        .op('newobj', context.member(builderType, '.ctor', 'void', ['string'], false));
      writer.op('stsfld', builder).op('ldsfld', builder);
      emitDecimal(writer, context, row.coefficient, row.scale, row.negative);
      writer.op('callvirt', context.member(builderType, 'Append', builderType, [decimalSignature], false));
      writer.op('ldsfld', builder).op('ceq').op('stsfld', 0x04000000 | context.fields.Same).op('ret');
    }}]});
}
