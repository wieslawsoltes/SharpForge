import {DesignerSession, designerDocumentUri, normalizeDesignerViewState} from './designer-session.js';
import {recoverSessionGuides} from './session-guide-state.js';

function recoveredSessionState(item) {
  const kind = ['design', 'csharp', 'resources'].includes(item.kind) ? item.kind
    : /\.sfdesign\.json$/i.test(item.uri) ? 'design' : 'csharp';
  const guides = recoverSessionGuides(item.guides);
  return {uri: item.uri, kind, ...normalizeDesignerViewState(item, kind === 'design' ? 'design' : 'code'), ...(guides ? {guides} : {})};
}

/** Explicit workspace registry; tab visibility does not determine session lifetime. */
export class DesignerSessionRegistry {
  constructor({createSession = (uri, options) => new DesignerSession(uri, options), maxSessions = 256} = {}) {
    if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 4096) throw new RangeError('Invalid designer session limit');
    this.createSession = createSession;
    this.maxSessions = maxSessions;
    this.sessions = new Map();
    this.subscriptions = new Map();
    this.pendingState = new Map();
    this.listeners = new Set();
    this.activeUri = null;
    this.disposed = false;
  }

  get size() { return this.sessions.size; }
  get active() { return this.get(this.activeUri); }
  set active(value) { this.activate(typeof value === 'string' ? value : value?.uri ?? null); }
  get(uri) { return this.sessions.get(uri) ?? null; }

  assertOpen() {
    if (this.disposed) throw new Error('Designer session registry is disposed');
  }

  open(uri, options = {}) {
    this.assertOpen();
    designerDocumentUri(uri);
    const existing = this.get(uri);
    if (existing) return existing;
    if (this.size >= this.maxSessions) throw new RangeError(`Designer session limit (${this.maxSessions}) exceeded`);
    const session = this.createSession(uri, {...options, viewState: this.pendingState.get(uri) ?? options.viewState});
    if (!session || session.uri !== uri || session.disposed) throw new TypeError('Session factory returned an invalid session');
    this.pendingState.delete(uri);
    this.sessions.set(uri, session);
    this.subscriptions.set(uri, session.subscribe(event => this.emit({kind: 'change', uri, session, event})));
    this.emit({kind: 'open', uri, session});
    return session;
  }

  activate(uri) {
    this.assertOpen();
    if (uri !== null && !this.sessions.has(uri)) throw new Error(`Designer document is not open: ${uri}`);
    if (this.activeUri === uri) return this.active;
    const previous = this.active;
    this.activeUri = uri;
    this.emit({kind: 'active', uri, session: this.active, previous});
    return this.active;
  }

  close(uri, {preserveState = false} = {}) {
    this.assertOpen();
    this.pendingState.delete(uri);
    const session = this.get(uri);
    if (!session) return false;
    if (this.activeUri === uri) this.activate(null);
    this.subscriptions.get(uri)?.();
    this.subscriptions.delete(uri);
    this.sessions.delete(uri);
    if (preserveState) {
      this.pendingState.set(uri, session.snapshot());
      while (this.pendingState.size > this.maxSessions) this.pendingState.delete(this.pendingState.keys().next().value);
    }
    try { session.dispose(); } finally { this.emit({kind: 'close', uri, session}); }
    return true;
  }

  /** Reconciles file removal, not tab switches. Both source records and standalone design records can be supplied. */
  syncFiles(files) {
    this.assertOpen();
    const uris = new Set(files.map(file => typeof file === 'string' ? file : file.uri ?? file.path));
    const errors = [];
    for (const uri of this.sessions.keys()) {
      if (uris.has(uri)) continue;
      try { this.close(uri); } catch (error) { errors.push(error); }
    }
    for (const uri of this.pendingState.keys()) if (!uris.has(uri)) this.pendingState.delete(uri);
    if (errors.length) throw new AggregateError(errors, 'Some removed designer documents could not be fully disposed');
  }

  subscribe(listener) {
    this.assertOpen();
    if (typeof listener !== 'function') throw new TypeError('A registry listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  snapshot() {
    const snapshots = new Map([...this.pendingState].map(([uri, value]) => [uri, structuredClone(value)]));
    for (const [uri, session] of this.sessions) snapshots.set(uri, session.snapshot());
    return {version: 1, activeUri: this.activeUri, documents: [...snapshots.values()]};
  }

  /** Recovery is optional data: unknown versions and malformed entries are ignored without opening files. */
  restore(snapshot, {files = null} = {}) {
    this.assertOpen();
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.documents)) return false;
    const allowed = files ? new Set(files.map(file => typeof file === 'string' ? file : file.uri ?? file.path)) : null;
    this.pendingState.clear();
    for (const item of snapshot.documents.slice(0, this.maxSessions)) {
      if (!item || typeof item.uri !== 'string' || !item.uri || item.uri.length > 4096 || item.uri.includes('\0')) continue;
      if (allowed && !allowed.has(item.uri)) continue;
      const recovery = recoveredSessionState(item);
      const session = this.get(item.uri);
      if (session) session.restore(recovery);
      else this.pendingState.set(item.uri, recovery);
    }
    if (snapshot.activeUri === null || this.sessions.has(snapshot.activeUri)) this.activate(snapshot.activeUri);
    this.emit({kind: 'restore'});
    return true;
  }

  dispose() {
    if (this.disposed) return;
    const errors = [];
    for (const uri of [...this.sessions.keys()]) {
      try { this.close(uri); } catch (error) { errors.push(error); }
    }
    this.disposed = true;
    this.pendingState.clear();
    this.listeners.clear();
    if (errors.length) throw new AggregateError(errors, 'Could not dispose every designer session');
  }
}
