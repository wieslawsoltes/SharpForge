import {managedFixture} from '../../managed-fixtures.js';
import {comparisonType, comparisonNames} from './string-equals-comparison.js';

export const compareParameters = ['string', 'string', comparisonType];
const fromUnits = units => units === null ? null : String.fromCharCode(...units);
export const compareArguments = row => [fromUnits(row.left), fromUnits(row.right), row.mode];
export const expectedCompareFault = row => row.group === 'culture' ? 'NotSupportedException' : row.fault;

/** Emit an independent enum-typed static call; reference identity matches the captured case. */
export function compareComparisonAssembly(sameReference = false) {
  return managedFixture({methods: [{
    name: 'Main', result: 'int', parameters: ['string', 'string', 'int'], maxStack: 3,
    body(writer, context) {
      writer.op('ldarg.0').op(sameReference ? 'ldarg.0' : 'ldarg.1').op('ldarg.2');
      writer.op('call', context.member('System.String', 'Compare', 'int', compareParameters, true)).op('ret');
    }
  }]});
}

/** Preserve UTF-16 literals and the native capture's separately allocated right-hand strings. */
export function compareExpression(row) {
  const [left, right] = compareArguments(row);
  const second = row.copyRight ? `(${JSON.stringify('x' + right)}).Substring(1)` : JSON.stringify(right);
  const number = row.mode === -2147483648 ? '(-2147483647 - 1)' : String(row.mode);
  const mode = comparisonNames[row.mode] ? `StringComparison.${comparisonNames[row.mode]}` : `(StringComparison)(${number})`;
  return `string.Compare(${JSON.stringify(left)}, ${second}, ${mode})`;
}
