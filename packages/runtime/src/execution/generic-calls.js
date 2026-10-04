import {resolveExecutionMethod, substituteCallType} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {executionCodeState} from './code-version.js';
import {cachedMetadataToken, cachedTypeName} from './token-cache.js';

/** Resolve token types at the frame boundary; MethodTables remain the sole type identities. */
export function resolveCallType(vm, input, frame = vm.top) {
  if (typeof input !== 'string' && typeof input !== 'number') return input;
  const type = typeof input === 'number' ? cachedTypeName(vm, input) : input;
  return substituteCallType(type, frame?.method.typeArguments ?? [], frame?.method.methodArguments ?? []);
}

function callCache(vm) {
  return executionCodeState(vm).calls ??= {methods: new WeakMap(), owners: new WeakMap()};
}

/** The token cache stays context-free; substituted descriptors are keyed by the actual closed method. */
export function callDescriptor(vm, token, frame = vm.top) {
  const cache = callCache(vm).methods;
  let entries = cache.get(frame.method);
  if (!entries) cache.set(frame.method, entries = new Map());
  if (entries.has(token)) return entries.get(token);
  const method = frame.method;
  const descriptor = resolveExecutionMethod(vm.inspector, token, {
    ownerToken: method.ownerToken, genericIdentity: method.genericIdentity,
    typeArguments: method.typeArguments, methodArguments: method.methodArguments
  }, cachedMetadataToken(vm, token));
  entries.set(token, descriptor);
  return descriptor;
}

/** An override or DIM body executes in its own closed declaring instance. */
export function selectedCallOwner(vm, target, receiver, declaredOwner) {
  const definition = vm.inspector.methods.get(target);
  if (!definition || definition.flags & 0x10) return declaredOwner;
  const root = vm.heap.get(receiver).methodTable, cache = callCache(vm).owners;
  let targets = cache.get(root);
  if (!targets) cache.set(root, targets = new Map());
  let owners = targets.get(target);
  if (!owners) targets.set(target, owners = new Map());
  if (owners.has(declaredOwner)) return owners.get(declaredOwner);
  const selected = findCallOwner(vm, definition, root, declaredOwner);
  const name = selected.typeArguments.length ? selected.name : null;
  owners.set(declaredOwner, name);
  return name;
}

function findCallOwner(vm, definition, root, declaredOwner) {
  const pending = [root], seen = new Set(), candidates = [];
  while (pending.length) {
    const table = pending.pop();
    if (!table || seen.has(table)) continue;
    seen.add(table);
    if (table.definitionToken === definition.ownerToken) candidates.push(table);
    if (table.base) pending.push(table.base);
    pending.push(...table.interfaces);
  }
  if (!candidates.length) throw new ManagedFault('InvalidProgramException', 'Call receiver has no matching declaring instance');
  const declared = declaredOwner ? vm.typeSystem.table(declaredOwner) : null;
  const selected = candidates.find(table => table === declared) ?? (candidates.length === 1 ? candidates[0] : null);
  if (selected) return selected;
  if (!declared) throw new ManagedFault('InvalidProgramException', 'Call declaring instance is ambiguous');
  const compatible = candidates.filter(table => vm.typeSystem.castCache.isAssignableFrom(declared, table));
  if (compatible.length !== 1) throw new ManagedFault('InvalidProgramException', 'Call declaring instance is ambiguous');
  return compatible[0];
}
