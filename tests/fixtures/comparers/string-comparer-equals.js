import {managedFixture} from '../../managed-fixtures.js';

export const comparerType = 'System.StringComparer';
export const equalsParameters = ['string', 'string'];
export const fromUnits = units => units === null ? null : String.fromCharCode(...units);
export const getterName = mode => mode === 4 ? 'Ordinal' : 'OrdinalIgnoreCase';

/** Keep comparer receiver, nullable argument types and managed identity explicit in either source pipeline. */
export function comparerEqualsSource(row) {
  const getter = getterName(row.mode);
  const receiver = row.nullReceiver ? 'null' : row.factory ? `StringComparer.FromComparison(StringComparison.${getter})`
    : `StringComparer.${getter}`;
  const first = fromUnits(row.first);
  const second = row.sameReference ? 'first' : row.copyValue ? `(${JSON.stringify('x' + first)}).Substring(1)`
    : JSON.stringify(fromUnits(row.second));
  return `{ StringComparer comparer = ${receiver}; string first = ${JSON.stringify(first)}; string second = ${second};` +
    'Console.WriteLine(comparer.Equals(first, second)); }';
}

/** Independently call the exact two-string instance signature, retaining null receiver and reference aliases. */
export function comparerEqualsAssembly({mode, factory, sameReference, nullReceiver}) {
  return managedFixture({methods: [{
    name: 'Main', result: 'bool', parameters: ['string', 'string'], maxStack: 3,
    body(writer, context) {
      if (nullReceiver) writer.op('ldnull');
      else if (factory) {
        writer.op('ldc.i4', mode).op('call', context.member(comparerType, 'FromComparison', comparerType, ['System.StringComparison']));
      } else writer.op('call', context.member(comparerType, 'get_' + getterName(mode), comparerType));
      writer.op('ldarg.0').op(sameReference ? 'ldarg.0' : 'ldarg.1');
      writer.op('callvirt', context.member(comparerType, 'Equals', 'bool', equalsParameters, false)).op('ret');
    }
  }]});
}
