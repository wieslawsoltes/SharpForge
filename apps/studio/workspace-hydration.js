/** Export must materialize original bytes before any encoder sees a metadata-only file. */
export async function hydrateWorkspaceRecords(context, {signal} = {}) {
  const disk = context.disk;
  const records = [];
  for (const record of context.records) {
    if (signal?.aborted) throw new DOMException('Project preparation cancelled', 'AbortError');
    if (!record.lazy) { records.push(record); continue; }
    if (!disk?.load) throw new Error('Original file bytes are unavailable: ' + record.path);
    const loaded = await disk.load(record.path, {signal});
    records.push(typeof record.text === 'string' ? {...loaded, text: record.text, version: record.version} : loaded);
  }
  return records;
}
