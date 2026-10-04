function memoryMetadata(adapter, value) {
  if (!adapter.supportsMemoryReferences || adapter.session.vm.state !== 'paused') return {};
  const raw = value.reference ?? value.raw ?? value.value;
  if (!raw || typeof raw !== 'object') return {};
  const memoryReference = adapter.session.memoryReference(raw);
  return memoryReference ? {memoryReference} : {};
}

/** Preserve existing variable handles; clients opt into per-stop pinned payload references. */
export function debugVariable(adapter, value) {
  return {name: value.name, value: value.value, type: value.type,
    variablesReference: value.reference ? adapter.reference({kind: 'heap', ref: value.reference}) : 0,
    ...memoryMetadata(adapter, value)};
}

/** Format ordinary and explicitly consented evaluations through one memory-metadata path. */
export function debugEvaluation(adapter, value) {
  return {result: value.result, type: value.type,
    ...(Object.hasOwn(value, 'committed') ? {committed: value.committed} : {}),
    variablesReference: value.reference ? adapter.reference({kind: 'heap', ref: value.reference}) : 0,
    ...memoryMetadata(adapter, value)};
}
