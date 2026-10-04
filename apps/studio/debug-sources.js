const provenanceFields = ['assemblyKey', 'project', 'contextId'];

/** Retain verified source text for existing viewers and structured identities for workspace navigation. */
export function setDebugSources(state, sources) {
  const texts = new Map();
  const records = new Map();
  const originals = new Map();
  for (const source of sources ?? []) {
    if (typeof source.uri !== 'string' || typeof source.text !== 'string') continue;
    if (texts.has(source.uri) && texts.get(source.uri) !== source.text) {
      throw new Error('Conflicting verified source documents use the same execution URI');
    }
    const previous = records.get(source.uri);
    const origins = [...(previous?.origins ?? []), Object.fromEntries(provenanceFields.map(key => [key, source[key]]))];
    const record = {...source, originalUri: source.originalUri ?? source.uri,
      origins: [...new Map(origins.map(origin => [JSON.stringify(origin), origin])).values()]};
    texts.set(record.uri, record.text);
    records.set(record.uri, record);
    const variants = originals.get(record.originalUri) ?? new Set();
    variants.add(record.uri);
    originals.set(record.originalUri, variants);
  }
  state.debugSources = texts;
  state.debugSourceRecords = records;
  state.debugSourceOriginals = originals;
}

function sourceRecord(state, uri) {
  const text = state.debugSources?.get(uri);
  if (typeof text !== 'string') return null;
  const record = state.debugSourceRecords?.get(uri);
  return record?.text === text ? record : {uri, originalUri: uri, text, origins: []};
}

function compatible(file, source) {
  return provenanceFields.every(key => file[key] === undefined || source[key] === undefined || file[key] === source[key]);
}

function identified(file, source) {
  return provenanceFields.some(key => file[key] !== undefined && file[key] === source[key]);
}

function sourceIdentity(source, point) {
  const specified = provenanceFields.filter(key => point[key] !== undefined);
  const origin = specified.length ? source.origins.find(origin => specified.every(key => origin[key] === point[key]))
    : source.origins.length === 1 ? source.origins[0] : null;
  return {...source, ...Object.fromEntries(provenanceFields.map(key => [key, point[key] ?? origin?.[key]]))};
}

/** Resolve only exact source text and URI/provenance matches; basename guesses never select a workspace file. */
export function workspaceFileForDebugSource(state, executionUri, point = {}) {
  const source = sourceRecord(state, executionUri);
  if (!source) return null;
  const identity = sourceIdentity(source, point);
  const exact = state.files.filter(file => file.uri === executionUri && file.text === source.text && compatible(file, identity));
  if (exact.length === 1 && executionUri !== source.originalUri) return exact[0];
  const matches = state.files.filter(file => file.uri === source.originalUri && file.text === source.text && compatible(file, identity));
  if (matches.length !== 1) return null;
  const file = matches[0];
  const variants = (state.debugSourceOriginals?.get(source.originalUri)?.size ?? 1) > 1 || source.origins.length > 1;
  if ((source.generated || file.generated) && variants && !identified(file, identity)) return null;
  return file;
}

function selectedSource(state) {
  const frame = [...(state.inspectedThreadFrames ?? []), ...(state.debug?.frames ?? [])].find(frame => frame.id === state.frameId);
  return frame?.source ?? state.debug?.point?.uri;
}

/** Translate a current workspace document to one unambiguous execution identity for debugger commands. */
export function debugSourceForWorkspace(state, workspaceUri, preferredUri = selectedSource(state)) {
  const preferred = preferredUri && sourceRecord(state, preferredUri);
  if (preferred && workspaceFileForDebugSource(state, preferredUri)?.uri === workspaceUri) return preferred;
  const possible = new Set([workspaceUri, ...(state.debugSourceOriginals?.get(workspaceUri) ?? [])]);
  const matches = [...possible].filter(uri => workspaceFileForDebugSource(state, uri)?.uri === workspaceUri);
  return matches.length === 1 ? sourceRecord(state, matches[0]) : null;
}

/** Convert an execution point for editor painting without changing the executable point's identity. */
export function workspaceDebugPoint(state, point, workspaceUri) {
  const executionUri = point?.uri ?? point?.source;
  if (!executionUri || workspaceFileForDebugSource(state, executionUri, point)?.uri !== workspaceUri) return null;
  return {...point, uri: workspaceUri, executionUri};
}

/** Navigate a stop/frame to matching workspace text, otherwise to the existing read-only verified-source viewer. */
export function navigateDebugSource(host, point) {
  const uri = point?.uri ?? point?.source;
  const source = uri && sourceRecord(host.state, uri);
  const file = uri && workspaceFileForDebugSource(host.state, uri, point);
  if (file) {
    host.openFile(file.uri);
    host.getEditor().gotoLine(point.line ?? 1, point.column ?? 1);
    return {kind: 'workspace', uri: file.uri, executionUri: uri};
  }
  if (source) {
    host.showSymbolSource({...point, uri});
    return {kind: 'embedded', uri};
  }
  if (host.state.debug?.profile === 'managed-il') host.setPanel('disassembly');
  return {kind: 'unavailable', uri: uri ?? null};
}
