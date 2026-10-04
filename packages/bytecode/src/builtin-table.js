import {runtimeBuiltinDefinitions} from './runtime-builtins.js';
import {decimalIntrinsicDefinitions} from './decimal-intrinsic-profile.js';

// A closed source-visible subset of the existing CIL profile. Unique wire names
// distinguish overloads; the descriptor retains the actual CLR member identity.
const sourceDecimals = [
  ['Truncate', ['System.Decimal'], ['d']], ['Round', ['System.Decimal'], ['d']],
  ['Round', ['System.Decimal', 'int'], ['d', 'decimals']], ['Parse', ['string'], ['s']],
  ['Ceiling', ['System.Decimal'], ['d']], ['Floor', ['System.Decimal'], ['d']],
  ...['Add', 'Subtract', 'Multiply', 'Divide', 'Remainder'].map(name =>
    [name, ['System.Decimal', 'System.Decimal'], ['d1', 'd2']]),
  ['Compare', ['System.Decimal', 'System.Decimal'], ['d1', 'd2'], 'int'],
  ['Equals', ['System.Decimal', 'System.Decimal'], ['d1', 'd2'], 'bool']
].map(([name, parameters, parameterNames, returnType = 'System.Decimal']) => {
  const descriptor = decimalIntrinsicDefinitions.find(candidate => candidate.owner === 'System.Decimal' &&
    candidate.isStatic && candidate.name === name && candidate.returnType === returnType &&
    candidate.parameters.length === parameters.length && candidate.parameters.every((type, index) => type === parameters[index]));
  if (!descriptor) throw new TypeError('Missing source Decimal contract');
  return {descriptor, parameterNames: Object.freeze(parameterNames)};
});

/** Build the frozen dispatch table, retaining contract IDs across reserved sparse ranges. */
export function createBuiltinTable(definitions, contracts, releasedRanges) {
  const contractOffset = definitions.length;
  const entries = definitions.map(([name, min, max, result, params], id) =>
    Object.freeze({id, name, min, max, result, params}));
  for (const contract of contracts) {
    const id = contractOffset + contract.id;
    const receiver = !contract.isStatic && contract.kind !== 'constructor' ? [contract.owner] : [];
    const params = Object.freeze([...receiver, ...contract.parameters]);
    entries[id] = Object.freeze({
      id, name: '$framework:' + contract.id, min: params.length, max: params.length,
      result: contract.result, params, contract
    });
  }
  // Runtime opcodes follow the released ranges, not a later extension's sparse ID.
  let runtimeId = contractOffset + releasedRanges.reduce((end, range) => Math.max(end, range.start + range.size), 0);
  for (const [name, min, max, result, params] of runtimeBuiltinDefinitions) {
    const id = runtimeId++;
    entries[id] = Object.freeze({id, name, min, max, result, params: Object.freeze(params)});
  }
  for (const {descriptor, parameterNames} of sourceDecimals) {
    const id = runtimeId++;
    const params = Object.freeze(descriptor.parameters.map(type => type === 'System.Decimal' ? 'decimal' : type));
    entries[id] = Object.freeze({
      id, name: 'decimal.' + descriptor.name + '#' + params.length,
      min: params.length, max: params.length,
      result: descriptor.returnType === 'System.Decimal' ? 'decimal' : descriptor.returnType, params, decimal: descriptor,
      parameterNames
    });
  }
  return Object.freeze(entries);
}
