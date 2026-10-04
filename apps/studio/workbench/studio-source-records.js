/** Copy metadata and lazy source accessors without reading source text. A caller may normalize path before model adoption. */
export function studioSourceRecord(record, { path = record.path ?? record.uri, version = record.version ?? 1 } = {}) {
  const descriptors = Object.getOwnPropertyDescriptors(record);
  descriptors.path = { value: path, enumerable: true, configurable: true, writable: true };
  descriptors.uri = { value: path, enumerable: true, configurable: true, writable: true };
  descriptors.version = { value: version, enumerable: true, configurable: true, writable: true };
  for (const key of ['model', 'source', 'originalSource', 'length']) {
    if (descriptors[key]) descriptors[key] = { ...descriptors[key], enumerable: false, configurable: true };
  }
  return Object.defineProperties({}, descriptors);
}

/** Release staged input models after workspace loading. Models adopted by the current document owner remain live. */
export function releaseStudioSources(records, documents) {
  const failures = [];
  const models = new Set(records.map(record => record.model).filter(Boolean));
  for (const model of models) {
    if (documents.ownsModel(model) || model.disposed) continue;
    try { model.dispose(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Prepared sources could not be released');
}
