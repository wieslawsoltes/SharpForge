import {ManagedFault} from './fault.js';
import {HostHandleKind} from './host-handles.js';
import {ManagedGCHandle, GCHandleType} from './gc-handle.js';
import {sameReference, lifetimeFault} from './lifetime-state.js';
import {resolveManagedReceiver as receiver, writeManagedOut as writeOut} from './managed-out.js';
import {invokeSafeHandle, isSafeHandleContract} from './safe-handle-api.js';

const gcHandleName = 'System.Runtime.InteropServices.GCHandle';
const weakName = 'System.WeakReference';
const tableName = 'System.Runtime.CompilerServices.ConditionalWeakTable';
const unhandled = Object.freeze({handled: false, value: undefined});
const handled = value => ({handled: true, value});
const weakType = name => name === weakName || name.startsWith(`${weakName}\`1<`);
const tableType = name => name.startsWith(`${tableName}\`2<`);

function managedHandle(platform, reference) {
  return new ManagedGCHandle(platform.heap.lifetime, platform.get(reference, '$gcHandle'));
}

function wrapHandle(platform, handle) {
  return platform.make(gcHandleName, {$gcHandle: handle.handle});
}

/** Extract a managed WeakReference target without storing a strong target field in its wrapper. */
export function resolveWeakTarget(platform, reference) {
  const record = platform.heap.get(reference);
  if (!weakType(record.type)) throw new ManagedFault('ArgumentException', 'A managed WeakReference is required');
  return platform.heap.lifetime.getHandle(platform.get(reference, '$gcHandle'));
}

function invokeWeak(platform, descriptor, args) {
  const lifetime = platform.heap.lifetime;
  if (descriptor.kind === 'constructor') {
    const trackResurrection = args.length > 1 && !!platform.native(args[1]);
    const reference = platform.make(descriptor.owner, {$gcHandle: null});
    return platform.heap.withRoots([reference, args[0]], () => {
      const handle = lifetime.createHandle(args[0] ?? null, {kind: trackResurrection ? HostHandleKind.WeakLong : HostHandleKind.WeakShort,
        owner: 'managed-weak-reference', managedOwner: reference});
      platform.set(reference, '$gcHandle', handle);
      return reference;
    });
  }
  const reference = receiver(platform, args[0]);
  const handle = platform.get(reference, '$gcHandle');
  const entry = lifetime.hostHandles.entry(handle, true);
  const target = lifetime.getHandle(handle);
  if (descriptor.name === 'get_Target') return target;
  if (descriptor.name === 'get_IsAlive') return platform.managed(target !== null, 'bool');
  if (descriptor.name === 'get_TrackResurrection') return platform.managed(entry.kind === HostHandleKind.WeakLong, 'bool');
  if (descriptor.name === 'set_Target' || descriptor.name === 'SetTarget') {
    lifetime.setHandle(handle, args[1]);
    return null;
  }
  if (descriptor.name === 'TryGetTarget' || descriptor.name === '$TryGetTargetCell') {
    writeOut(platform, args[1], target);
    return platform.managed(target !== null, 'bool');
  }
  throw new ManagedFault('MissingMethodException', `${descriptor.owner}::${descriptor.name}`);
}

function invokeGCHandle(platform, descriptor, args) {
  if (descriptor.name === 'Alloc') {
    const type = args.length > 1 ? Number(platform.native(args[1])) : GCHandleType.Normal;
    return wrapHandle(platform, ManagedGCHandle.alloc(platform.heap, args[0], type, {owner: 'managed-gchandle'}));
  }
  if (descriptor.name === 'FromIntPtr') return wrapHandle(platform, ManagedGCHandle.fromIntPtr(platform.heap, args[0]));
  const reference = receiver(platform, args[0]);
  const handle = managedHandle(platform, reference);
  if (descriptor.name === 'get_IsAllocated') return platform.managed(handle.isAllocated, 'bool');
  if (descriptor.name === 'get_Target') return handle.target;
  if (descriptor.name === 'set_Target') {
    handle.target = args[1];
    return null;
  }
  if (descriptor.name === 'Free') {
    handle.free();
    return null;
  }
  if (descriptor.name === 'ToIntPtr') return handle.toIntPtr();
  if (descriptor.name === 'AddrOfPinnedObject') return handle.addrOfPinnedObject();
  throw new ManagedFault('MissingMethodException', `${gcHandleName}::${descriptor.name}`);
}

function requireTable(platform, reference) {
  const id = platform.get(reference, '$gcTableId');
  const item = platform.heap.lifetime.conditionalTables.get(id);
  if (!item || !sameReference(item.owner, reference)) throw lifetimeFault('The managed conditional weak table is invalid');
  return item.table;
}

function invokeTable(platform, descriptor, args) {
  if (descriptor.kind === 'constructor') {
    const reference = platform.make(descriptor.owner, {$gcTableId: null});
    return platform.heap.withRoots([reference], () => {
      const table = platform.heap.lifetime.createConditionalWeakTable({owner: 'managed-conditional-weak-table', managedOwner: reference});
      platform.set(reference, '$gcTableId', table.id);
      return reference;
    });
  }
  const table = requireTable(platform, receiver(platform, args[0]));
  if (descriptor.name === 'Add') {
    table.add(args[1], args[2]);
    return null;
  }
  if (descriptor.name === 'Remove') return platform.managed(table.remove(args[1]), 'bool');
  if (descriptor.name === 'Clear') {
    table.clear();
    return null;
  }
  if (descriptor.name === 'TryGetValue' || descriptor.name === '$TryGetValueCell') {
    const result = table.tryGetValue(args[1]);
    writeOut(platform, args[2], result.value);
    return platform.managed(result.success, 'bool');
  }
  if (descriptor.name === 'GetValue' || descriptor.name === '$GetValueDelegate') {
    if (args[2] === null || args[2] === undefined) throw new ManagedFault('ArgumentNullException', 'createValueCallback');
    const factory = typeof args[2] === 'function' ? args[2] : platform.heap.lifetime.dependentValueFactory?.(platform, args[2]);
    if (typeof factory !== 'function') {
      throw new ManagedFault('NotSupportedException', 'The runtime must install a managed ConditionalWeakTable value-factory executor');
    }
    return table.getValue(args[1], factory);
  }
  throw new ManagedFault('MissingMethodException', `${descriptor.owner}::${descriptor.name}`);
}

function invokeFinalization(platform, descriptor, args) {
  const lifetime = platform.heap.lifetime;
  if (descriptor.name === 'WaitForPendingFinalizers') {
    if (lifetime.waitForPendingFinalizersHook) return handled(lifetime.waitForPendingFinalizersHook());
    lifetime.waitForPendingFinalizers();
    return handled(null);
  }
  if (descriptor.name !== 'SuppressFinalize' && descriptor.name !== 'ReRegisterForFinalize') return unhandled;
  if (args[0] === null || args[0] === undefined) throw new ManagedFault('ArgumentNullException', 'Finalization target is null');
  if (descriptor.name === 'SuppressFinalize') lifetime.suppressFinalize(args[0]);
  else lifetime.reRegisterForFinalize(args[0]);
  return handled(null);
}

/** Closed ABI router used by the framework GC contribution in both managed engines. */
export function invokeLifetimeGC(platform, descriptor, args) {
  const owner = descriptor.owner ?? '';
  if (owner === 'System.GC') return invokeFinalization(platform, descriptor, args);
  if (isSafeHandleContract(owner)) return platform.heap.withRoots(args, () => handled(invokeSafeHandle(platform, descriptor, args)));
  const handler = owner === gcHandleName ? invokeGCHandle : weakType(owner) ? invokeWeak : tableType(owner) ? invokeTable : null;
  return handler ? platform.heap.withRoots(args, () => handled(handler(platform, descriptor, args))) : unhandled;
}
