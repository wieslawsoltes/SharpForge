import {executionCodeState} from './code-version.js';
import {instantiatedMethod} from './generics.js';

/** Record closed instantiations by stable MethodDef, declaring type and method arguments. */
export function captureGenericInstantiations(vm) {
  const entries = executionCodeState(vm).generics?.entries;
  return entries ? [...entries.values()].map(([token, owner, arguments_]) => [token, owner, [...arguments_]]) : [];
}

/** An isolated cache resolves portable methods without changing the VM's current code epoch. */
export function snapshotResolutionContext(vm) {
  const context = Object.create(vm);
  if (vm.inspector) Object.defineProperty(context, 'typeSystem', {value: vm.typeSystem});
  return context;
}

/** Preflight all closed instantiation keys before a successful restore installs the derived cache. */
export function prepareGenericInstantiations(vm, keys) {
  if (!Array.isArray(keys) || keys.length > (vm.options.maxGenericInstantiations ?? 100000)) {
    throw new TypeError('Invalid snapshot generic instantiation cache');
  }
  const context = snapshotResolutionContext(vm), seen = new Set();
  for (const row of keys) {
    if (!Array.isArray(row) || row.length !== 3 || !Number.isSafeInteger(row[0]) ||
        row[1] !== null && typeof row[1] !== 'string' || !Array.isArray(row[2]) ||
        row[2].length > 1024 || row[2].some(type => typeof type !== 'string' || type.length > 16384)) {
      throw new TypeError('Invalid snapshot generic instantiation key');
    }
    const key = JSON.stringify(row);
    if (seen.has(key)) throw new TypeError('Duplicate snapshot generic instantiation key');
    seen.add(key);
    instantiatedMethod(context, row[0], row[1], row[2]);
  }
  return executionCodeState(context).generics;
}

function sameMethodMetadata(left, right) {
  const pending = [[left, right]], seen = new Map();
  let items = 0;
  while (pending.length) {
    if (++items > 100000) return false;
    const [actual, expected] = pending.pop();
    if (Object.is(actual, expected)) continue;
    if (!actual || !expected || typeof actual !== 'object' || typeof expected !== 'object' ||
        Array.isArray(actual) !== Array.isArray(expected) || Object.getPrototypeOf(actual) !== Object.getPrototypeOf(expected)) return false;
    if (seen.has(actual)) { if (seen.get(actual) !== expected) return false; continue; }
    seen.set(actual, expected);
    const names = Object.keys(actual);
    if (names.length !== Object.keys(expected).length || Array.isArray(actual) && actual.length !== expected.length) return false;
    for (const name of names) {
      const a = Object.getOwnPropertyDescriptor(actual, name), b = Object.getOwnPropertyDescriptor(expected, name);
      if (!a || !b || !Object.hasOwn(a, 'value') || !Object.hasOwn(b, 'value')) return false;
      pending.push([a.value, b.value]);
    }
  }
  return true;
}

function retainCapturedMethod(vm, cache, captured, prepared) {
  if (!sameMethodMetadata(captured, prepared)) throw new TypeError('Snapshot generic method execution metadata differs');
  const key = cache?.entries.get(prepared);
  if (!key) return prepared;
  const [token, ownerName, arguments_] = key;
  const entry = {token, owner: ownerName === null ? null : vm.heap.methodTables.get(ownerName),
    methodHandles: arguments_.map(type => vm.heap.methodTables.get(type))};
  cache.node(entry).set('method', captured);
  cache.entries.delete(prepared);
  cache.entries.set(captured, key);
  return captured;
}

/** Restored frames use the exact canonical method objects installed in their new code cache. */
export function bindRestoredGenericMethods(vm, values, cache) {
  const context = snapshotResolutionContext(vm);
  executionCodeState(context).generics = cache;
  const keys = new Set([...(cache?.entries.values() ?? [])].map(value => JSON.stringify(value)));
  const seen = new Set(), adopted = new Map(), frames = [...values.get('frames')];
  for (const [, saved] of values.get('scheduler')?.contexts ?? []) frames.push(...saved.frames);
  for (const frame of frames) {
    if (seen.has(frame)) continue;
    seen.add(frame);
    const method = frame.method;
    if ((method.genericIdentity !== undefined || method.methodArguments !== undefined) &&
        !keys.has(JSON.stringify([method.token, method.genericIdentity ?? null, [...(method.methodArguments ?? [])]]))) {
      throw new TypeError('Snapshot generic frame has no matching instantiation key');
    }
    const key = JSON.stringify([method.token, method.genericIdentity ?? null, [...(method.methodArguments ?? [])]]);
    const canonical = instantiatedMethod(context, method.token, method.genericIdentity ?? null, [...(method.methodArguments ?? [])]);
    if (adopted.has(key)) {
      if (!sameMethodMetadata(method, canonical)) throw new TypeError('Snapshot generic frame metadata differs');
      frame.method = adopted.get(key);
    } else {
      frame.method = retainCapturedMethod(vm, cache, method, canonical);
      adopted.set(key, frame.method);
    }
  }
}
