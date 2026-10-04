/** Preserve original locations; equal file names from different assemblies receive distinct virtual source URIs. */
export function projectDebugInfo(modules, metadata) {
  const sourceUri = (module, uri) => module.sourceUris.get(uri) ?? uri;
  const sources = new Map();
  const methods = [];
  const sequencePoints = [];
  const points = new Map();
  const methodIds = new Map();
  for (const module of modules) {
    const debug = module.inspector.debug;
    const offset = methods.length;
    const provenance = {assemblyKey: module.key,
      ...(module.project === undefined ? {} : {project: module.project}),
      ...(module.contextId === undefined ? {} : {contextId: module.contextId})};
    for (const method of debug.methods) {
      const value = {...method, id: offset + method.id, token: metadata.mapToken(module, method.token),
        ...provenance, originalToken: method.token};
      if (method.sourceRange) value.sourceRange = {...method.sourceRange,
        uri: sourceUri(module, method.sourceRange.uri), originalUri: method.sourceRange.uri, ...provenance};
      methods.push(value);
      methodIds.set(value.token, value.id);
    }
    for (const point of debug.sequencePoints) {
      const value = {...point, id: sequencePoints.length, methodId: offset + point.methodId,
        methodToken: metadata.mapToken(module, point.methodToken), uri: sourceUri(module, point.uri),
        originalUri: point.uri, originalToken: point.methodToken, ...provenance};
      sequencePoints.push(value);
      points.set(module.index + ':' + point.id, value);
    }
    for (const source of debug.sources) {
      const uri = sourceUri(module, source.uri);
      if (!sources.has(uri)) sources.set(uri, {...source, uri, originalUri: source.uri, ...provenance});
    }
  }
  return {debug: {...modules[0].inspector.debug, methods, sequencePoints, sources: [...sources.values()]}, points, methodIds};
}
