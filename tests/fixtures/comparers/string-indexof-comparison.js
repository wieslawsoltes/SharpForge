import {managedFixture} from '../../managed-fixtures.js';
import {comparisonNames} from './string-equals-comparison.js';

export const indexOfParameters = ['string', 'System.StringComparison'];
const fromUnits = units => units === null ? null : String.fromCharCode(...units);
export const indexOfArguments = row => [fromUnits(row.receiver), fromUnits(row.value), row.mode];

/** Independently emit the enum-typed contract, or the released int overload for a same-arity control. */
export function indexOfComparisonAssembly(sameReference = false, parameters = indexOfParameters) {
  return managedFixture({methods: [{
    name: 'Main', result: 'int', parameters: ['string', 'string', 'int'], maxStack: 3,
    body(writer, context) {
      writer.op('ldarg.0').op(sameReference ? 'ldarg.0' : 'ldarg.1').op('ldarg.2');
      writer.op('callvirt', context.member('System.String', 'IndexOf', 'int', parameters, false)).op('ret');
    }
  }]});
}

/** Preserve exact UTF-16 literals, separately allocated identity controls and unambiguous enum casts. */
export function indexOfExpression(row) {
  const [receiver, value] = indexOfArguments(row);
  const first = receiver === null ? '(string)null' : JSON.stringify(receiver);
  const second = row.copyValue ? `(${JSON.stringify('x' + value)}).Substring(1)` : JSON.stringify(value);
  const number = row.mode === -2147483648 ? '(-2147483647 - 1)' : String(row.mode);
  const mode = comparisonNames[row.mode] ? `StringComparison.${comparisonNames[row.mode]}` : `(StringComparison)(${number})`;
  return `(${first}).IndexOf(${second}, ${mode})`;
}

/** Native culture outcomes are retained separately from the supported profile's explicit guard. */
export function indexOfExpectedFault(row) {
  return row.receiver !== null && row.value !== null && row.mode >= 0 && row.mode < 4
    ? 'NotSupportedException' : row.fault;
}
