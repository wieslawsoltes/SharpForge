import {DesignerSessionRegistry} from '../../packages/designer/src/index.js';
import {classifyDesignerSource} from './designer-source-classification.js';
import {DesignerDocumentView} from './designer-document-view.js';
import {disposeFailedDesigner} from './designer-document-errors.js';
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
    this.sessionOptions = options.sessionOptions ?? (() => ({}));
    this.registry = new DesignerSessionRegistry();
    this.sources = new Map();
    this.views = new Map();
    this.probes = new Map();
    this.probeTimers = new Map();
    this.navigation = null;
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
    const result = classifyDesignerSource(file.text, uri);
    this.probes.set(uri, {text: file.text, result});
    return result;
  }

  /** Called once by createSourceDocument. Incompatible code retains its unmodified source root. */
  wrap(uri, element, editor, record = null) {
    if (this.disposed) throw new Error('Designer documents host is disposed');
    const previous = this.sources.get(uri);
    if (previous && previous.element !== element) this.close(uri, {preserveState: true});
    else previous?.disposeFocus?.();
    this.sources.set(uri, {element, editor, record, disposeFocus: this.bindSourceFocus(uri, editor?.input)});
    if (!this.views.has(uri) && this.probe(uri).compatible) this.createView(uri);
    if (this.state.active === uri) this.activate(uri);
    return element;
  }

  bindSourceFocus(uri, input) {
    if (!input) return null;
    const activate = () => this.focusSource(uri);
    input.addEventListener('focus', activate);
    return () => input.removeEventListener('focus', activate);
  }

  /** Native editor focus shares navigation ownership even when this source has no designer session. */
  focusSource(uri) {
    if (this.disposed || !this.sources.has(uri)) return null;
    if (this.navigation?.running && this.navigation.uri !== uri) return null;
    if (this.state.active === uri) return this.activate(uri);
    if (!this.navigation?.running) Promise.resolve(this.navigateSource(uri)).catch(this.onError);
    return this.registry.get(uri);
  }

  createView(uri) {
    const source = this.sources.get(uri);
    if (!source) throw new Error(`The source document must be mounted before opening its designer: ${uri}`);
    const file = this.file(uri);
    const kind = /\.sfdesign\.json$/i.test(uri) ? 'design' : this.probe(uri).kind === 'resources' ? 'resources' : 'csharp';
    const document = kind === 'design' ? JSON.parse(file.text) : undefined;
    const session = this.registry.open(uri, {...this.sessionOptions(uri, kind), kind, document});
    let view;
    try {
      view = new DesignerDocumentView({
        session, element: source.element, editor: source.editor, createTools: this.createTools,
        onActivate: activeUri => this.activate(activeUri), onHistory: this.onHistory
      });
    } catch (error) {
      throw disposeFailedDesigner(error, () => this.registry.close(uri));
    }
    session.documentHost = view;
    session.own('document-host', view);
    this.views.set(uri, view);
    if (kind === 'design') {
      session.applyRecovery({final: true});
      view.ready = Promise.resolve(session);
    } else this.initializeView(view);
    return view;
  }

  initializeView(view) {
    const session = view.session;
    const stateBeforeConnect = {...session.viewState};
    const operation = session.beginOperation('initialize-source');
    view.initializationFailed = false;
    view.ready = Promise.resolve().then(() => operation.current() ? view.tools.sourceSync.connect(session.uri) : null).then(() => {
      if (!operation.current()) return null;
      session.setViewState(stateBeforeConnect);
      session.applyRecovery({final: true});
      operation.finish();
      this.router.route(this.active);
      return session;
    }).catch(error => {
      if (!operation.current()) return null;
      operation.finish();
      view.initializationFailed = true;
      session.status = error.message;
      view.tools.sourceSync.report('blocked', error.message);
      session.setViewState({mode: 'code'});
      this.router.route(this.active);
      this.onError(error);
      return null;
    });
    return view.ready;
  }

  activate(uri) {
    if (this.disposed) return null;
    if (this.navigation?.running && this.navigation.uri !== uri) return null;
    const session = this.registry.get(uri);
    if (session && this.state.active !== uri) {
      if (!this.navigation?.running) Promise.resolve(this.navigateSource(uri)).catch(this.onError);
      return session;
    }
    this.registry.activate(session ? uri : null);
    this.router.route(session);
    return session;
  }

  /** Source navigation owns focus changes made while docking moves its DOM. Nested calls for the same URI join it. */
  navigateSource(uri, action = () => this.openSource(uri)) {
    if (this.disposed) throw new Error('Designer documents host is disposed');
    if (this.navigation?.running && this.navigation.uri === uri) return action();
    const navigation = {uri, running: true};
    this.navigation = navigation;
    try {
      const result = action();
      navigation.running = false;
      if (result && typeof result.then === 'function') {
        return Promise.resolve(result).then(value => {
          this.finishNavigation(navigation);
          return value;
        }, error => {
          this.cancelNavigation(navigation);
          throw error;
        });
      }
      this.finishNavigation(navigation);
      return result;
    } catch (error) {
      this.cancelNavigation(navigation);
      throw error;
    }
  }

  cancelNavigation(navigation = this.navigation) {
    if (this.navigation === navigation) this.navigation = null;
  }

  finishNavigation(navigation) {
    if (this.navigation !== navigation) return;
    try {
      navigation.running = true;
      if (this.disposed || this.state.active !== navigation.uri) return;
      this.activate(navigation.uri);
      if (this.navigation === navigation && this.state.active === navigation.uri) this.focusNavigatedSource(navigation.uri);
    } finally {
      this.cancelNavigation(navigation);
    }
  }

  focusNavigatedSource(uri) {
    const source = this.sources.get(uri);
    if (!source?.element.isConnected || source.element.hidden) return;
    const focused = source.element.ownerDocument.activeElement;
    if (!focused || source.element.contains(focused)) return;
    // DockHost can restore an editor in another visible group. Keep explorer and tool-window focus where it is.
    let previousSource = false;
    for (const candidate of this.sources.values()) {
      if (candidate.element.contains(focused)) {
        previousSource = true;
        break;
      }
    }
    if (!previousSource) return;
    const view = this.views.get(uri);
    if (view?.codePane?.hidden) view.tools.scroller?.focus({preventScroll: true});
    else source.editor?.focus();
  }

  /** Opens the same URI and tab. The compatibility check runs before navigation changes the active editor. */
  async open(uri = this.state.active, mode = 'design') {
    const compatibility = this.probe(uri);
    if (!compatibility.compatible && !this.registry.get(uri)) {
      throw new Error(compatibility.reason ?? 'This document has no supported designer view.');
    }
    await this.navigateSource(uri);
    const view = this.views.get(uri) ?? this.createView(uri);
    if (view.initializationFailed) this.initializeView(view);
    const initialized = await view.ready;
    if (view.disposed) throw new Error('The document was closed while opening its designer');
    if (!initialized && mode !== 'code') throw new Error(view.session.status || 'Repair source diagnostics before opening the design view');
    const active = this.state.active === uri;
    if (active) this.activate(uri);
    view.setMode(mode, {focus: active});
    return view.session;
  }

  sourceChanged(uri) {
    const session = this.registry.get(uri);
    if (session && !this.views.get(uri)?.initializationFailed) {
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
      const view = this.views.get(uri);
      if (view?.initializationFailed) this.initializeView(view);
      else if (!view) this.createView(uri);
      if (this.state.active === uri) this.activate(uri);
    }, 300);
    this.probeTimers.set(uri, timer);
  }

  cancelProbe(uri) {
    if (!this.probeTimers.has(uri)) return;
    globalThis.clearTimeout(this.probeTimers.get(uri));
    this.probeTimers.delete(uri);
  }

  /** Remounting an existing file keeps its view recovery; removal and workspace reset discard it. */
  close(uri, {preserveState = false} = {}) {
    if (this.navigation?.uri === uri) this.cancelNavigation();
    this.sources.get(uri)?.disposeFocus?.();
    this.cancelProbe(uri);
    const closed = this.registry.close(uri, {preserveState: preserveState && !!this.file(uri)});
    this.sources.delete(uri);
    this.probes.delete(uri);
    return closed;
  }

  syncFiles(files = [...this.state.files, ...this.records()]) {
    this.registry.syncFiles(files);
    const uris = new Set(files.map(file => file.uri ?? file.path));
    for (const [uri, source] of this.sources) {
      if (uris.has(uri)) continue;
      source.disposeFocus?.();
      this.sources.delete(uri);
    }
    for (const uri of this.probes.keys()) if (!uris.has(uri)) this.probes.delete(uri);
    for (const uri of this.probeTimers.keys()) if (!uris.has(uri)) this.cancelProbe(uri);
  }

  snapshot() { return this.registry.snapshot(); }
  restore(snapshot) {
    const restored = this.registry.restore(snapshot, {files: [...this.state.files, ...this.records()]});
    for (const session of this.registry.sessions.values()) {
      if (!session.operations.has('initialize-source')) session.applyRecovery({final: true});
    }
    return restored;
  }

  reset() {
    this.cancelNavigation();
    for (const uri of [...this.sources.keys()]) this.close(uri);
    this.registry.pendingState.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelNavigation();
    for (const source of this.sources.values()) source.disposeFocus?.();
    this.unsubscribe();
    this.router.dispose();
    this.registry.dispose();
    for (const uri of this.probeTimers.keys()) this.cancelProbe(uri);
    this.sources.clear();
    this.views.clear();
    this.probes.clear();
  }
}
