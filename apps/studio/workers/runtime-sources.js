/** Preserve executable source identities and optional project provenance across the worker boundary. */
export function runtimeSourceRecords(session) {
  const sources = session.vm.image?.sources ?? session.vm.inspector?.debug?.sources ?? [];
  return sources.map(source => {
    const record = {uri: source.uri, text: source.text};
    for (const key of ['version', 'originalUri', 'assemblyKey', 'project', 'contextId', 'generated']) {
      if (source[key] !== undefined) record[key] = source[key];
    }
    return record;
  });
}
