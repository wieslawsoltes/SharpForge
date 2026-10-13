const nativeFile = record => ({
  ...record,
  uri: record.uri ?? record.path,
  version: record.version ?? 1,
  nativeHash: record.hash ?? null,
  nativeBaseline: record.text,
  readOnly: record.readOnly === true || record.generated === true,
  generated: record.generated === true
});

/** The selected native context owns the semantic input set; open documents outside it remain editable. */
export function nativeCompilationRequest(state) {
  if (!state.nativeMode || !state.nativeProjectContext) return null;
  const selected = new Set(state.nativeContextFiles ?? []);
  const context = state.nativeProjectContext;
  const properties = context.properties ?? {};
  const options = state.nativeCompilationOptions ?? {};
  return {
    files: state.files.filter(file => selected.has(file.uri)).map(file => ({...file})),
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

/** Apply a fully hydrated context atomically after asynchronous reads and metadata authorization finish. */
export function applyNativeProjectContext(state, {context, compilation}) {
  if (!state.nativeMode) throw new Error('Attach the native workspace before selecting a native context');
  if (!context?.id || !Array.isArray(compilation?.files)) throw new TypeError('A hydrated native project context is required');
  const selected = new Map(compilation.files.map(record => [record.uri ?? record.path, record]));
  const previous = new Map(state.files.map(file => [file.uri, file]));
  const files = state.files.filter(file => !file.generated || selected.has(file.uri));
  const indexes = new Map(files.map((file, index) => [file.uri, index]));
  for (const [uri, record] of selected) {
    const old = previous.get(uri);
    const changed = old && old.nativeBaseline !== undefined && old.text !== old.nativeBaseline;
    const next = nativeFile({...record, version: old?.text === record.text ? old.version : (old?.version ?? 0) + 1});
    if (changed && !next.readOnly) {
      next.text = old.text;
      next.version = old.version;
      next.nativeBaseline = old.nativeBaseline;
      next.nativeHash = old.nativeHash;
    }
    if (indexes.has(uri)) files[indexes.get(uri)] = next;
    else files.push(next);
  }
  state.files = files;
  state.nativeProjectContext = context;
  state.nativeContextFiles = [...selected.keys()];
  state.nativeCompilationOptions = compilation.options;
  state.nativeAdditionalFiles = compilation.additionalFiles ?? [];
  state.nativeContextDiagnostics = compilation.diagnostics ?? context.diagnostics ?? [];
  state.nativeStartup = context.project;
  state.langVersion = context.langVersion ?? state.langVersion;
  state.revision++;
  state.buildDirty = true;
  for (const key of ['image', 'assembly', 'pdb', 'ilDump']) state[key] = null;
  state.importedAssembly = false;
  const valid = new Set(files.map(file => file.uri));
  state.tabs = (state.tabs ?? []).filter(uri => valid.has(uri));
  if (!valid.has(state.active)) state.active = state.nativeContextFiles[0] ?? '';
  if (state.active && !state.tabs.includes(state.active)) state.tabs.push(state.active);
  return nativeCompilationRequest(state);
}

/** Small Studio callback seam; editor construction and compiler scheduling stay owned by the application. */
export function createNativeContextHooks(host) {
  return {
    async onProjectContext(payload) {
      await host.stop?.();
      payload.signal?.throwIfAborted();
      const result = applyNativeProjectContext(host.state, payload);
      host.resetEditors?.();
      host.renderWorkspace?.();
      host.scheduleAnalysis?.();
      host.status?.('Native context · ' + payload.context.targetFramework + ' · ' + result.files.length + ' source files');
      return result;
    },
    getTestInput(options) {
      const request = nativeCompilationRequest(host.state);
      return request ? {...request, revision: host.state.revision} : host.getTestInput?.(options) ?? {
        files: host.state.files.map(file => ({...file})), revision: host.state.revision,
        compilationOptions: {langVersion: host.state.langVersion ?? '14'}
      };
    },
    getTestSources() {
      return nativeCompilationRequest(host.state)?.files ?? host.state.files.map(file => ({...file}));
    }
  };
}
