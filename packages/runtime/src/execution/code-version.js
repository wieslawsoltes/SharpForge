const versions = new WeakMap();

function ownerOf(vm) {
  const owner = vm.inspector ?? vm.image;
  if (!owner || typeof owner !== 'object') throw new TypeError('Execution caches require a managed code owner');
  return owner;
}

function nextVersion(vm, owner, reason) {
  const previous = versions.get(vm);
  const epoch = (previous?.epoch ?? -1) + 1;
  if (!Number.isSafeInteger(epoch)) throw new RangeError('Execution code epoch exhausted');
  // Drop every cache together, including derived entries that refer to old tokens.
  if (previous) {
    previous.wasmCalls?.invalidate();
    previous.wasmCalls = null;
    previous.owner = null;
    previous.registry = null;
    previous.decode = previous.tokens = previous.fields = previous.inline = previous.generics = previous.calls = previous.source = null;
  }
  const state = {owner, registry: vm.heap?.methodTables, epoch, reason, decode: null, tokens: null, fields: null, inline: null, generics: null, calls: null,
    wasmCalls: null, source: null, statistics: {decodePlans: 0, decodedInstructions: 0, decodeMilliseconds: 0, offsetMapAllocations: 0,
      sourcePlans: 0, sourcePlanMilliseconds: 0, sourceFusionGroups: 0}};
  versions.set(vm, state);
  return state;
}

/** Internal cache owner. It is never attached to a VM, frame or snapshot graph. */
export function executionCodeState(vm) {
  const owner = ownerOf(vm);
  const current = versions.get(vm);
  if (current?.owner === owner && current.registry === vm.heap?.methodTables) return current;
  return nextVersion(vm, owner, !current ? 'initial' : current.owner !== owner ? 'owner-replaced' : 'type-system-replaced');
}

/** Drop derived code caches after a committed edit, assembly replacement, or stop. Returns the new epoch. */
export function invalidateExecutionCode(vm, reason = 'explicit') {
  if (typeof reason !== 'string') throw new TypeError('Execution invalidation reason must be a string');
  return nextVersion(vm, ownerOf(vm), reason).epoch;
}

/** Read cold-decode time in milliseconds and allocation counters for the current code epoch. */
export function executionCodeStatistics(vm) {
  const state = executionCodeState(vm);
  return Object.freeze({epoch: state.epoch, reason: state.reason, ...state.statistics});
}
