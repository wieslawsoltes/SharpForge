import {runtimeBuiltinDefinitions} from './runtime-builtins.js';
import {decimalIntrinsicDefinitions} from './decimal-intrinsic-profile.js';

// A closed source-visible subset of the existing CIL profile. Unique wire names
// distinguish overloads; the descriptor retains the actual CLR member identity.
const decimalRounding = [
  ['Truncate', ['System.Decimal']], ['Round', ['System.Decimal']], ['Round', ['System.Decimal', 'int']]
].map(([name, parameters]) => {
  const descriptor = decimalIntrinsicDefinitions.find(candidate => candidate.owner === 'System.Decimal' &&
    candidate.isStatic && candidate.name === name && candidate.returnType === 'System.Decimal' &&
    candidate.parameters.length === parameters.length && candidate.parameters.every((type, index) => type === parameters[index]));
  if (!descriptor) throw new TypeError('Missing Decimal rounding contract');
  return descriptor;
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
  for (const descriptor of decimalRounding) {
    const id = runtimeId++;
    const params = Object.freeze(descriptor.parameters.map(type => type === 'System.Decimal' ? 'decimal' : type));
    entries[id] = Object.freeze({
      id, name: 'decimal.' + descriptor.name + '#' + params.length,
      min: params.length, max: params.length, result: 'decimal', params, decimal: descriptor,
      parameterNames: Object.freeze(params.length === 2 ? ['d', 'decimals'] : ['d'])
    });
  }
  return Object.freeze(entries);
}
