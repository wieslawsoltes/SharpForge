import {managedFixture} from '../../managed-fixtures.js';
import {comparisonNames} from './string-equals-comparison.js';

export const comparerType = 'System.StringComparer';
export const factoryParameters = ['System.StringComparison'];
export const fromUnits = value => value === null ? null : String.fromCharCode(...value);
export const expectedFactoryFault = row => row.fault ?? (row.mode < 4 ? 'NotSupportedException' : null);

/** Preserve named enum constants and invalid Int32 carriers in either source pipeline. */
export function factoryExpression(mode) {
  const literal = mode === -2147483648 ? '(-2147483647 - 1)' : String(mode);
  const value = comparisonNames[mode] ? `StringComparison.${comparisonNames[mode]}` : `(StringComparison)(${literal})`;
  return `StringComparer.FromComparison(${value})`;
}

/** Call the factory then a real registered string or object comparer contract without source lowering. */
export function factoryComparisonAssembly(owner = comparerType, parameters = ['string', 'string']) {
  return managedFixture({methods: [{
    name: 'Main', result: 'int', parameters: ['int', 'string', 'string'], maxStack: 3,
    body(writer, context) {
      writer.op('ldarg.0').op('call', context.member(comparerType, 'FromComparison', comparerType, factoryParameters));
      if (owner !== comparerType) writer.op('castclass', context.resolve(owner));
      writer.op('ldarg.1').op('ldarg.2').op('callvirt', context.member(owner, 'Compare', 'int', parameters, false)).op('ret');
    }
  }]});
}

/** Compare the factory reference against the actual released getter reference. */
export function factoryIdentityAssembly(mode) {
  return managedFixture({methods: [{name: 'Main', result: 'bool', maxStack: 2, body(writer, context) {
    writer.op('ldc.i4', mode).op('call', context.member(comparerType, 'FromComparison', comparerType, factoryParameters));
    writer.op('call', context.member(comparerType, mode === 4 ? 'get_Ordinal' : 'get_OrdinalIgnoreCase', comparerType));
    writer.op('ceq').op('ret');
  }}]});
}
