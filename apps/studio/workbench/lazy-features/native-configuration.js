import { SourceText } from '@sharpforge/text';

function nativeDiagnostics(state, job) {
  return job.diagnostics.map(diagnostic => {
    const uri = diagnostic.workspacePath ?? diagnostic.file ?? diagnostic.project ?? '';
    const range = {
      start: { line: Math.max(0, (diagnostic.line ?? 1) - 1), character: Math.max(0, (diagnostic.column ?? 1) - 1) },
      end: { line: Math.max(0, (diagnostic.endLine ?? diagnostic.line ?? 1) - 1),
        character: Math.max(1, diagnostic.endColumn ?? diagnostic.column ?? 1) }
    };
    const source = state.files.find(file => file.uri === uri);
    const text = source ? new SourceText(source.text) : null;
    const start = text?.offsetAt(range.start) ?? 0;
    const end = text?.offsetAt(range.end) ?? start + 1;
    return { severity: diagnostic.severity, code: diagnostic.code, message: diagnostic.message, uri, start,
      length: Math.max(1, end - start), range };
  });
}

/** Native host callbacks stay isolated from browser session ownership and retain captured-source save semantics. */
export function nativeConfiguration(context) {
  const { state, documents, docking, stopQuietly, saveLocal, resetEditors, renderWorkspace, status, openFile,
    nativeSourceChanges, renderTabs, renderTree, refreshEngineIndicators, setEditorDecorations,
    renderPanel, openDecompilerFile, setPanel, toast } = context;
  return {
    onProjectContext: context.onProjectContext,
    getTestInput: context.getTestInput,
    getTestSources: context.getTestSources,
    getTestProject: context.getTestProject,
    onOpenTestSource: context.onOpenTestSource,
    download: context.download,
    async onAttach(workspace) {
      const message = 'Switch to the native disk workspace? The browser preview is retained in local recovery. Export a ZIP to keep a separate copy.';
      if (state.dirtyFiles.size && !state.nativeMode && !globalThis.confirm(message)) throw new Error('Workspace switch cancelled');
      await stopQuietly();
      saveLocal();
      clearTimeout(state.analyzeTimer);
      Object.assign(state, { nativeMode: true, extraFiles: [], folders: [], workspaceMode: 'solution', membershipDirty: false,
        nativeWorkspace: workspace, projectSystem: null, projectSnapshot: null, disk: null, startupProject: null,
        nativeProjectContext: null, nativeContextFiles: [], nativeCompilationOptions: null, nativeAdditionalFiles: [],
        recoveryReadOnly: false, recoveryEntry: null, recoveryMetadata: null,
        extensionConfig: null, files: [], tabs: [], active: '', name: workspace.name, image: null, assembly: null, pdb: null,
        logs: [], programOutput: '', result: { diagnostics: [], symbols: [], metrics: { files: 0, errors: 0 } }, breakpoints: {} });
      state.dirtyFiles.clear();
      state.revision++;
      resetEditors();
      renderWorkspace();
      status('Native workspace · open a file from Solution Explorer');
    },
    async onOpenSource(file, line, column) {
      let source = state.files.find(item => item.uri === file.path);
      if (!source) {
        source = documents.add({ ...file, uri: file.path, text: file.text, version: file.version ?? Date.now(),
          nativeHash: file.hash, nativeBaseline: file.text, readOnly: file.readOnly === true || file.generated === true });
        state.revision++;
        renderWorkspace();
      }
      const text = new SourceText(source.text);
      const offset = line ? text.offsetAt({ line: Math.max(0, line - 1), character: Math.max(0, (column ?? 1) - 1) }) : undefined;
      openFile(file.path, offset);
      status('Native source · Roslyn diagnostics on build; browser language services are a subset');
    },
    getSourceChanges: nativeSourceChanges,
    onSaved(written, change) {
      const file = state.files.find(item => item.uri === written.path);
      if (file) {
        file.nativeHash = written.hash;
        file.nativeBaseline = change.text;
        if (file.text === change.text) documents.markSaved(file.uri, { version: file.version, text: change.text });
        const selected = docking.layout.state.activePanel;
        renderTabs();
        if (selected && selected !== 'source:' + state.active) docking.activate(selected);
      }
      renderTree();
      refreshEngineIndicators();
    },
    onJob(job, ownership = {}) {
      if (ownership.selected !== false) state.nativeJob = job;
      context.onNativeJob?.(job, ownership);
      if (ownership.selected === false || state.nativeJob !== job) return;
      refreshEngineIndicators();
      if (!state.nativeMode || !['succeeded', 'failed', 'cancelled'].includes(job.status)) return;
      state.result = { success: job.status === 'succeeded', symbols: [],
        metrics: { files: state.files.length, errors: job.diagnostics.filter(item => item.severity === 'error').length },
        diagnostics: nativeDiagnostics(state, job) };
      refreshEngineIndicators();
      setEditorDecorations();
      renderPanel('problems');
      status('Native MSBuild ' + job.status, job.status === 'failed' ? 'error' : 'ready');
    },
    onJobFailure(id, error, ownership) { context.onNativeJobFailure?.(id, error, ownership); },
    onWorkspace(workspace) { if (state.nativeMode) { state.nativeWorkspace = workspace; renderTree(); } },
    onAssembly: openDecompilerFile, onSelectPanel: setPanel, onError: error => toast(error.message, 'error')
  };
}
