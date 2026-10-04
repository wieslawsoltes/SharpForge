import { WorkbenchEvents } from '../state-events.js';
import { validateWatchState } from './state.js';

const relevantEvents = new Set(['created', 'selected', 'removed', 'state', 'location', 'starting', 'started', 'ended']);

/** A Watch window owns its expressions/results and captures one AppSession generation and frame per refresh. */
export class WatchWindowModel {
  constructor({ record, sessions, state, visible = () => true, onError = () => {} }) {
    this.record = record;
    this.sessions = sessions;
    this.state = state;
    this.visible = visible;
    this.onError = onError;
    const saved = state.get(record.id) ?? { expressions: [], target: record.sessionId ? `session:${record.sessionId}` : 'active' };
    Object.assign(this, validateWatchState(saved));
    this.values = new Map();
    this.events = new WorkbenchEvents();
    this.generation = 0;
    this.revision = 0;
    this.lastKey = null;
    this.status = 'Open this window to evaluate expressions';
    this.unsubscribe = sessions.subscribe(event => this.sessionChanged(event));
    this.settled = Promise.resolve();
  }

  get session() { return this.target === 'active' ? this.sessions.active : this.sessions.get(this.target.slice(8)); }
  subscribe(listener) { return this.events.subscribe(listener); }
  notify() { this.events.emit({ type: 'changed', model: this }); }

  configure(expressions, target = this.target) {
    if (this.disposed) throw new Error('Watch window is disposed');
    const next = validateWatchState({ expressions, target });
    this.state.set(this.record.id, next);
    Object.assign(this, next);
    this.revision++;
    this.values.clear();
    this.notify();
    return this.refresh();
  }

  add(expression) { return this.configure([...this.expressions, expression]); }
  remove(expression) { return this.configure(this.expressions.filter(value => value !== expression)); }
  replace(expression, value) { return this.configure(this.expressions.map(item => item === expression ? value : item)); }
  select(target) {
    if (target !== 'active' && (!target.startsWith('session:') || !this.sessions.get(target.slice(8)))) {
      throw new Error('The selected application is unavailable');
    }
    return this.configure(this.expressions, target);
  }

  sessionChanged(event) {
    if (!relevantEvents.has(event.type)) return;
    const session = this.session;
    if (['created', 'removed', 'selected'].includes(event.type)) this.notify();
    if (this.target === 'active' && event.type === 'selected' || event.appId === session?.id
        || event.type === 'removed' && `session:${event.appId}` === this.target) this.refresh();
  }

  cancel() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.lastKey = null;
  }

  /** Hidden tools never issue evaluation requests; results from a hidden, resumed or replaced frame are discarded. */
  refresh({ force = false } = {}) {
    if (this.disposed) return Promise.resolve(false);
    const session = this.session;
    if (!this.visible()) { this.cancel(); return Promise.resolve(false); }
    if (!session || session.state !== 'paused' || session.disposed) {
      this.cancel();
      this.values.clear();
      this.status = !session ? 'The selected application is unavailable' : 'Pause this application to evaluate expressions';
      this.notify();
      return Promise.resolve(false);
    }
    const key = `${session.identity}:${session.frameId}:${session.watchEpoch}:${this.revision}`;
    if (!force && key === this.lastKey) return this.settled;
    this.cancel();
    this.lastKey = key;
    const capture = { session, identity: session.identity, frameId: session.frameId, epoch: session.watchEpoch,
      generation: this.generation, expressions: [...this.expressions] };
    this.controller = new AbortController();
    this.status = this.expressions.length ? 'Evaluating expressions…' : 'Add an expression';
    this.notify();
    this.settled = this.evaluate(capture, this.controller.signal).catch(error => {
      if (!this.disposed && error.name !== 'AbortError') this.onError(error);
      return false;
    });
    return this.settled;
  }

  current(capture) {
    return !this.disposed && this.visible() && this.generation === capture.generation && this.session === capture.session
      && capture.session.identity === capture.identity && capture.session.frameId === capture.frameId
      && capture.session.watchEpoch === capture.epoch && capture.session.state === 'paused';
  }

  async evaluate(capture, signal) {
    const values = new Map();
    for (const expression of capture.expressions) {
      if (!this.current(capture) || signal.aborted) return false;
      try {
        const result = await capture.session.request('evaluate', {
          expression, frameId: capture.frameId, identity: capture.identity
        }, { signal });
        values.set(expression, { result: String(result.result ?? '').slice(0, 65536), type: String(result.type ?? '').slice(0, 4096) });
      } catch (error) {
        if (!this.current(capture) || signal.aborted) return false;
        values.set(expression, { error: String(error.message).slice(0, 4096) });
      }
    }
    if (!this.current(capture)) return false;
    this.values = values;
    this.status = `${capture.session.name} · frame ${capture.frameId ?? 'current'} · ${values.size} expressions`;
    this.notify();
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.unsubscribe();
    this.events.dispose();
    this.values.clear();
  }
}
