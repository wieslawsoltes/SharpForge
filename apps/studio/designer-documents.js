import {DesignerSessionRegistry, probeDesignSource} from '../../packages/designer/src/index.js';
import {DesignerDocumentView} from './designer-document-view.js';
import {DesignerToolRouter} from './designer-tool-router.js';

/** Composes URI sessions, permanent source editors, per-document surfaces, and the shared side-panel router. */
export class DesignerDocuments {
  constructor(options) {
    const {state, createTools, openSource, resolvePanel = () => null, records = () => [], onChange = () => {}, onError = null} = options;
    this.state = state;
    this.createTools = createTools;
    this.openSource = openSource;
    this.records = records;
    this.onChange = onChange;
    this.onError = onError ?? (error => { throw error; });
    this.onHistory = options.onHistory ?? (() => false);
    this.registry = new DesignerSessionRegistry();
    this.sources = new Map();
    this.views = new Map();
    this.probes = new Map();
    this.probeTimers = new Map();
    this.disposed = false;
    this.router = new DesignerToolRouter({
      registry: this.registry, resolveTarget: resolvePanel, resolveView: uri => this.views.get(uri)
    });
    this.unsubscribe = this.registry.subscribe(event => {
      if (event.kind === 'close') {
        this.views.delete(event.uri);
        this.probes.delete(event.uri);
      }
      if (event.kind !== 'change' || event.event.kind !== 'document' || event.event.event.kind === 'selection') this.onChange(event);
    });
  }

  get active() { return this.registry.active; }
  get tools() { return this.views.get(this.active?.uri)?.tools ?? null; }
  get size() { return this.registry.size; }
  get(uri) { return this.registry.get(uri); }
  panel(id) { return this.views.get(this.active?.uri)?.panels.get(id) ?? null; }

  file(uri) {
    return this.state.files.find(file => file.uri === uri)
      ?? this.records().find(file => (file.uri ?? file.path) === uri)
      ?? this.sources.get(uri)?.record ?? null;
  }

  probe(uri) {
    const file = this.file(uri);
    if (!file) return {uri, compatible: false, code: 'SFDESIGN_MISSING_FILE', reason: 'The document is not in this workspace.'};
    if (/\.sfdesign\.json$/i.test(uri)) return {uri, compatible: true, kind: 'design', reason: null};
    const cached = this.probes.get(uri);
    if (cached?.text === file.text) return cached.result;
    const result = probeDesignSource(file.text, uri);
    this.probes.set(uri, {text: file.text, result});
    return result;
  }

  /** Called once by createSourceDocument. Incompatible code retains its unmodified source root. */
  wrap(uri, element, editor, record = null) {
    if (this.disposed) throw new Error('Designer documents host is disposed');
    const previous = this.sources.get(uri);
    if (previous && previous.element !== element) this.close(uri);
    this.sources.set(uri, {element, editor, record});
    if (!this.views.has(uri) && this.probe(uri).compatible) this.createView(uri);
    if (this.state.active === uri) this.activate(uri);
    return element;
  }

  createView(uri) {
    const source = this.sources.get(uri);
    if (!source) throw new Error(`The source document must be mounted before opening its designer: ${uri}`);
    const file = this.file(uri);
    const kind = /\.sfdesign\.json$/i.test(uri) ? 'design' : 'csharp';
    const document = kind === 'design' ? JSON.parse(file.text) : undefined;
    const session = this.registry.open(uri, {kind, document});
    const stateBeforeConnect = {...session.viewState};
    let view;
    try {
      view = new DesignerDocumentView({
        session, element: source.element, editor: source.editor, createTools: this.createTools,
        onActivate: activeUri => this.activate(activeUri), onHistory: this.onHistory
      });
    } catch (error) {
      this.registry.close(uri);
      throw error;
    }
    session.documentHost = view;
    session.own('document-host', view);
    this.views.set(uri, view);
    if (kind === 'design') {
      session.applySelection({final: true});
      view.ready = Promise.resolve(session);
    } else {
      const operation = session.beginOperation('initialize-source');
      view.ready = Promise.resolve().then(() => operation.current() ? view.tools.sourceSync.connect(uri) : null).then(() => {
        if (!operation.current()) return null;
        session.setViewState(stateBeforeConnect);
        session.applySelection({final: true});
        operation.finish();
        this.router.route(this.active);
        return session;
      }).catch(error => {
        if (!operation.current()) return null;
        operation.finish();
        session.status = error.message;
        view.tools.sourceSync.report('blocked', error.message);
        session.setViewState({mode: 'code'});
        this.onError(error);
        return null;
      });
    }
    return view;
  }

  activate(uri) {
    if (this.disposed) return null;
    const session = this.registry.get(uri);
    if (session && this.state.active !== uri) {
      Promise.resolve(this.openSource(uri)).catch(this.onError);
    }
    this.registry.activate(session ? uri : null);
    this.router.route(session);
    return session;
  }

  /** Opens the same URI and tab. The compatibility check runs before navigation changes the active editor. */
  async open(uri = this.state.active, mode = 'design') {
    const compatibility = this.probe(uri);
    if (!compatibility.compatible) throw new Error(compatibility.reason ?? 'This document has no supported designer view.');
    await this.openSource(uri);
    const view = this.views.get(uri) ?? this.createView(uri);
    await view.ready;
    if (view.disposed) throw new Error('The document was closed while opening its designer');
    this.activate(uri);
    view.setMode(mode);
    return view.session;
  }

  sourceChanged(uri) {
    const session = this.registry.get(uri);
    if (session) {
      session.sourceSync?.sourceChanged(uri);
      return;
    }
    if (!this.sources.has(uri)) return;
    this.cancelProbe(uri);
    const timer = globalThis.setTimeout(() => {
      this.probeTimers.delete(uri);
      if (this.disposed || !this.sources.has(uri)) return;
      this.probes.delete(uri);
      if (!this.probe(uri).compatible) return;
      this.createView(uri);
      if (this.state.active === uri) this.activate(uri);
    }, 300);
    this.probeTimers.set(uri, timer);
  }

  cancelProbe(uri) {
    if (!this.probeTimers.has(uri)) return;
    globalThis.clearTimeout(this.probeTimers.get(uri));
    this.probeTimers.delete(uri);
  }

  /** Tab closure can keep a document cached; call close only for file removal or explicit workspace reset. */
  close(uri) {
    this.cancelProbe(uri);
    const closed = this.registry.close(uri);
    this.sources.delete(uri);
    this.probes.delete(uri);
    return closed;
  }

  syncFiles(files = [...this.state.files, ...this.records()]) {
    this.registry.syncFiles(files);
    const uris = new Set(files.map(file => file.uri ?? file.path));
    for (const uri of this.sources.keys()) if (!uris.has(uri)) this.sources.delete(uri);
    for (const uri of this.probes.keys()) if (!uris.has(uri)) this.probes.delete(uri);
    for (const uri of this.probeTimers.keys()) if (!uris.has(uri)) this.cancelProbe(uri);
  }

  snapshot() { return this.registry.snapshot(); }
  restore(snapshot) { return this.registry.restore(snapshot, {files: [...this.state.files, ...this.records()]}); }

  reset() {
    for (const uri of [...this.sources.keys()]) this.close(uri);
    this.registry.pendingState.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.router.dispose();
    this.registry.dispose();
    for (const uri of this.probeTimers.keys()) this.cancelProbe(uri);
    this.sources.clear();
    this.views.clear();
    this.probes.clear();
  }
}
