import {DesignDocument, createDesign} from './model.js';
import {recoverSessionGuides, installSessionGuides} from './session-guide-state.js';

export const designerViewModes = Object.freeze(['design', 'split', 'code']);
export const designerSplitOrientations = Object.freeze(['vertical', 'horizontal']);
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const number = (value, fallback, minimum, maximum) => Number.isFinite(value) ? clamp(value, minimum, maximum) : fallback;

/** Normalizes a version-1 recovery entry. Unknown node identifiers are removed by the session on restore. */
export function normalizeDesignerViewState(value = {}, fallbackMode = 'code') {
  if (!value || typeof value !== 'object') value = {};
  return {
    mode: designerViewModes.includes(value.mode) ? value.mode : fallbackMode,
    orientation: designerSplitOrientations.includes(value.orientation) ? value.orientation : 'vertical',
    ratio: number(value.ratio, .5, .1, .9),
    swapped: value.swapped === true,
    collapsed: ['design', 'code'].includes(value.collapsed) ? value.collapsed : null,
    zoom: number(value.zoom, .8, .1, 8),
    scrollLeft: number(value.scrollLeft, 0, 0, 1_000_000),
    scrollTop: number(value.scrollTop, 0, 0, 1_000_000),
    selection: Array.isArray(value.selection) ? [...new Set(value.selection.filter(id => typeof id === 'string'))].slice(0, 1000) : [],
    editingMode: ['pixel', 'layout'].includes(value.editingMode) ? value.editingMode : 'pixel',
    snap: number(value.snap, 8, .25, 1024),
    preview: value.preview === true
  };
}

/** Validates exact workspace identity; URI case and escaped segments are deliberately not rewritten. */
export function designerDocumentUri(uri) {
  if (typeof uri !== 'string' || !uri || uri.length > 4096 || uri.includes('\0')) {
    throw new TypeError('A designer document requires a nonempty workspace URI of at most 4096 characters');
  }
  return uri;
}

/** Owns one document, its source synchronization, view state, cancellation, and disposable host resources. */
export class DesignerSession {
  constructor(uri, options = {}) {
    this.uri = designerDocumentUri(uri);
    this.kind = options.kind ?? (/\.sfdesign\.json$/i.test(uri) ? 'design' : 'csharp');
    this.disposed = false;
    this.listeners = new Set();
    this.resources = new Map();
    this.operations = new Map();
    this.timers = new Map();
    this.sourceSync = options.sourceSync ?? null;
    this.live = null;
    this.path = this.kind === 'design' ? uri : uri.replace(/(?:\.g)?\.cs$/i, '.sfdesign.json');
    this.status = 'Design document · no application code runs until Build & Run';
    this.viewState = normalizeDesignerViewState(options.viewState, this.kind === 'design' ? 'design' : 'code');
    this.pendingSelection = [...this.viewState.selection];
    this.pendingGuides = recoverSessionGuides(options.viewState?.guides);
    this.guideStateSource = null;
    this.guideStateSignature = 'null';
    this.document = options.document instanceof DesignDocument
      ? options.document : new DesignDocument(options.document ?? createDesign(uri.split('/').at(-1).slice(0, 100)));
  }

  get document() { return this._document; }
  set document(value) {
    this.assertOpen();
    if (!(value instanceof DesignDocument)) throw new TypeError('DesignerSession.document must be a DesignDocument');
    const retainedGuides = this.pendingGuides ?? (this.kind === 'design' ? null
      : recoverSessionGuides(this._document?.value.designer?.guides));
    this.documentSubscription?.();
    this._document = value;
    if (retainedGuides && (this.pendingGuides || !value.value.designer?.guides)) installSessionGuides(value, retainedGuides);
    this.recordGuideState();
    this.documentSubscription = value.subscribe(event => {
      if (event.kind === 'selection' && !this.applyingRecoveredSelection) this.pendingSelection = [];
      this.recordGuideState({notify: true});
      this.emit({kind: 'document', event});
    });
    this.applySelection();
    this.emit({kind: 'replace'});
  }

  get zoom() { return this.viewState.zoom; }
  set zoom(value) { this.setViewState({zoom: value}); }
  get mode() { return this.viewState.editingMode; }
  set mode(value) { this.setViewState({editingMode: value}); }
  get snap() { return this.viewState.snap; }
  set snap(value) { this.setViewState({snap: value}); }
  get preview() { return this.viewState.preview; }
  set preview(value) { this.setViewState({preview: value}); }

  assertOpen() {
    if (this.disposed) throw new Error(`Designer session is disposed: ${this.uri}`);
  }

  subscribe(listener) {
    this.assertOpen();
    if (typeof listener !== 'function') throw new TypeError('A session listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener({...event, session: this, uri: this.uri});
  }

  /** Updates view data only. Document revisions and undo history are never changed by a view operation. */
  setViewState(changes) {
    this.assertOpen();
    const next = normalizeDesignerViewState({...this.viewState, ...changes}, this.viewState.mode);
    const changed = Object.keys(next).filter(key => key === 'selection'
      ? next.selection.join('\0') !== this.viewState.selection.join('\0') : next[key] !== this.viewState[key]);
    if (!changed.length) return false;
    this.viewState = next;
    this.emit({kind: 'view', changed});
    return true;
  }

  /** Selection is retried after source initialization, so recovery does not select placeholder design nodes. */
  applySelection({final = false} = {}) {
    if (!this.pendingSelection?.length || !this._document) return;
    const known = new Set(this.document.value.nodes.map(node => node.id));
    const selection = this.pendingSelection.filter(id => known.has(id));
    if (selection.length) {
      this.applyingRecoveredSelection = true;
      try { this.document.select(selection); } finally { this.applyingRecoveredSelection = false; }
    }
    if (final) this.pendingSelection = [];
  }

  /** Selection and guide recovery share the source-initialization boundary, after its placeholder model is replaced. */
  applyRecovery({final = false} = {}) {
    this.assertOpen();
    if (this.pendingGuides && this._document) installSessionGuides(this.document, this.pendingGuides);
    this.recordGuideState();
    this.applySelection({final});
    if (final) this.pendingGuides = null;
  }

  recordGuideState({notify = false} = {}) {
    const source = this._document?.value.designer?.guides;
    if (source === this.guideStateSource) return;
    this.guideStateSource = source;
    const signature = JSON.stringify(recoverSessionGuides(source));
    if (signature === this.guideStateSignature) return;
    this.guideStateSignature = signature;
    if (notify) {
      this.pendingGuides = null;
      this.emit({kind: 'view', changed: ['guides']});
    }
  }

  snapshot() {
    const selection = this.pendingSelection.length ? this.pendingSelection : this.document.selection;
    const guides = recoverSessionGuides(this.pendingGuides ?? this.document.value.designer?.guides);
    return {uri: this.uri, kind: this.kind, ...this.viewState, selection: [...selection], ...(guides ? {guides} : {})};
  }

  restore(snapshot) {
    this.assertOpen();
    this.viewState = normalizeDesignerViewState(snapshot, this.kind === 'design' ? 'design' : 'code');
    this.pendingSelection = [...this.viewState.selection];
    this.pendingGuides = recoverSessionGuides(snapshot?.guides);
    this.applyRecovery();
    this.emit({kind: 'restore'});
  }

  /** Own a resource by name. Replacement disposes the previous resource; close disposes each remaining resource once. */
  own(name, resource, dispose = null) {
    this.assertOpen();
    if (this.resources.get(name)?.resource === resource) return resource;
    this.release(name);
    const cleanup = dispose ?? (() => {
      if (typeof resource === 'function') resource();
      else if (typeof resource?.dispose === 'function') resource.dispose();
      else if (typeof resource?.disconnect === 'function') resource.disconnect();
      else if (typeof resource?.abort === 'function') resource.abort();
      else throw new TypeError(`Designer resource '${name}' has no disposal contract`);
    });
    this.resources.set(name, {resource, cleanup});
    return resource;
  }

  release(name) {
    const owned = this.resources.get(name);
    if (!owned) return;
    this.resources.delete(name);
    owned.cleanup();
  }

  /** A named task invalidates its predecessor; completion must check current() before applying results. */
  beginOperation(name) {
    this.assertOpen();
    this.operations.get(name)?.abort();
    const controller = new AbortController();
    this.operations.set(name, controller);
    return {
      signal: controller.signal,
      current: () => !this.disposed && !controller.signal.aborted && this.operations.get(name) === controller,
      finish: () => { if (this.operations.get(name) === controller) this.operations.delete(name); }
    };
  }

  /** A deterministic keyed debounce; the supplied scheduler can be a test clock. */
  schedule(name, callback, delay, scheduler = globalThis) {
    this.assertOpen();
    if (typeof callback !== 'function' || !Number.isFinite(delay) || delay < 0) throw new TypeError('Invalid designer timer');
    this.cancelTimer(name);
    const handle = scheduler.setTimeout(() => {
      this.timers.delete(name);
      if (!this.disposed) callback();
    }, delay);
    this.timers.set(name, {handle, scheduler});
    return handle;
  }

  cancelTimer(name) {
    const timer = this.timers.get(name);
    if (!timer) return;
    this.timers.delete(name);
    timer.scheduler.clearTimeout(timer.handle);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const controller of this.operations.values()) controller.abort();
    this.operations.clear();
    for (const name of this.timers.keys()) this.cancelTimer(name);
    const errors = [];
    const attempt = action => { try { action(); } catch (error) { errors.push(error); } };
    attempt(() => this.documentSubscription?.());
    this.documentSubscription = null;
    if (this.sourceSync && ![...this.resources.values()].some(value => value.resource === this.sourceSync)) {
      attempt(() => this.sourceSync.dispose());
    }
    for (const name of [...this.resources.keys()].reverse()) attempt(() => this.release(name));
    attempt(() => this.document.dispose());
    this.pendingGuides = null;
    this.guideStateSource = null;
    this.guideStateSignature = 'null';
    this.sourceSync = null;
    this.live = null;
    attempt(() => this.emit({kind: 'dispose'}));
    this.listeners.clear();
    if (errors.length) throw new AggregateError(errors, `Could not dispose every designer resource for ${this.uri}`);
  }
}
