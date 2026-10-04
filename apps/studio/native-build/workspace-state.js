import {workspaceDocumentStates} from '../workspace-source-records.js';
import {captureNativeRecord, checkNativeOwnership, nativeRecordFromRead, nativeWorkspaceIdentity} from './document-records.js';
import {replaceNativeDocuments} from './document-replacement.js';

export {collectNativeSourceChanges} from './document-records.js';

/** The selected native context owns the semantic input set; open documents outside it remain editable. */
export function nativeCompilationRequest(state) {
  if (!state.nativeMode || !state.nativeProjectContext) return null;
  const selected = new Set(state.nativeContextFiles ?? []);
  const context = state.nativeProjectContext;
  const properties = context.properties ?? {};
  const options = state.nativeCompilationOptions ?? {};
  return {
    files: state.files.filter(file => selected.has(file.uri)).map(file => captureNativeRecord(file)),
    compilationOptions: options,
    assemblyName: properties.AssemblyName ?? properties.assemblyname ?? state.name,
    outputKind: options.outputKind ?? 'library',
    contextId: context.id,
    additionalFiles: state.nativeAdditionalFiles ?? [],
    analyzerConfigFiles: context.analyzerConfigFiles ?? []
  };
}

/** Per-document readonly state applies to generated native documents as well as debugger sessions. */
export function nativeDocumentReadOnly(state, file) {
  return state.readOnly === true || file?.readOnly === true || file?.generated === true;
}

export function invalidateNativeCompilation(state, revision) {
  state.revision = revision;
  state.buildDirty = true;
  for (const key of ['image', 'assembly', 'pdb', 'ilDump']) state[key] = null;
  state.importedAssembly = false;
}

/** Apply hydrated context data through optional Documents ownership, retaining the legacy synchronous API. */
export function applyNativeProjectContext(state, {context, compilation, signal}, {documents} = {}) {
  if (!state.nativeMode) throw new Error('Attach the native workspace before selecting a native context');
  if (!context?.id || !Array.isArray(compilation?.files)) throw new TypeError('A hydrated native project context is required');
  signal?.throwIfAborted();
  const selected = new Map(compilation.files.map(record => [record.uri ?? record.path, record]));
  if (selected.size !== compilation.files.length) throw new TypeError('A native context contains duplicate source paths');
  const current = documents?.files ?? state.files;
  const previous = new Map(current.map(file => [file.uri, file]));
  const files = current.filter(file => !file.generated || selected.has(file.uri));
  const states = workspaceDocumentStates(documents) ?? new Map();
  const retained = new Set(files.map(file => file.uri));
  for (const uri of [...states.keys()]) if (!retained.has(uri)) states.delete(uri);
  const indexes = new Map(files.map((file, index) => [file.uri, index]));
  for (const [uri, record] of selected) {
    const next = nativeRecordFromRead(record, previous.get(uri), {documents, path: uri});
    if (!next.retainedDirty) states.delete(uri);
    if (indexes.has(uri)) files[indexes.get(uri)] = next.record;
    else files.push(next.record);
  }
  const valid = new Set(files.map(file => file.uri));
  const tabs = (state.tabs ?? []).filter(uri => valid.has(uri));
  const active = valid.has(state.active) ? state.active : [...selected.keys()][0] ?? '';
  if (active && !tabs.includes(active)) tabs.push(active);
  const revision = (state.revision ?? 0) + 1;
  replaceNativeDocuments({state, documents}, files, {states, tabs, active, signal, commitMetadata: () => {
    Object.assign(state, {nativeProjectContext: context, nativeContextFiles: [...selected.keys()],
      nativeCompilationOptions: compilation.options, nativeAdditionalFiles: compilation.additionalFiles ?? [],
      nativeContextDiagnostics: compilation.diagnostics ?? context.diagnostics ?? [], nativeStartup: context.project,
      langVersion: context.langVersion ?? state.langVersion});
    invalidateNativeCompilation(state, revision);
  }});
  return nativeCompilationRequest(state);
}

/** Studio supplies Documents to retain editor ownership; legacy hosts may continue providing resetEditors. */
export function createNativeContextHooks(host) {
  return {
    async onProjectContext(payload) {
      const identity = nativeWorkspaceIdentity(host.state);
      await host.stop?.();
      checkNativeOwnership(host.state, identity, payload.signal);
      const result = applyNativeProjectContext(host.state, payload, {documents: host.documents});
      if (!host.documents) host.resetEditors?.();
      host.renderWorkspace?.();
      host.scheduleAnalysis?.();
      host.status?.('Native context · ' + payload.context.targetFramework + ' · ' + result.files.length + ' source files');
      return result;
    },
    getTestInput(options) {
      const request = nativeCompilationRequest(host.state);
      return request ? {...request, revision: host.state.revision} : host.getTestInput?.(options) ?? {
        files: host.state.files.map(file => captureNativeRecord(file)), revision: host.state.revision,
        compilationOptions: {langVersion: host.state.langVersion ?? '14'}
      };
    },
    getTestSources() {
      return nativeCompilationRequest(host.state)?.files ?? host.state.files.map(file => captureNativeRecord(file));
    }
  };
}
