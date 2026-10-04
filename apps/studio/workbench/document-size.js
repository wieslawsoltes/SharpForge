export const AUTOMATIC_DOCUMENT_CHARACTERS = 8_000_000;

/** Determine UTF-16 size without materializing an EditorModel-backed document's lazy text getter. */
export function documentSize(documents, record) {
  const model = documents.models?.get(record.uri) ?? record.model;
  const length = model?.buffer?.length ?? model?.length ?? record.length ?? record.size;
  if (Number.isSafeInteger(length) && length >= 0) return length;
  const descriptor = Object.getOwnPropertyDescriptor(record, 'text');
  return typeof descriptor?.value === 'string' ? descriptor.value.length : null;
}

/** Reject an oversized source set before reading any lazy text or crossing a worker boundary. */
export function boundedDocuments(documents, records, {maxFile = 100_000_000, maxTotal = 100_000_000} = {}) {
  let total = 0;
  for (const record of records) {
    const size = documentSize(documents, record);
    if (size === null) throw new Error('Document size metadata is unavailable: ' + record.uri);
    total += size;
    if (size > maxFile || total > maxTotal) throw new RangeError('Source operation exceeds its text size limit: ' + record.uri);
  }
  return records.map(record => ({uri: record.uri, text: record.text, version: record.version,
    projectId: record.projectId ?? documents.projectsFor?.(record.uri)?.[0]}));
}
