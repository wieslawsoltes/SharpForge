import { AppSession } from './app-session.js';
import { WorkbenchEvents, requireIdentifier, workbenchError } from './state-events.js';

/** Selection is explicit; background events never select another application. */
export class SessionManager {
  constructor({ maxSessions = 8, ...options } = {}) {
    if (!Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > 64) throw new RangeError('Session limit must be 1–64');
    this.maxSessions = maxSessions;
    this.options = options;
    this.sessions = new Map();
    this.subscriptions = new Map();
    this.events = new WorkbenchEvents();
    this.activeId = null;
    this.recent = [];
    this.nextId = 0;
    this.disposed = false;
  }

  subscribe(listener, options) { return this.events.subscribe(listener, options); }
  get active() { return this.sessions.get(this.activeId) ?? null; }
  get(id) { return this.sessions.get(id) ?? null; }

  require(id = this.activeId) {
    const session = this.get(id);
    if (!session) throw workbenchError('SESSION_MISSING', `Unknown application session '${id}'`);
    return session;
  }

  list({ projectId, liveOnly = false } = {}) {
    return [...this.sessions.values()].filter(session => {
      return (projectId === undefined || session.projectId === projectId) && (!liveOnly || session.live);
    });
  }

  create(descriptor, { activate = true } = {}) {
    if (this.disposed) throw workbenchError('SESSIONS_DISPOSED', 'Session manager is disposed');
    requireIdentifier(descriptor.projectId, 'Project id');
    let id = descriptor.id;
    if (id === undefined) {
      do { id = `app-${++this.nextId}`; } while (this.sessions.has(id));
    }
    requireIdentifier(id, 'Application id');
    if (this.sessions.has(id)) throw new Error(`Duplicate application session '${id}'`);
    if (this.sessions.size >= this.maxSessions) {
      const ended = this.list().filter(session => session.ended && !session.live);
      const retired = ended.find(session => session.id !== this.activeId) ?? ended[0];
      if (retired) this.remove(retired.id);
    }
    if (this.sessions.size >= this.maxSessions) throw workbenchError('SESSION_LIMIT', `The ${this.maxSessions}-application session limit is reached`);
    const session = new AppSession({ ...descriptor, id }, this.options);
    this.sessions.set(id, session);
    this.subscriptions.set(id, session.subscribe(event => this.receive(session, event)));
    this.events.emit({ type: 'created', session, appId: id, projectId: session.projectId, active: false });
    if (activate || this.activeId === null) this.setActive(id);
    return session;
  }

  receive(session, event) {
    const wasActive = this.activeId === session.id;
    this.events.emit({ ...event, active: wasActive });
    if (event.type === 'ended' && wasActive) {
      const next = [...this.recent].reverse().find(id => id !== session.id && this.sessions.get(id)?.live);
      if (next) this.setActive(next);
    }
  }

  setActive(id) {
    if (id !== null) this.require(id);
    if (this.activeId === id) return this.active;
    const previous = this.active;
    this.activeId = id;
    this.recent = this.recent.filter(value => value !== id);
    if (id !== null) this.recent.push(id);
    this.events.emit({ type: 'selected', session: this.active, previous, appId: id, projectId: this.active?.projectId, active: true });
    return this.active;
  }

  remove(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.subscriptions.get(id)?.();
    this.subscriptions.delete(id);
    session.dispose();
    this.sessions.delete(id);
    this.options.output?.remove(session.channelId);
    this.recent = this.recent.filter(value => value !== id);
    if (this.activeId === id) this.setActive(this.recent.at(-1) ?? null);
    this.events.emit({ type: 'removed', session, appId: id, projectId: session.projectId });
  }

  async stopAll() {
    const results = await Promise.allSettled(this.list().map(session => session.stop()));
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'Some applications could not stop');
  }

  resources() {
    return { limit: this.maxSessions, count: this.sessions.size, live: this.list({ liveOnly: true }).length };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of [...this.sessions.keys()]) this.remove(id);
    this.events.dispose();
  }
}
