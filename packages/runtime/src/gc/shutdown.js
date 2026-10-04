/** .NET Core policy: shutdown does not invoke pending managed finalizers. */
export const GCShutdownPolicy = Object.freeze({runPendingFinalizers: false, releaseHostResources: true});

/** Synchronous, idempotent session teardown; every resource is attempted after a failure. */
export function shutdownLifetime(lifetime) {
  if (lifetime.closed) return lifetime.shutdownReport;
  lifetime.closed = true;
  const discardedFinalizers = lifetime.finalizers.shutdown();
  const resources = lifetime.resources.releaseAll({skipManaged: true});
  const releasedHandles = lifetime.heap.handles.size;
  for (const id of lifetime.heap.handles.keys()) lifetime.hostHandles.releaseId(id);
  const releasedPins = lifetime.pinning.releaseAll();
  for (const item of lifetime.conditionalTables.values()) item.table.dispose();
  lifetime.conditionalTables.clear();
  lifetime.tableOwners.clear();
  lifetime.safeHandles.clear();
  lifetime.shutdownReport = {discardedFinalizers, releasedHandles, releasedPins,
    releasedResources: resources.released, errors: resources.errors};
  return lifetime.shutdownReport;
}
