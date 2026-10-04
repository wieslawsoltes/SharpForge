import {Worker} from 'node:worker_threads';
import {DesignDocument, createDesign, designScene, projectDesignerAuthoringScene} from '@sharpforge/designer';
import {DesignerSourceSync} from '../../apps/studio/designer-source-sync.js';
import {DesignerDocumentHistory} from '../../apps/studio/designer-document-history.js';
import {createDesignerSourceServices, designerCompilationContext} from '../../apps/studio/designer-source-services.js';
import {designerSourceDocument} from '../../apps/studio/designer-source-projection.js';
import {editorModelView} from './a18-editor-model-view.js';

export const ownerUri = 'App/View.cs';
export const constructionUri = 'App/View.g.cs';

export function partialSources({subscription = 'action.Click += OnClick;'} = {}) {
  return [
    {uri: ownerUri, text: `using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
partial class View {
    static Window window;
    static Canvas panel;
    static Button action;
    // Keep both handler bodies and their field references.
    static void OnClick(object sender, RoutedEventArgs args) { action.Content = "Clicked"; }
    static void OnOther(object sender, RoutedEventArgs args) { action.Width = 240; }
}`},
    {uri: constructionUri, text: `using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
partial class View {
    public static Window Create() {
        window = new Window();
        panel = new Canvas();
        action = new Button { Name = "Action", Width = 160, Height = 40, Content = "Run" };
        ${subscription}
        panel.Children.Add(action);
        window.Content = panel;
        return window;
    }
}`},
    {uri: 'App/Program.cs', text: 'class Program { static void Main() { View.Create().Activate(); } }'},
    {uri: 'Other/Noise.cs', text: 'This unrelated project intentionally does not compile {'}
  ].map(file => ({...file, version: 1}));
}

function compilerTransport(test) {
  const worker = new Worker(new URL('./a18-studio-worker.mjs', import.meta.url));
  const pending = new Map();
  const requests = [];
  let serial = 0;
  let closed = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const readyTimer = setTimeout(() => rejectReady(new Error('Production compiler worker initialization timed out')), 15000);
  const fail = error => {
    clearTimeout(readyTimer);
    rejectReady(error);
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
  };
  worker.on('message', message => {
    if (message.ready) { clearTimeout(readyTimer); resolveReady(); return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(Object.assign(new Error(message.error.message), message.error));
    else request.resolve(message.result);
  });
  worker.on('error', fail);
  worker.on('exit', code => { if (!closed) fail(new Error('Compiler worker exited unexpectedly: ' + code)); });
  const client = {
    requests, ready, afterResponse: null,
    async request(method, params = {}) {
      await ready;
      if (closed) throw new Error('Compiler transport is closed');
      requests.push({method, operation: params.operation, uris: params.files?.map(file => file.uri)});
      const result = await new Promise((resolve, reject) => {
        const id = ++serial;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Compiler request timed out: ' + method)); }, 15000);
        pending.set(id, {resolve, reject, timer});
        worker.postMessage({id, method, params});
      });
      await client.afterResponse?.(method, params, result);
      return result;
    }
  };
  test.after(async () => {
    closed = true;
    fail(new Error('Compiler transport closed'));
    await worker.terminate();
  });
  return client;
}

function sourceEditor(file) {
  const editor = editorModelView(file.text + ' ', file.uri);
  editor.setValue(file.text);
  editor.setSelections([{anchor: 3, active: 8}, {anchor: 14, active: 11}], {primaryIndex: 1});
  editor.view.scrollTo({top: 40, left: 5});
  editor.cursorUpdates = 0;
  return editor;
}

function commitEditorText(editor, file, text) {
  editor.setValue(text);
  file.text = text;
  file.version++;
  editor.model.setSelections([{anchor: 0, active: 0}], {notify: false});
  editor.selections = editor.model.selections;
  editor.primaryIndex = 0;
  editor.view.scrollTo({top: 0, left: 0});
}

function editorBoundary({state, editors, notify, applied}) {
  const file = uri => state.files.find(item => item.uri === uri);
  const applyEdits = edits => {
    const groups = new Map();
    for (const edit of edits) {
      const record = file(edit.uri);
      if (!record || record.version !== edit.version) throw new Error('Editor adapter received stale source');
      if (!groups.has(record.uri)) groups.set(record.uri, {record, text: record.text, edits: []});
      groups.get(record.uri).edits.push(edit);
    }
    for (const group of groups.values()) {
      for (const edit of group.edits.sort((left, right) => right.start - left.start)) {
        group.text = group.text.slice(0, edit.start) + edit.newText + group.text.slice(edit.end);
      }
    }
    applied.push(structuredClone(edits));
    for (const {record, text} of groups.values()) commitEditorText(editors.get(record.uri), record, text);
    state.revision++;
    for (const uri of groups.keys()) notify(uri);
  };
  const type = (uri, text, {notifyChange = true, bumpRevision = true} = {}) => {
    commitEditorText(editors.get(uri), file(uri), text);
    if (bumpRevision) state.revision++;
    if (notifyChange) notify(uri);
  };
  return {applyEdits, file, type};
}

function previewBoundary({state, document, services, navigation, previews}) {
  return {state, document, session: {uri: ownerUri}, path: 'App/View.sfdesign.json', status: '',
    ensure() {}, workspaceId: () => 'workspace-1',
    sourceFiles: () => designerCompilationContext(state, ownerUri).files,
    analyzeDesign: services.analyzeDesign, editSourceText: services.editSourceText,
    applySourceEdits: (uri, plan, version, current) => services.applySourceEdits(uri, plan, version, current, ownerUri),
    replace(value, {path}) { this.path = path; document.load(value, {label: 'source sync', history: false}); },
    chrome: {renderSync() {}, refreshSource() {}, setMode() {}},
    documentHost: {setDiagnostics(value) { this.diagnostics = value; }, setMode(value) { this.mode = value; }},
    openSource: (uri, start, end) => navigation.push({uri, start, end}),
    host: {load: scene => previews.push(structuredClone(scene)), flush() {}}
  };
}

/** Public EditorModels and explicit view edges surround production SourceSync, services, history and compiler worker. */
export async function studioHarness(test, options = {}) {
  const state = {name: 'DesignerTransactions', revision: 10, active: ownerUri, readOnly: false,
    startupProject: 'Other/Other.csproj', langVersion: 'preview', extensionConfig: null, files: partialSources(options)};
  state.projectSystem = {
    projects: new Map([['App/App.csproj', {}], ['Other/Other.csproj', {}]]),
    compilationFiles: project => state.files.filter(file => file.uri.startsWith(project.split('/')[0] + '/')),
    compilationOptions: () => ({outputKind: 'library', langVersion: 'preview'})
  };
  const compiler = compilerTransport(test);
  await compiler.ready;
  const editors = new Map(state.files.map(file => [file.uri, sourceEditor(file)]));
  const documents = new Map();
  const applied = [];
  const restored = [];
  const navigation = [];
  const previews = [];
  let sync;
  let history;
  const notify = uri => {
    history.sourceChanged(uri);
    sync?.sourceChanged(uri, {dependency: uri !== sync.session?.analysis.uri});
  };
  const {applyEdits, file, type} = editorBoundary({state, editors, notify, applied});
  history = new DesignerDocumentHistory({files: () => state.files, editors, applyEdits,
    restored: (uri, analysis) => { restored.push({uri, analysis}); documents.get(uri).sourceSync.restoreHistory(analysis); }});
  const services = createDesignerSourceServices({state, compiler, applyEdits, documents: () => documents, history});
  const document = new DesignDocument(createDesign('Last valid initial preview'));
  const view = previewBoundary({state, document, services, navigation, previews});
  sync = new DesignerSourceSync(view);
  view.sourceSync = sync;
  sync.auto = false;
  documents.set(ownerUri, {uri: ownerUri, document, sourceSync: sync});
  const subscription = document.subscribe(event => {
    if (event.kind !== 'selection') view.host.load(projectDesignerAuthoringScene(document.value, designScene(document.value)));
    sync.designChanged(event);
  });
  test.after(() => {
    subscription(); sync.dispose(); history.dispose(); document.dispose();
    for (const editor of editors.values()) editor.dispose();
  });
  return {state, compiler, editors, documents, history, services, document, view, sync, applied, restored, navigation, previews, file, type,
    async connect() { return sync.connect(ownerUri); },
    async plan() {
      return services.analyzeDesign({operation: 'plan', uri: constructionUri, baselineSources: sync.session.sources,
        previous: sync.session.analysis, design: designerSourceDocument(document.value), generation: sync.generation});
    },
    async build() {
      const context = designerCompilationContext(state, ownerUri);
      return compiler.request('build', {...context, compilationOptions: {...context.compilationOptions, outputKind: 'exe'}});
    }
  };
}

export function sourceState(harness) {
  return {revision: harness.state.revision, files: harness.state.files.map(file => ({uri: file.uri, text: file.text, version: file.version})),
    applied: harness.applied.length, past: harness.history.past.length, future: harness.history.future.length,
    editors: Object.fromEntries([...harness.editors].map(([uri, editor]) => [uri, {
      undo: editor.model.undoStack.checkpoint(), selections: editor.getSelections(), primaryIndex: editor.primaryIndex,
      scrollTop: editor.view.scrollTop, scrollLeft: editor.view.viewport.scrollLeft
    }]))};
}
