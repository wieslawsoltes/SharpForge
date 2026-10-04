import {managedFixture} from '../../managed-fixtures.js';
import {comparisonNames} from './string-equals-comparison.js';

export const lastIndexOfStartParameters = ['string', 'int', 'System.StringComparison'];
const fromUnits = units => units === null ? null : String.fromCharCode(...units);
export const lastIndexOfStartArguments = row => [fromUnits(row.receiver), fromUnits(row.value), row.startIndex, row.mode];

/** Emit the registered signature independently from source binding and lowering. */
export function lastIndexOfStartAssembly(sameReference = false) {
  return managedFixture({methods: [{
    name: 'Main', result: 'int', parameters: ['string', 'string', 'int', 'int'], maxStack: 4,
    body(writer, context) {
      writer.op('ldarg.0').op(sameReference ? 'ldarg.0' : 'ldarg.1').op('ldarg.2').op('ldarg.3');
      writer.op('callvirt', context.member('System.String', 'LastIndexOf', 'int', lastIndexOfStartParameters, false)).op('ret');
    }
  }]});
}

const integerLiteral = value => value === -2147483648 ? '(-2147483647 - 1)' : String(value);

/** Preserve exact UTF-16 literals, independently allocated strings and parenthesized enum operands. */
export function lastIndexOfStartExpression(row) {
  const [receiver, value] = lastIndexOfStartArguments(row);
  const first = receiver === null ? '(string)null' : JSON.stringify(receiver);
  const second = row.copyValue ? `(${JSON.stringify('x' + value)}).Substring(1)` : JSON.stringify(value);
  const mode = comparisonNames[row.mode] ? `StringComparison.${comparisonNames[row.mode]}`
    : `(StringComparison)(${integerLiteral(row.mode)})`;
  return `(${first}).LastIndexOf(${second}, ${integerLiteral(row.startIndex)}, ${mode})`;
}

/** Keep native null/range faults; only otherwise valid culture requests have the explicit profile guard. */
export function lastIndexOfStartExpectedFault(row) {
  return row.fault === null && row.mode >= 0 && row.mode < 4 ? 'NotSupportedException' : row.fault;
}
