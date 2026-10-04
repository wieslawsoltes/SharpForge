import {runtimeBuiltinDefinitions} from './runtime-builtins.js';

/** Build the frozen dispatch table, retaining contract IDs across reserved sparse ranges. */
export function createBuiltinTable(definitions, contracts, releasedRanges, runtimeDefinitions = runtimeBuiltinDefinitions) {
  const contractOffset = definitions.length;
  const entries = definitions.map(([name, min, max, result, params], id) =>
    Object.freeze({id, name, min, max, result, params}));
  for (const contract of contracts) {
    const id = contractOffset + contract.id;
    if (entries[id]) throw new Error('Builtin reservation overlaps another entry: ' + id);
    const receiver = !contract.isStatic && contract.kind !== 'constructor' ? [contract.owner] : [];
    const params = Object.freeze([...receiver, ...contract.parameters]);
    entries[id] = Object.freeze({
      id, name: '$framework:' + contract.id, min: params.length, max: params.length,
      result: contract.result, params, contract
    });
  }
  // Runtime opcodes follow the released ranges, not a later extension's sparse ID.
  let runtimeId = contractOffset + releasedRanges.reduce((end, range) => Math.max(end, range.start + range.size), 0);
  for (const [name, min, max, result, params] of runtimeDefinitions) {
    const id = runtimeId++;
    if (entries[id]) throw new Error('Builtin reservation overlaps released runtime entry: ' + id);
    entries[id] = Object.freeze({id, name, min, max, result, params: Object.freeze(params)});
  }
  return Object.freeze(entries);
}
