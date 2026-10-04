import {managedFixture} from '../../managed-fixtures.js';

export const affixParameters = ['string', 'System.StringComparison'];
const comparisonNames = ['CurrentCulture', 'CurrentCultureIgnoreCase', 'InvariantCulture',
  'InvariantCultureIgnoreCase', 'Ordinal', 'OrdinalIgnoreCase'];
const fromUnits = units => units === null ? null : String.fromCharCode(...units);
export const affixArguments = row => [fromUnits(row.receiver), fromUnits(row.value), row.mode];

/** Invoke the real instance contract through independently authored enum-typed CIL. */
export function affixComparisonAssembly(method, sameReference = false) {
  return managedFixture({methods: [{
    name: 'Main', result: 'bool', parameters: ['string', 'string', 'int'], maxStack: 3,
    body(writer, context) {
      writer.op('ldarg.0').op(sameReference ? 'ldarg.0' : 'ldarg.1').op('ldarg.2');
      writer.op('callvirt', context.member('System.String', method, 'bool', affixParameters, false)).op('ret');
    }
  }]});
}

/** Preserve captured UTF-16 and distinguish separately allocated equal values. */
export function affixExpression(row) {
  const [receiver, value] = affixArguments(row);
  const first = receiver === null ? '(string)null' : JSON.stringify(receiver);
  const second = row.copyValue ? `(${JSON.stringify('x' + value)}).Substring(1)` : JSON.stringify(value);
  const number = row.mode === -2147483648 ? '(-2147483647 - 1)' : String(row.mode);
  const mode = comparisonNames[row.mode] ? `StringComparison.${comparisonNames[row.mode]}` : `(StringComparison)(${number})`;
  return `(${first}).${row.method}(${second}, ${mode})`;
}

/** Culture rejection follows receiver/value null checks and remains separate from the native oracle. */
export function affixExpectedFault(row) {
  return row.receiver !== null && row.value !== null && row.mode >= 0 && row.mode < 4
    ? 'NotSupportedException' : row.fault;
}
