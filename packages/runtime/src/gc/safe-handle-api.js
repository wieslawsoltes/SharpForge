import {ManagedFault} from './fault.js';
import {ManagedSafeHandle} from './safe-handle.js';
import {sameReference, lifetimeFault} from './lifetime-state.js';
import {resolveManagedReceiver, writeManagedOut} from './managed-out.js';

const safeHandleName = 'System.Runtime.InteropServices.SafeHandle';
const criticalName = 'System.Runtime.ConstrainedExecution.CriticalFinalizerObject';

export function isSafeHandleContract(owner) {
  return owner === safeHandleName || owner === criticalName;
}

function invokeOverride(platform, reference, name) {
  const invoke = platform.heap.lifetime.managedInstanceInvoker;
  if (typeof invoke !== 'function') {
    throw new ManagedFault('NotSupportedException', 'The runtime must install the managed SafeHandle override executor');
  }
  return platform.native(invoke(reference, name, []));
}

function stateFor(platform, reference) {
  platform.heap.get(reference);
  const entry = platform.heap.lifetime.safeHandles.get(reference.h);
  if (!entry || !sameReference(entry.reference, reference)) throw lifetimeFault('The managed SafeHandle is not initialized');
  return platform.heap.lifetime.resources.entry(entry.token);
}

function initialize(platform, args) {
  if (args.length !== 3) throw new ManagedFault('MemberAccessException', 'SafeHandle is abstract and requires a derived instance');
  const reference = resolveManagedReceiver(platform, args[0]);
  platform.heap.get(reference);
  new ManagedSafeHandle(platform.heap, args[1], () => !!invokeOverride(platform, reference, 'ReleaseHandle'), {
    owner: 'managed-safe-handle', reference, ownsHandle: !!platform.native(args[2]), managedRelease: true,
    isInvalid: () => !!invokeOverride(platform, reference, 'get_IsInvalid')
  });
  return null;
}

/** Managed SafeHandle base methods use side tables, preserving derived-class field layout. */
export function invokeSafeHandle(platform, descriptor, args) {
  if (descriptor.owner === criticalName) {
    if (descriptor.name === '$InitializeCriticalFinalizer') {
      const reference = resolveManagedReceiver(platform, args[0]);
      platform.heap.get(reference);
      const entry = platform.heap.lifetime.finalizers.entries.get(reference.h);
      if (entry && sameReference(entry.reference, reference)) entry.critical = true;
      return null;
    }
    if (descriptor.kind === 'constructor') return args.length ? null : platform.make(criticalName);
    if (descriptor.name === 'Finalize') return null;
  }
  if (descriptor.kind === 'constructor' || descriptor.name === '$InitializeSafeHandle') return initialize(platform, args);
  const reference = resolveManagedReceiver(platform, args[0]);
  const lifetime = platform.heap.lifetime;
  const entry = stateFor(platform, reference);
  if (descriptor.name === 'get_IsClosed') return platform.managed(entry.closed || entry.closeRequested, 'bool');
  if (descriptor.name === 'get_IsInvalid') return platform.managed(lifetime.resources.isInvalid(entry.token), 'bool');
  if (descriptor.name === 'DangerousGetHandle' || descriptor.name === '$get_Handle') return entry.resource;
  if (descriptor.name === 'SetHandle' || descriptor.name === '$set_Handle') {
    if (entry.closed || entry.closeRequested) throw new ManagedFault('ObjectDisposedException', 'The SafeHandle is closed');
    entry.resource = args[1];
    return null;
  }
  if (descriptor.name === 'DangerousAddRef' || descriptor.name === '$DangerousAddRefCell') {
    writeManagedOut(platform, args[1], platform.managed(false, 'bool'));
    lifetime.resources.addRef(entry.token);
    writeManagedOut(platform, args[1], platform.managed(true, 'bool'));
    return null;
  }
  if (descriptor.name === 'DangerousRelease') {
    lifetime.resources.releaseRef(entry.token);
    return null;
  }
  if (descriptor.name === 'SetHandleAsInvalid') entry.invalid = true;
  if (['SetHandleAsInvalid', 'Close', 'Dispose', 'Finalize'].includes(descriptor.name)) {
    lifetime.resources.close(entry.token);
    return null;
  }
  if (descriptor.name === 'ReleaseHandle') return platform.managed(!!invokeOverride(platform, reference, 'ReleaseHandle'), 'bool');
  throw new ManagedFault('MissingMethodException', `${descriptor.owner}::${descriptor.name}`);
}
