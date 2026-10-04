import {validateItemPath} from '@sharpforge/project-system';
import {workspaceDocumentStates} from '../workspace-source-records.js';
import {captureNativeRecord, checkNativeOwnership, nativeRecordFromRead, nativeRecordIsDirty,
  nativeRecordSource, nativeWorkspaceIdentity} from './document-records.js';
import {replaceNativeDocuments} from './document-replacement.js';
import {invalidateNativeCompilation} from './workspace-state.js';

const within = (path, root) => path === root || path.startsWith(root + '/');
const mapped = (path, mappings) => {
  if (typeof path !== 'string') return path;
  const match = mappings.find(value => within(path, value.from));
  return match ? match.to + path.slice(match.from.length) : path;
};

function captureRefresh(host, signal) {
  const {state, documents, nativeBuild} = host;
  const identity = nativeWorkspaceIdentity(state);
  checkNativeOwnership(state, identity, signal);
  const client = nativeBuild.client;
  if (!client) throw new Error('Connect the native host before refreshing documents');
  const revision = state.revision;
  const documentRevision = documents?.revision;
  const originals = (documents?.files ?? state.files).map(record => ({
    record: captureNativeRecord(record, {models: true}), source: nativeRecordSource(record),
    model: record.model, version: record.version, uri: record.uri ?? record.path
  }));
  const states = workspaceDocumentStates(documents) ?? new Map();
  const check = () => {
    checkNativeOwnership(state, identity, signal);
    const files = documents?.files ?? state.files;
    if (nativeBuild.disposed || nativeBuild.client !== client || state.revision !== revision ||
        documents?.disposed || documents?.revision !== documentRevision || files.length !== originals.length ||
        files.some((file, index) => (file.uri ?? file.path) !== originals[index].uri ||
          file.version !== originals[index].version || file.model !== originals[index].model ||
          nativeRecordSource(file) !== originals[index].source)) {
      throw new DOMException('Native document ownership changed while refresh was reading', 'AbortError');
    }
  };
  return {client, originals, states, check, revision};
}

function cleanNativeBuffers(nativeBuild) {
  for (const [path, buffer] of nativeBuild.buffers ?? []) {
    if (buffer.hash !== null && buffer.text === buffer.baseline) nativeBuild.buffers.delete(path);
  }
  if (!nativeBuild.buffers?.has(nativeBuild.sourcePath)) nativeBuild.sourcePath = null;
}

function refreshedRecord(read, original, path) {
  const descriptors = Object.getOwnPropertyDescriptors(read);
  for (const [name, value] of Object.entries({path, uri: path,
    generated: original.generated === true || read.generated === true,
    readOnly: original.readOnly === true || read.readOnly === true})) {
    descriptors[name] = {value, enumerable: true, configurable: true, writable: true};
  }
  return Object.defineProperties({}, descriptors);
}

/** Refresh disk snapshots once, then let Documents adopt records/models without manual editor disposal or text replacement. */
export async function refreshNativeExplorerWorkspace(host, mappings = [], {partial = false, signal} = {}) {
  if (!Array.isArray(mappings) || mappings.length > 20_000) throw new RangeError('Invalid native path mapping count');
  const paths = mappings.map(value => ({from: validateItemPath(value.from), to: validateItemPath(value.to)}));
  const {state, documents, nativeBuild} = host;
  const captured = captureRefresh(host, signal);
  const workspace = await nativeBuild.refresh();
  captured.check();
  const available = new Set(workspace.files.map(file => file.path));
  const files = [];
  const states = new Map();
  for (const original of captured.originals) {
    captured.check();
    const path = mapped(original.uri, paths);
    const dirty = nativeRecordIsDirty(original.record, documents);
    const retainedGenerated = original.record.generated && (state.nativeContextFiles ?? []).includes(original.uri);
    if (!available.has(path)) {
      if (dirty || retainedGenerated) {
        files.push(original.record);
        if (captured.states.has(original.uri)) states.set(original.uri, captured.states.get(original.uri));
      }
      continue;
    }
    // A partial disk failure still cannot authorize discarding an unrelated unsaved document.
    if (dirty && original.uri === path) {
      files.push(original.record);
      if (captured.states.has(path)) states.set(path, captured.states.get(path));
      continue;
    }
    const read = await captured.client.read(path, {signal});
    captured.check();
    const next = nativeRecordFromRead(refreshedRecord(read, original.record, path), original.record, {documents, path});
    files.push(next.record);
    if (next.retainedDirty && captured.states.has(original.uri)) states.set(path, captured.states.get(original.uri));
  }
  captured.check();
  const valid = new Set(files.map(file => file.uri));
  const tabs = [...new Set((state.tabs ?? []).map(path => mapped(path, paths)).filter(path => valid.has(path)))];
  const wanted = mapped(state.active, paths);
  const active = valid.has(wanted) ? wanted : tabs[0] ?? files[0]?.uri ?? '';
  if (active && !tabs.includes(active)) tabs.push(active);
  replaceNativeDocuments({state, documents}, files, {states, tabs, active, signal, commitMetadata: () => {
    state.breakpoints = Object.fromEntries(Object.entries(state.breakpoints ?? {})
      .map(([path, values]) => [mapped(path, paths), values]).filter(([path]) => valid.has(path)));
    if (state.nativeContextFiles) state.nativeContextFiles = state.nativeContextFiles.map(path => mapped(path, paths))
      .filter(path => valid.has(path));
    state.nativeWorkspace = workspace;
    invalidateNativeCompilation(state, (captured.revision ?? 0) + 1);
    cleanNativeBuffers(nativeBuild);
  }});
  nativeBuild.renderSource?.(true);
  host.renderWorkspace?.({partial});
  return workspace;
}
