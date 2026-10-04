const followCommands = new Set([
  'debug', 'run', 'pause', 'next', 'stepIn', 'stepOut', 'stepBack', 'reverseContinue', 'runToCursor', 'setNext'
]);
const modifierKeys = new Set(['Alt', 'Control', 'Shift', 'Meta', 'AltGraph']);

/** Captured user actions own reveals; session epochs prevent a restarted application inheriting an old action. */
export class StudioReveals {
  constructor(services) {
    this.services = services;
    this.policy = services.reveal;
    this.following = new WeakMap();
    this.starting = new WeakMap();
    this.documents = new Map();
    this.disposed = false;
    this.unsubscribe = services.sessions.subscribe(event => {
      if (event.type !== 'starting') return;
      const ticket = this.starting.get(event.session);
      if (!ticket) return;
      this.starting.delete(event.session);
      this.follow(event.session, ticket);
    });
  }

  begin({ background = false, projectId = this.services.builds.activeId } = {}) {
    return {
      userInitiated: !background, projectId,
      intent: background ? this.policy.intent : this.policy.userIntent(),
      initialSession: this.services.sessions.active
    };
  }

  command(id) {
    const ticket = this.begin();
    if (followCommands.has(id)) this.follow(this.services.sessions.active, ticket);
  }

  follow(session, ticket, { starting = false } = {}) {
    if (this.disposed || !session) return;
    if (starting) this.starting.set(session, ticket);
    else this.following.set(session, { ticket, epoch: session.launchEpoch, generation: session.worker.generation });
  }

  clearStarting(session, ticket) {
    if (this.starting.get(session) === ticket) this.starting.delete(session);
  }

  canActivate(ticket, session) {
    const active = this.services.sessions.active;
    return !this.disposed && this.policy.allows(ticket) && (active === ticket.initialSession || active === session);
  }

  /** Legacy events carry the composite app/worker/runtime identity, never a bare worker-local serial. */
  runtime(event, panel, onReveal) {
    if (this.disposed) return false;
    const session = this.services.sessions.get(event.appId);
    const following = session && this.following.get(session);
    if (!following || session !== this.services.sessions.active || event.sessionId !== session.identity ||
        following.epoch !== session.launchEpoch || following.generation !== session.worker.generation) return false;
    return this.policy.request(panel, { ...following.ticket, sessionId: session.id, onReveal });
  }

  application(sessionId, onReveal) {
    const session = this.services.sessions.get(sessionId);
    return session ? this.runtime({ appId: session.id, sessionId: session.identity }, `app:${session.id}`, onReveal) : false;
  }

  /** Capture real navigation in the main document and detached tools; programmatic focus does not reset a ticket. */
  install(document) {
    if (this.disposed) throw new Error('Studio reveal navigation is disposed');
    if (this.documents.has(document)) return this.documents.get(document);
    const capture = { capture: true };
    const input = event => {
      if (event.type !== 'keydown' || !modifierKeys.has(event.key)) this.policy.userIntent();
    };
    const dispose = () => {
      if (!this.documents.delete(document)) return;
      document.removeEventListener('pointerdown', input, capture);
      document.removeEventListener('keydown', input, capture);
      document.defaultView?.removeEventListener('unload', dispose);
    };
    document.addEventListener('pointerdown', input, capture);
    document.addEventListener('keydown', input, capture);
    document.defaultView?.addEventListener('unload', dispose, { once: true });
    this.documents.set(document, dispose);
    return dispose;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    for (const dispose of [...this.documents.values()]) dispose();
    this.following = new WeakMap();
    this.starting = new WeakMap();
  }
}
