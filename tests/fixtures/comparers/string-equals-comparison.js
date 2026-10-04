import {managedFixture} from '../../managed-fixtures.js';

export const comparisonType = 'System.StringComparison';
export const comparisonNames = ['CurrentCulture', 'CurrentCultureIgnoreCase', 'InvariantCulture',
  'InvariantCultureIgnoreCase', 'Ordinal', 'OrdinalIgnoreCase'];
export const equalsParameters = instance => instance ? ['string', comparisonType] : ['string', 'string', comparisonType];
const fromUnits = units => units === null ? null : String.fromCharCode(...units);
export const equalsArguments = row => [fromUnits(row.left), fromUnits(row.right), row.mode];

/** Emit the actual enum-typed framework call, with callvirt for the instance overload. */
export function equalsComparisonAssembly(instance, sameReference = false) {
  return managedFixture({methods: [{
    name: 'Main', result: 'bool', parameters: ['string', 'string', 'int'], maxStack: 3,
    body(writer, context) {
      writer.op('ldarg.0').op(sameReference ? 'ldarg.0' : 'ldarg.1').op('ldarg.2');
      writer.op(instance ? 'callvirt' : 'call', context.member('System.String', 'Equals', 'bool',
        equalsParameters(instance), !instance)).op('ret');
    }
  }]});
}

/** Retain malformed UTF-16 in literals and allocate a fresh right-hand string when captured. */
export function equalsExpression(row) {
  const [left, right] = equalsArguments(row);
  const first = left === null ? '(string)null' : JSON.stringify(left);
  const second = row.copyRight ? `(${JSON.stringify('x' + right)}).Substring(1)` : JSON.stringify(right);
  const number = row.mode === -2147483648 ? '(-2147483647 - 1)' : String(row.mode);
  const mode = comparisonNames[row.mode] ? `StringComparison.${comparisonNames[row.mode]}` : `(StringComparison)(${number})`;
  return row.instance ? `(${first}).Equals(${second}, ${mode})` : `string.Equals(${first}, ${second}, ${mode})`;
}

/** Culture modes intentionally remain outside the supported profile; null receivers still fail first. */
export function expectedFault(row) {
  return row.group === 'culture' && !(row.instance && row.left === null) ? 'NotSupportedException' : row.fault;
}
