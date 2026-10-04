import {ManagedFault, isReference} from '../heap.js';
import {pointerType} from './managed-pointers.js';
import {objectOverride} from './handlers/constrained.js';
import {executionCodeState} from './code-version.js';

function resolve(vm, system, descriptor, receiver, table) {
  let target = descriptor.resolvedToken;
  if (!target) {
    const override = objectOverride(vm, descriptor, receiver);
    if (override) { descriptor = override; target = override.resolvedToken; }
  }
  const dispatch = target && (vm.inspector.methods.get(target)?.flags & 0x40)
    ? system.dispatch.resolve(table?.name ?? null, target, descriptor.ownerInstance)
    : target ?? system.dispatch.externalTarget(table?.name ?? null, descriptor);
  return Object.freeze({target: dispatch, descriptor: dispatch
    ? Object.freeze({...descriptor, ...vm.inspector.methods.get(dispatch), resolvedToken: dispatch}) : descriptor});
}

function siteFor(vm, frame, instruction) {
  const state = executionCodeState(vm);
  const limit = vm.options.inlineCacheSize ?? 4;
  if (!Number.isInteger(limit) || limit < 1 || limit > 16) throw new RangeError('Inline cache size must be 1–16');
  let cache = state.inline;
  if (!cache || cache.limit !== limit) state.inline = cache = {limit, methods: new WeakMap()};
  let sites = cache.methods.get(frame.method);
  if (!sites) cache.methods.set(frame.method, sites = new Map());
  let site = sites.get(instruction.offset);
  if (!site) {
    site = {limit, first: null, rest: [], megamorphic: false, hits: 0, misses: 0};
    sites.set(instruction.offset, site);
  }
  return site;
}

function matches(entry, table, descriptor) {
  return entry?.table === table && entry.sourceTarget === descriptor.resolvedToken && entry.owner === descriptor.ownerInstance;
}

/** Resolve a virtual/interface call without retaining a receiver or bypassing its lifetime check. */
export function resolveVirtualCall(vm, frame, instruction, descriptor, receiver) {
  if (receiver === null) throw new ManagedFault('NullReferenceException', 'Null virtual receiver');
  const system = vm.typeSystem;
  const table = receiver?.byref ? pointerType(vm, receiver) : isReference(receiver) ? vm.heap.get(receiver).methodTable : null;
  if (!table || vm.options.inlineCaches === false) return resolve(vm, system, descriptor, receiver, table);
  const site = siteFor(vm, frame, instruction);
  if (matches(site.first, table, descriptor)) { site.hits++; return site.first.result; }
  for (const entry of site.rest) {
    if (matches(entry, table, descriptor)) { site.hits++; return entry.result; }
  }
  site.misses++;
  const result = resolve(vm, system, descriptor, receiver, table);
  if (site.megamorphic) return result;
  if (site.first && site.rest.length + 1 === site.limit) {
    site.first = null;
    site.rest = [];
    site.megamorphic = true;
  } else {
    const entry = {table, sourceTarget: descriptor.resolvedToken, owner: descriptor.ownerInstance, result};
    if (site.first) site.rest.push(entry);
    else site.first = entry;
  }
  return result;
}

/** Diagnostics expose counts only, never cached metadata or receiver identities. */
export function inlineCacheStatistics(vm, method, offset) {
  const site = executionCodeState(vm).inline?.methods.get(method)?.get(offset);
  return Object.freeze({entries: site ? Number(!!site.first) + site.rest.length : 0,
    megamorphic: !!site?.megamorphic, hits: site?.hits ?? 0, misses: site?.misses ?? 0});
}
