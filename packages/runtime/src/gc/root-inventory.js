/** Reviewed ownership boundaries, not hashes of implementation text. */
export const rootProviderInventory = Object.freeze([
  {id: 'active-frames', category: 'stack', owner: 'vm', provider: 'visitVMRoots'},
  {id: 'static-and-caches', category: 'static', owner: 'vm', provider: 'visitVMRoots'},
  {id: 'scheduler-contexts', category: 'scheduler', owner: 'scheduler', provider: 'visitSchedulerRoots'},
  {id: 'host-operations', category: 'host-operation', owner: 'hostOperations', provider: 'visitRoots'},
  {id: 'host-payload-operation', category: 'host-operation', owner: 'HostPayloadRoots', provider: 'visitPayloadRoots'},
  {id: 'platform-and-animation', category: 'interop', owner: 'platform', provider: 'visitPlatformRoots'},
  {id: 'assembly-context-bridge', category: 'interop', owner: 'gcRuntime.rootRegistry', provider: 'registerContextRoots'},
  {id: 'strong-handles', category: 'handle', owner: 'heap.lifetime', provider: 'visitStrongRoots'},
  {id: 'temporary-and-pin', category: 'pinned', owner: 'heap', provider: 'visitRoots'},
  {id: 'finalizer-contexts', category: 'finalizer', owner: 'heap.lifetime', provider: 'visitStrongRoots'},
  {id: 'debugger-stops', category: 'debugger', owner: 'debuggerRoots', provider: 'visitStrongRoots'},
  {id: 'debugger-memory', category: 'pinned', owner: 'debuggerMemory', provider: 'PinManager.visitRoots'}
].map(Object.freeze));

/** Heap storage is traced independently; code/host resources and copied history are not live roots. */
export const rootAuditBoundaries = Object.freeze({
  heap: 'Precise heap traversal, handles and finalizers are audited separately.',
  image: 'Immutable compiler output contains no live managed references.',
  inspector: 'Immutable assembly metadata contains no live managed references.',
  report: 'Verification metadata contains no live managed references.',
  method: 'Executable method metadata is not execution state.',
  methodTables: 'Immutable runtime type metadata is not managed object storage.',
  layoutCache: 'Derived field layouts contain type metadata only.',
  _typeSystem: 'Derived metadata contains no managed instances.',
  options: 'Host configuration and callback closures require explicit handles.',
  history: 'History contains independent copied heaps; restoring uses owner-checked snapshots.',
  sourceIndex: 'Debugger source mapping metadata.',
  symbols: 'Debugger symbol metadata.',
  expressionCache: 'Parsed debugger expressions contain no managed references.',
  propertyIndexes: 'WeakMap entries index heap records already covered by heap tracing.',
  allocationSites: 'Source-site diagnostics contain no managed values.',
  platformResource: 'Opaque SafeHandle service; managed resource roots belong to the lifetime visitor.',
  safepoints: 'Root publishing callbacks are owned by RootRegistry.',
  rootRegistry: 'Callbacks are audited through registered root providers.',
  finalizerRunners: 'Parked execution states are explicitly visited as finalizer roots.'
});
