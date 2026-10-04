/** Atomic close preflight. Every decision and save completes before any tab is closed. */
export async function prepareDocumentClose(documents, uris, confirm, { signal } = {}) {
  const unique = [...new Set(uris)];
  const captured = unique.map(uri => ({ uri, record: documents.get(uri) })).filter(item => item.record);
  const revisions = new Map(captured.map(({ uri, record }) => [uri, { version: record.version, text: record.text }]));
  const dirty = captured.filter(({ record }) => record.dirty).map(({ uri, record }) => ({ uri, title: record.title ?? uri, version: record.version }));
  const decisions = new Map();
  if (dirty.length) {
    if (typeof confirm !== 'function') throw Object.assign(new Error('Unsaved documents require an explicit close choice'), { code: 'SFTABS001' });
    const answer = await confirm(dirty, { signal });
    if (signal?.aborted || answer === null || answer === false || answer === 'cancel') return null;
    for (const item of dirty) {
      const choice = typeof answer === 'string' ? answer : answer instanceof Map ? answer.get(item.uri) : answer[item.uri];
      if (choice === 'cancel' || choice === undefined) return null;
      if (!['save', 'discard'].includes(choice)) throw new Error(`Invalid close choice for ${item.uri}`);
      decisions.set(item.uri, choice);
    }
  }
  for (const { uri } of captured) {
    if (signal?.aborted) return null;
    assertUnchanged(documents.get(uri), revisions.get(uri), uri);
  }
  for (const [uri, choice] of decisions) {
    if (signal?.aborted) return null;
    if (choice !== 'save') continue;
    const result = await documents.save(uri, { signal });
    if (result === false || result?.ok === false || documents.get(uri)?.dirty) {
      throw Object.assign(new Error(`Could not save ${uri}; no documents were closed`), { code: 'SFTABS002' });
    }
    const record = documents.get(uri);
    revisions.set(uri, { version: record?.version, text: record?.text });
  }
  if (signal?.aborted) return null;
  for (const { uri } of captured) assertUnchanged(documents.get(uri), revisions.get(uri), uri);
  return { uris: unique, decisions, revisions };
}

export function assertUnchanged(record, revision, uri) {
  if (!record || record.version !== revision.version || record.text !== revision.text) {
    throw Object.assign(new Error(`${uri} changed while awaiting the close decision; no documents were closed`), { code: 'SFTABS003' });
  }
}
