import {isReference} from './reference.js';
import {rootAuditBoundaries, rootProviderInventory} from './root-inventory.js';

const identity = reference => `${reference.h}:${reference.g}`;
const terminal = new Set(['completed', 'faulted', 'canceled']);

/** Independent full-slot trace deliberately does not use the collector's descriptor scanner. */
export function traceRootClosure(heap, extraRoots = []) {
  const reachable = new Set();
  const pending = [];
  const add = value => {
    if (value?.byref) value = value.owner;
    if (!isReference(value) || !heap.tryGet(value)) return;
    const key = identity(value);
    if (reachable.has(key)) return;
    reachable.add(key);
    pending.push(value);
  };
  heap.visitRoots(add, extraRoots);
  for(let index=0;index<heap.records.length;index++)if(heap.records[index]?.space==='frozen')add(heap.referenceAt(index));
  while (pending.length) {
    const record = heap.get(pending.pop());
    if (record.kind !== 'string') for (const value of record.data) add(value);
  }
  return reachable;
}

function childPath(path, key) {
  return /^[A-Za-z_$][\w$]*$/.test(String(key)) ? `${path}.${key}` : `${path}[${JSON.stringify(String(key))}]`;
}

function excluded(owner, key, value, vm) {
  if (Object.hasOwn(rootAuditBoundaries, key)) return true;
  if (owner === vm && key === 'strings' && vm.options?.weakStringInterning) return true;
  if (value === vm.heap || value === vm.heap?.records || value instanceof WeakMap || value instanceof WeakSet) return true;
  if (value && terminal.has(value.status) && ('taskId' in value || 'waiters' in value)) return true;
  return false;
}

/** Debug-only bounded inspection of data properties; accessors and host closures are never invoked. */
export function auditRoots(vm, {debuggerSession = null, maxObjects = 200000, maxEdges = 1000000, throwOnMiss = false} = {}) {
  if (!Number.isSafeInteger(maxObjects) || maxObjects < 1 || !Number.isSafeInteger(maxEdges) || maxEdges < 1) {
    throw new RangeError('Root audit budgets must be positive integers');
  }
  const reachable = traceRootClosure(vm.heap);
  const queue = [{value: vm, path: 'vm'}];
  if (debuggerSession) queue.push({value: debuggerSession, path: 'debugger'});
  for (const session of vm.gcRuntime?.debuggerSessions ?? []) queue.push({value: session, path: 'debugger'});
  const seen = new Set();
  const misses = [];
  const stale = [];
  let edges = 0;
  let truncated = false;
  const enqueue = (owner, key, value, path) => {
    if (++edges > maxEdges) { truncated = true; return; }
    if (!excluded(owner, key, value, vm)) queue.push({value, path});
  };
  for (let cursor = 0; cursor < queue.length && !truncated; cursor++) {
    const {value, path} = queue[cursor];
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    if (isReference(value)) {
      if (!vm.heap.tryGet(value)) stale.push({reference: value, path});
      else if (!reachable.has(identity(value))) misses.push({reference: value, path, category: 'unregistered'});
      continue;
    }
    if (seen.size >= maxObjects) { truncated = true; break; }
    seen.add(value);
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) continue;
    if (value instanceof Map) {
      let index = 0;
      for (const [key, item] of value) {
        enqueue(value, 'map-key', key, `${path}.key(${index})`);
        enqueue(value, 'map-value', item, `${path}.get(${JSON.stringify(typeof key === 'string' ? key : index++)})`);
      }
    } else if (value instanceof Set) {
      let index = 0;
      for (const item of value) enqueue(value, 'set-value', item, `${path}.value(${index++})`);
    } else {
      for (const key of Object.keys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && Object.hasOwn(descriptor, 'value')) enqueue(value, key, descriptor.value, childPath(path, key));
      }
    }
  }
  const result = {success: !misses.length && !truncated, misses, stale, truncated, objectsScanned: seen.size, edgesScanned: edges};
  if (throwOnMiss && !result.success) {
    const error = new Error(truncated ? 'GC root audit exceeded its traversal budget' : `Unreported GC root at ${misses[0].path}`);
    error.code = 'GC_ROOT_MISS';
    error.audit = result;
    throw error;
  }
  return result;
}

export {rootProviderInventory};
