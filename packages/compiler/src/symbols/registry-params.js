/**
 * Which framework contracts take a parameter array. The registry lists a contract's parameter types only, so
 * `string.Format(string, object[])` looks like a method with an ordinary array parameter and a call in expanded form
 * (`string.Format("{0}{1}{2}{3}{4}", a, b, c, d, e)`) found no overload. The members named here are `params` in the
 * BCL; the binder then accepts the expanded form and the generator builds the array, as it does for source methods.
 */
import { ParameterSymbol } from './members.js';

/** `owner.name(parameter types)` of the contracts whose last parameter is a `params` array in the BCL. */
const paramsContracts = new Set([
  'System.String.Format(string,object[])',
  'System.String.Concat(string[])',
  'System.String.Join(string,string[])',
]);

/** True when parameter `index` of a framework contract is its parameter array. */
export function isParamsParameter(contract, index) {
  if (index !== contract.parameters.length - 1 || !contract.parameters[index].endsWith('[]')) return false;
  return paramsContracts.has(`${contract.owner}.${contract.name}(${contract.parameters.join(',')})`);
}

/** The parameter symbols of a framework contract, as the bridge's member symbols carry them. */
export function contractParameters(bridge, contract) {
  return contract.parameters.map(
    (typeName, index) =>
      new ParameterSymbol({
        name: 'arg' + index,
        type: bridge.typeFromName(typeName) ?? bridge.objectType,
        ordinal: index,
        isParams: isParamsParameter(contract, index),
      }),
  );
}
