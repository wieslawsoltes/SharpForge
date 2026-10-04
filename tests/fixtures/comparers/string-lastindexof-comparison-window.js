import {managedFixture} from '../../managed-fixtures.js';
import {comparisonNames} from './string-equals-comparison.js';

export const lastIndexOfWindowParameters = ['string', 'int', 'int', 'System.StringComparison'];
const fromUnits = units => units === null ? null : String.fromCharCode(...units);
export const lastIndexOfWindowArguments = row => [fromUnits(row.receiver), fromUnits(row.value), row.startIndex, row.count, row.mode];

/** Emit the bounded signature independently from source binding and lowering. */
export function lastIndexOfWindowAssembly(sameReference = false) {
  return managedFixture({methods: [{
    name: 'Main', result: 'int', parameters: ['string', 'string', 'int', 'int', 'int'], maxStack: 5,
    body(writer, context) {
      for (let index = 0; index < 5; index++) writer.op('ldarg', sameReference && index === 1 ? 0 : index);
      writer.op('callvirt', context.member('System.String', 'LastIndexOf', 'int', lastIndexOfWindowParameters, false)).op('ret');
    }
  }]});
}

const integerLiteral = value => value === -2147483648 ? '(-2147483647 - 1)' : String(value);

/** Keep malformed UTF-16, independently allocated identity controls and parenthesized enum casts. */
export function lastIndexOfWindowExpression(row) {
  const [receiver, value] = lastIndexOfWindowArguments(row);
  const first = receiver === null ? '(string)null' : JSON.stringify(receiver);
  const second = row.copyValue ? `(${JSON.stringify('x' + value)}).Substring(1)` : JSON.stringify(value);
  const mode = comparisonNames[row.mode] ? `StringComparison.${comparisonNames[row.mode]}`
    : `(StringComparison)(${integerLiteral(row.mode)})`;
  return `(${first}).LastIndexOf(${second}, ${integerLiteral(row.startIndex)}, ${integerLiteral(row.count)}, ${mode})`;
}

/** Preserve native null/enum/range faults; only valid culture searches reach the explicit profile guard. */
export function lastIndexOfWindowExpectedFault(row) {
  return row.fault === null && row.mode >= 0 && row.mode < 4 ? 'NotSupportedException' : row.fault;
}
