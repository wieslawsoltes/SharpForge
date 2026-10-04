import {executionCodeState} from './code-version.js';

function siteFor(vm, frame, instruction, target, owner) {
  const state = executionCodeState(vm);
  const limit = vm.options.inlineCacheSize ?? 4;
  let cache = state.inline;
  if (!cache || cache.limit !== limit) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 16) {
      throw new RangeError('Inline cache size must be 1–16');
    }
    state.inline = cache = {limit, methods: new WeakMap()};
  }
  let method = cache.methods.get(frame.method);
  if (!method || method.instructions !== frame.method.instructions) {
    method = {instructions: frame.method.instructions, sites: new Map()};
    cache.methods.set(frame.method, method);
  }
  let site = method.sites.get(instruction.offset);
  if (!site || site.operand !== instruction.operand || site.target !== target || site.owner !== owner) {
    site = {operand: instruction.operand, target, owner, limit,
      first: null, rest: [], megamorphic: false, hits: 0, misses: 0};
    method.sites.set(instruction.offset, site);
  }
  return site;
}

/** Cache virtual/interface targets by receiver type, never by a managed handle. */
export function resolveVirtualTarget(vm, frame, instruction, descriptor, receiver) {
  const system = vm.typeSystem;
  // Resolve the live record even on a cache hit; collection and null checks cannot be skipped.
  const table = vm.heap.get(receiver).methodTable;
  const target = descriptor.resolvedToken ?? descriptor.token;
  if (vm.options.inlineCaches === false) return system.virtualTarget(receiver, descriptor, target);
  const site = siteFor(vm, frame, instruction, target, descriptor.ownerInstance ?? null);
  if (site.first?.table === table) {
    site.hits++;
    return site.first.target;
  }
  for (const entry of site.rest) {
    if (entry.table === table) {
      site.hits++;
      return entry.target;
    }
  }
  site.misses++;
  const dispatch = system.virtualTarget(receiver, descriptor, target);
  if (site.megamorphic) return dispatch;
  if (site.first && site.rest.length + 1 === site.limit) {
    site.first = null;
    site.rest = [];
    site.megamorphic = true;
  } else {
    const entry = Object.freeze({table, target: dispatch});
    if (site.first) site.rest.push(entry);
    else site.first = entry;
  }
  return dispatch;
}

/** Internal diagnostics expose counts only, never cached types or object identities. */
export function inlineCacheStatistics(vm, method, offset) {
  const cached = executionCodeState(vm).inline?.methods.get(method);
  const site = cached?.instructions === method.instructions ? cached.sites.get(offset) : null;
  return Object.freeze({entries: site ? Number(!!site.first) + site.rest.length : 0,
    megamorphic: !!site?.megamorphic, hits: site?.hits ?? 0, misses: site?.misses ?? 0});
}
