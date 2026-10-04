import { documentSource } from './document-source.js';

function recordView(record, path, source, model, buffer) {
  const descriptors = Object.getOwnPropertyDescriptors(record);
  descriptors.path = { value: path, enumerable: true, writable: true, configurable: true };
  const snapshot = documentSource(source, model);
  if (snapshot || source || buffer) {
    const fallback = snapshot ? null : source ?? buffer;
    descriptors.text = { enumerable: true, configurable: true, get: () => snapshot ? snapshot.text : fallback.text };
    descriptors.length = { enumerable: false, configurable: true, get: () => snapshot?.length ?? fallback.length ?? fallback.text.length };
    descriptors.model = { value: model, enumerable: false, configurable: true };
    if (snapshot) descriptors.source = { value: snapshot, enumerable: false, configurable: true };
    if (snapshot) descriptors.version = { value: snapshot.version, enumerable: true, configurable: true };
  }
  return Object.defineProperties({}, descriptors);
}

/** Tree/property views inspect metadata without flattening source buffers; explicit serializers read captured text. */
export function createStudioRecords({ state, documents, nativeBuild }) {
  let raw;
  if (state.nativeMode) raw = state.nativeWorkspace?.files ?? [];
  else if (state.projectSystem) raw = [...state.projectSystem.files.values()];
  else {
    const disk = new Map((state.disk?.records ?? []).map(record => [record.path, record]));
    raw = [...state.extraFiles, ...documents.list().map(source => disk.get(source.uri) ?? { path: source.uri })];
  }
  return raw.map(record => {
    const path = record.path ?? record.uri;
    const source = documents.records.get(path);
    const model = documents.models.get(path);
    const buffer = state.nativeMode ? nativeBuild.buffers.get(path) : null;
    return recordView(record, path, source, model, buffer);
  });
}
