function snapshot(value, uri) {
  return value && Object.isFrozen(value) && value.uri === uri && Number.isSafeInteger(value.version) && value.version >= 0
    && typeof value.getText === 'function';
}

/** Capture source and saved baseline for a validated same-workspace file operation, without retaining its live model. */
export function captureDocumentState(owner, uri) {
  const record = owner.require(uri);
  const source = owner.models.get(uri)?.snapshot() ?? record.text;
  const dirty = owner.dirtyFiles.has(uri);
  return Object.freeze({
    uri, version: record.version, source,
    baseline: dirty ? owner.baselines.get(uri) : source,
    dirty, staleSave: owner.staleSaves.has(uri)
  });
}

/** Imported operation state must describe this exact staged revision; it cannot silently mark different content saved. */
export function validateDocumentState(value, record, source) {
  if (!value || value.uri !== record.uri || value.version !== record.version
      || typeof value.dirty !== 'boolean' || typeof value.staleSave !== 'boolean') {
    throw new TypeError('Invalid restored document state');
  }
  const plain = Object.getOwnPropertyDescriptor(record, 'text')?.value;
  if (value.source !== source && !(typeof value.source === 'string' && value.source === plain)) {
    throw new TypeError('Restored document state must match the staged source snapshot');
  }
  if (value.baseline !== null && typeof value.baseline !== 'string' && !snapshot(value.baseline, record.uri)) {
    throw new TypeError('Restored document baseline must be text or a matching immutable source snapshot');
  }
  if (!value.dirty && (value.baseline !== value.source || value.staleSave)) {
    throw new TypeError('A clean document state must save its exact source snapshot');
  }
  return value;
}
