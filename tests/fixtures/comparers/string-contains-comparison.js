import {managedFixture} from '../../managed-fixtures.js';

export const containsParameters = ['string', 'System.StringComparison'];
const comparisonNames = ['CurrentCulture', 'CurrentCultureIgnoreCase', 'InvariantCulture',
  'InvariantCultureIgnoreCase', 'Ordinal', 'OrdinalIgnoreCase'];
const fromUnits = units => units === null ? null : String.fromCharCode(...units);
export const containsArguments = row => [fromUnits(row.receiver), fromUnits(row.value), row.mode];

/** Invoke the real instance contract through independently authored enum-typed CIL. */
export function containsComparisonAssembly(sameReference = false) {
  return managedFixture({methods: [{
    name: 'Main', result: 'bool', parameters: ['string', 'string', 'int'], maxStack: 3,
    body(writer, context) {
      writer.op('ldarg.0').op(sameReference ? 'ldarg.0' : 'ldarg.1').op('ldarg.2');
      writer.op('callvirt', context.member('System.String', 'Contains', 'bool', containsParameters, false)).op('ret');
    }
  }]});
}

/** Preserve captured UTF-16 and distinguish separately allocated equal values. */
export function containsExpression(row) {
  const [receiver, value] = containsArguments(row);
  const first = receiver === null ? '(string)null' : JSON.stringify(receiver);
  const second = row.copyValue ? `(${JSON.stringify('x' + value)}).Substring(1)` : JSON.stringify(value);
  const number = row.mode === -2147483648 ? '(-2147483647 - 1)' : String(row.mode);
  const mode = comparisonNames[row.mode] ? `StringComparison.${comparisonNames[row.mode]}` : `(StringComparison)(${number})`;
  return `(${first}).Contains(${second}, ${mode})`;
}

/** Keep deliberate culture guards separate from the unchanged native capture. */
export function containsExpectedFault(row) {
  return row.receiver !== null && row.value !== null && row.mode >= 0 && row.mode < 4
    ? 'NotSupportedException' : row.fault;
}
