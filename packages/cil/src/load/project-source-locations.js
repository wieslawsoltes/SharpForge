/** Share collision-safe document identities across source and direct-CIL graph views. */
export function prepareProjectSourceLocations(modules) {
  const occurrences = new Map();
  for (const module of modules) {
    for (const uri of new Set(module.image.sources.map(source => source.uri))) {
      occurrences.set(uri, (occurrences.get(uri) ?? 0) + 1);
    }
  }
  for (const module of modules) {
    module.sourceUris = new Map();
    for (const source of module.image.sources) {
      const uri = occurrences.get(source.uri) > 1
        ? 'sharpforge-assembly://' + encodeURIComponent(module.key) + '/' + encodeURIComponent(source.uri) : source.uri;
      module.sourceUris.set(source.uri, uri);
    }
  }
}

export function projectSourceLocation(module, record) {
  const uri = module.sourceUris.get(record.uri) ?? record.uri;
  return {...record, uri, assemblyKey: module.key, ...(uri === record.uri ? {} : {originalUri: record.uri}),
    ...(module.project === undefined ? {} : {project: module.project}),
    ...(module.contextId === undefined ? {} : {contextId: module.contextId})};
}
