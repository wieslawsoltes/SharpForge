import {managedFixture} from '../../managed-fixtures.js';
import {comparisonType, comparisonNames} from './string-equals-comparison.js';
import {fromUnits} from './string-compare-ranges.js';

export const comparisonRangeParameters = ['string', 'int', 'string', 'int', 'int', comparisonType];
export const comparisonRangeArguments = row =>
  [fromUnits(row.left), row.indexA, fromUnits(row.right), row.indexB, row.length, row.mode];
export const expectedComparisonRangeFault = row => row.group === 'culture' ? 'NotSupportedException' : row.fault;
const integerExpression = value => value === -2147483648 ? '(-2147483647 - 1)' : String(value);

/** Independently emit the exact six-argument framework call while preserving captured identity. */
export function comparisonRangeAssembly(sameReference = false) {
  return managedFixture({methods: [{
    name: 'Main', result: 'int', parameters: ['string', 'int', 'string', 'int', 'int', 'int'], maxStack: 6,
    body(writer, context) {
      for (let index = 0; index < comparisonRangeParameters.length; index++) {
        writer.op('ldarg', index === 2 && sameReference ? 0 : index);
      }
      writer.op('call', context.member('System.String', 'Compare', 'int', comparisonRangeParameters, true)).op('ret');
    }
  }]});
}

/** Preserve captured UTF-16 and independently allocated equality without numeric-cast ambiguity. */
export function comparisonRangeExpression(row) {
  const [left, indexA, right, indexB, length] = comparisonRangeArguments(row);
  const second = row.copyRight ? `(${JSON.stringify('x' + right)}).Substring(1)` : JSON.stringify(right);
  const mode = comparisonNames[row.mode]
    ? `StringComparison.${comparisonNames[row.mode]}` : `(StringComparison)(${integerExpression(row.mode)})`;
  return `string.Compare(${JSON.stringify(left)}, ${integerExpression(indexA)}, ${second}, ` +
    `${integerExpression(indexB)}, ${integerExpression(length)}, ${mode})`;
}
