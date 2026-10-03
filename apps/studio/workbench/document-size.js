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

/** Read one bounded UTF-16 range; large lazy records require an indexed model instead of whole-text fallback. */
export function readDocumentRange(documents, record, {start = 0, end, limit = 65536} = {}) {
  const length = documentSize(documents, record);
  if (length === null) throw new Error('Document size metadata is unavailable: ' + record.uri);
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1_000_000) {
    throw new RangeError('Invalid document range');
  }
  start = Math.min(start, length);
  end ??= Math.min(length, start + limit);
  if (!Number.isSafeInteger(end) || end < start || end > length || end - start > limit) throw new RangeError('Document range exceeds its limit');
  const model = documents.models?.get(record.uri) ?? record.model;
  const eager = Object.getOwnPropertyDescriptor(record, 'text')?.value;
  let text;
  if (model?.getText) text = model.getText(start, end);
  else if (typeof eager === 'string') text = eager.slice(start, end);
  else if (length <= limit) text = record.text.slice(start, end);
  else throw new Error('An indexed range reader is required for this large document: ' + record.uri);
  return {text, start, end, length, truncated: start !== 0 || end !== length};
}
