import {managedFixture} from '../../managed-fixtures.js';

export const rangeParameters = ['string', 'int', 'string', 'int', 'int'];
export const fromUnits = units => units === null ? null : String.fromCharCode(...units);
export const rangeArguments = row => [fromUnits(row.left), row.indexA, fromUnits(row.right), row.indexB, row.length];

/** Emit the actual five-argument framework call without using the source compiler. */
export function compareRangeAssembly() {
  return managedFixture({methods: [{
    name: 'Main', result: 'int', parameters: rangeParameters, maxStack: 5,
    body(writer, context) {
      for (let index = 0; index < rangeParameters.length; index++) writer.op('ldarg', index);
      writer.op('call', context.member('System.String', 'CompareOrdinal', 'int', rangeParameters)).op('ret');
    }
  }]});
}

/** JSON string escaping also preserves lone UTF-16 surrogates in the generated C# literal. */
export function rangeExpression(row) {
  return 'string.CompareOrdinal(' + rangeArguments(row).map(value => JSON.stringify(value)).join(', ') + ')';
}
