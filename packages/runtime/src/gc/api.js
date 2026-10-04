import {initializeArray} from './static-data.js';
import {invokeFixedMemory} from './fixed-memory.js';
import {ManagedFault} from './fault.js';
import {isReference} from './reference.js';
import {gcInteger} from './api-arguments.js';
import {gcCollect, gcCollectionCount, gcGetGeneration, GC_MAX_GENERATION} from './api-collect.js';
import {gcGetTotalMemory, gcGetTotalAllocatedBytes, gcGetAllocatedBytesForCurrentThread, managedGCMemoryInfo} from './api-memory.js';
import {invokeLifetimeGC, resolveWeakTarget} from './lifetime-api.js';
import {invokeGCScalar} from './scalars.js';
import {invokeGCMemorySpan} from './memory-span.js';
import {invokeGCArray} from './api-array.js';

function keepAlive(platform, value) {
  if (isReference(value)) {
    platform.heap.get(value);
    if (platform.vm.gcRuntime) platform.vm.gcRuntime.keepAlive(value);
    else platform.heap.collector.rootBarrier(value);
  }
  return null;
}

function waitNotification(platform, phase, timeout = -1) {
  gcInteger(timeout, 'millisecondsTimeout', -1);
  if (timeout === 0) return platform.heap.notifications.wait(phase, timeout);
  if (platform.vm.gcRuntime?.waitForGCNotification) return platform.vm.gcRuntime.waitForGCNotification(phase, timeout);
  const result = platform.heap.notifications.wait(phase, 0);
  if (result !== 3) return result;
  throw new ManagedFault('PlatformNotSupportedException', 'Pending GC notification waits require a managed scheduler');
}

function noGCRegion(platform, descriptor, values) {
  const hasLoh = descriptor.parameters[1] === 'long';
  const lohSize = hasLoh ? values[1] : null;
  const disallow = values[hasLoh ? 2 : 1] ?? false;
  return platform.managed(platform.heap.settings.tryStartNoGCRegion(values[0], lohSize, disallow), 'bool');
}

const gcHandlers = Object.freeze({
  Collect: (platform, descriptor, raw, values) => gcCollect(platform.heap, {
    generation: values[0] ?? 2, mode: values[1] ?? 0, blocking: values[2] ?? true,
    compacting: values[3] ?? (values[1] === 3 && (values[0] ?? 2) === 2)
  }),
  get_MaxGeneration: () => GC_MAX_GENERATION,
  CollectionCount: (platform, descriptor, raw, values) => gcCollectionCount(platform.heap, values[0]),
  GetGeneration: (platform, descriptor, raw) => {
    const target = descriptor.parameters[0] === 'System.WeakReference' ? resolveWeakTarget(platform, raw[0]) : raw[0];
    return gcGetGeneration(platform.heap, target);
  },
  GetTotalMemory: (platform, descriptor, raw, values) => gcGetTotalMemory(platform.heap, values[0] ?? false),
  GetTotalAllocatedBytes: (platform, descriptor, raw, values) => gcGetTotalAllocatedBytes(platform.heap, values[0] ?? false),
  GetAllocatedBytesForCurrentThread: platform => gcGetAllocatedBytesForCurrentThread(platform.heap),
  GetGCMemoryInfo: (platform, descriptor, raw, values) => managedGCMemoryInfo(platform, values[0] ?? 0),
  AddMemoryPressure: (platform, descriptor, raw, values) => {
    platform.heap.pressure.add(values[0]);
    return null;
  },
  RemoveMemoryPressure: (platform, descriptor, raw, values) => {
    platform.heap.pressure.remove(values[0]);
    return null;
  },
  KeepAlive: (platform, descriptor, raw) => keepAlive(platform, raw[0]),
  RegisterForFullGCNotification: (platform, descriptor, raw, values) => {
    platform.heap.notifications.register(values[0], values[1]);
    return null;
  },
  CancelFullGCNotification: platform => {
    platform.heap.notifications.cancel();
    return null;
  },
  WaitForFullGCApproach: (platform, descriptor, raw, values) => waitNotification(platform, 'approach', values[0] ?? -1),
  WaitForFullGCComplete: (platform, descriptor, raw, values) => waitNotification(platform, 'complete', values[0] ?? -1),
  TryStartNoGCRegion: (platform, descriptor, raw, values) => noGCRegion(platform, descriptor, values),
  EndNoGCRegion: platform => {
    platform.heap.settings.endNoGCRegion();
    return null;
  }
});

const settingProperties = Object.freeze({
  LatencyMode: 'latencyMode', IsServerGC: 'isServerGC', LargeObjectHeapCompactionMode: 'largeObjectHeapCompactionMode'
});

/** Route registered GC contracts for the source VM and direct-CIL engine through one implementation. */
export function invokeGCPlatform(platform, descriptor, args, type) {
  const handler = descriptor.owner === 'System.GC' ? gcHandlers[descriptor.name] : null;
  if (handler) return {handled: true, value: handler(platform, descriptor, args, args.map(value => platform.native(value)))};
  if (descriptor.owner === 'System.Runtime.GCSettings') {
    const key = settingProperties[descriptor.property];
    if (!key) throw new ManagedFault('MissingMethodException', descriptor.name);
    if (descriptor.kind === 'set') {
      platform.heap.settings[key] = platform.native(args[0]);
      return {handled: true, value: null};
    }
    return {handled: true, value: platform.managed(platform.heap.settings[key], descriptor.result)};
  }
  if (type?.family === 'gcMemoryInfo' || type?.family === 'gcGenerationInfo') {
    const reference = args[0]?.byref ? platform.vm.dereference(args[0]) : args[0];
    if (descriptor.kind !== 'get') throw new ManagedFault('MissingMethodException', descriptor.name);
    return {handled: true, value: platform.get(reference, descriptor.property, descriptor.result === 'long' ? 0n : null)};
  }
  if (type?.family === 'gcFixedMemory') return invokeFixedMemory(platform, descriptor, args);
  if (type?.family === 'gcRuntimeHelpers') {
    initializeArray(platform.vm, args[0], args[1]);
    return {handled: true, value: null};
  }
  if (type?.family === 'gcScalar') return invokeGCScalar(platform, descriptor, args);
  if (type?.family === 'gcArray') return invokeGCArray(platform, descriptor, args);
  if (type?.family === 'gcReadOnlySpan') return invokeGCMemorySpan(platform, descriptor, args, type);
  return invokeLifetimeGC(platform, descriptor, args);
}

const legacyHandlers = Object.freeze({
  'GC.Collect': (vm, args) => gcCollect(vm.heap, {generation: args[0] ?? 2}),
  'GC.GetTotalMemory': (vm, args) => gcGetTotalMemory(vm.heap, args[0] ?? false),
  'GC.CollectionCount': (vm, args) => gcCollectionCount(vm.heap, args[0])
});

export function hasLegacyGCBuiltin(name) {
  return Object.hasOwn(legacyHandlers, name);
}

/** Preserve released builtin IDs while unifying their semantics with framework GC contracts. */
export function invokeLegacyGCBuiltin(vm, name, args) {
  const handler = legacyHandlers[name];
  if (!handler) throw new ManagedFault('MissingMethodException', `GC builtin ${name} is unavailable`);
  return handler(vm, args.map(value => vm.value(value)));
}

export const gcIntrinsicImplementations = Object.freeze({
  gcCollect: ({vm, parameters}) => invokeLegacyGCBuiltin(vm, 'GC.Collect', parameters),
  gcMemory: ({vm, parameters}) => invokeLegacyGCBuiltin(vm, 'GC.GetTotalMemory', parameters),
  gcCount: ({vm, parameters}) => invokeLegacyGCBuiltin(vm, 'GC.CollectionCount', parameters)
});

export {GCCollectionMode, GC_MAX_GENERATION, gcCollect, gcCollectionCount, gcGetGeneration} from './api-collect.js';
export {gcGetTotalMemory, gcGetTotalAllocatedBytes, gcGetAllocatedBytesForCurrentThread, gcGetGCMemoryInfo} from './api-memory.js';
export {GCKind} from './memory-info.js';
export {GCSettings, GCLatencyMode, GCLargeObjectHeapCompactionMode} from './settings.js';
export {GCNotifications, GCNotificationStatus} from './notifications.js';
export {GCEvents, GCEventNames, GCReason} from './events.js';
export {GCCounters} from './counters.js';
export {MemoryPressure} from './memory-pressure.js';
export {parseGCConfiguration} from './config.js';
