import { CodeEditor, EditorModelWorkspace, FoldingStateStore, createRequestServices,
  prepareWorkspaceEdit, commitWorkspaceEdit } from '@sharpforge/editor';
import { configureDocumentEditor } from './editor-configuration.js';

/** Preserve breakpoint positions using edit snapshots, without flattening a large source buffer. */
export function remapBreakpointChanges(breakpoints, change) {
  return breakpoints.map(breakpoint => {
    const old = change.before.offsetAt({ line: Math.max(0, breakpoint.line - 1), character: (breakpoint.column ?? 1) - 1 });
    let delta = 0;
    let offset = old;
    for (const edit of change.changes) {
      if (old < edit.start) break;
      if (old < edit.end || old === edit.start) {
        offset = old === edit.start ? edit.newEnd : edit.newStart;
        delta = 0;
        break;
      }
      delta += edit.text.length - (edit.end - edit.start);
    }
    const position = change.after.positionAt(offset + delta);
    return { ...breakpoint, line: position.line + 1, column: position.character + 1 };
  });
}

/** Editors share one document model and workspace transaction adapter, with independent view state. */
export function createStudioEditorFactory({ services, state, requestCompiler, requestHost, onFocus, onCursor,
  onKeymapState, onBreakpoint, onBreakpointEdit, onError, openDocument,
  providers = {}, applyResourceTransaction, supportsResourceRename,
  getConfigurationRecords = () => [], getLanguageOptions = () => ({}), document = globalThis.document }) {
  const session = { models: services.documents.models, views: new Set(), foldingState: new FoldingStateStore() };
  const workspace = new EditorModelWorkspace(session.models, { applyResourceTransaction, supportsResourceRename });
  const language = createRequestServices((method, parameters) => {
    const { signal, ...params } = parameters;
    return requestCompiler(method, params, { signal });
  }, [
    'completion', 'hover', 'signatureHelp', 'diagnostics', 'codeActions', 'resolveCodeAction', 'outlineReorder', 'rename', 'semanticTokens',
    'definition', 'references', 'format', 'formatRange', 'formatOnType', 'prepareRename', 'documentHighlights', 'inlayHints',
    'selectionRanges',
    { method: 'documentSymbols', remote: 'symbols' },
    { method: 'folding', remote: 'foldingRanges' }, { method: 'codeLens', remote: 'referenceLenses' }
  ].filter(entry => !providers[typeof entry === 'string' ? entry : entry.method]));
  for (const [method, provider] of Object.entries(providers)) language.register(method, provider);
  language.register('readDocument', ({ signal, ...params }) => {
    const targetUri = params.targetUri ?? params.uri;
    return workspace.getDocument(targetUri) ?? requestCompiler('readDocument', { ...params, targetUri }, { signal });
  });
  language.register('projects', ({ uri }) => services.documents.projectsFor(uri ?? state().active)
    .map(id => ({ id, name: services.builds.get(id)?.project.name })));
  const create = (record, { model, viewId, onFocus: activate }) => {
    const root = document.createElement('div');
    root.className = 'source-document';
    root.dataset.sourceUri = record.uri;
    root.dataset.sourceView = viewId;
    const host = document.createElement('div');
    host.className = 'editor-host';
    root.append(host);
    const editor = new CodeEditor(host, {
      model, session, workspace, services: language, keymap: state().keymap, request: requestHost, openDocument,
      onKeymapState: value => onKeymapState?.(record.uri, value),
      onCursor: position => onCursor?.(record.uri, position),
      onBreakpoint: line => onBreakpoint(record.uri, line),
      onBreakpointEdit: (line, event) => onBreakpointEdit(record.uri, line, event),
      onError
    });
    try {
      configureDocumentEditor(editor, { records: getConfigurationRecords(), languageOptions: getLanguageOptions(editor.options.language) });
    } catch (error) {
      editor.dispose();
      throw error;
    }
    editor.input.setAttribute('aria-label', `${record.uri} — C# source editor`);
    editor.input.addEventListener('focus', () => { activate(); onFocus?.(record.uri, editor, viewId); });
    return { editor, element: root };
  };
  return {
    create, workspace, language, session,
    configure(editor, languageOptions = getLanguageOptions(editor.options.language)) {
      return configureDocumentEditor(editor, {
        records: getConfigurationRecords(), languageOptions
      });
    },
    apply(edits, label = 'Workspace edit') {
      const versions = new Map(services.documents.list().map(record => [record.uri, record.version]));
      const plan = prepareWorkspaceEdit(workspace, edits, { label, versions, maxDocumentLength: 256 * 1024 * 1024 });
      return commitWorkspaceEdit(workspace, plan);
    },
    dispose() { language.dispose(); }
  };
}
