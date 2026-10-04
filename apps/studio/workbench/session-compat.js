import { workbenchError } from './state-events.js';

/** Legacy UI guards compare sessionId, so expose a collision-free identity at that boundary. */
export function legacyDebug(session) {
  if (!session?.debug) return null;
  if (session.legacyDebugSource !== session.debug || session.legacyDebugIdentity !== session.identity) {
    session.legacyDebugSource = session.debug;
    session.legacyDebugIdentity = session.identity;
    session.legacyDebugValue = {
      ...session.debug, sessionId: session.identity, runtimeSessionId: session.runtimeSession, appId: session.id
    };
  }
  return session.legacyDebugValue;
}

export function legacyRuntimeEvent(session, event) {
  return { ...event, sessionId: session.identity, runtimeSessionId: event.sessionId ?? session.runtimeSession, appId: session.id };
}

export function setLegacyDebug(session, value) {
  if (!value) { session.debug = null; return; }
  const serial = value.runtimeSessionId ?? (typeof value.sessionId === 'number' ? value.sessionId : session.runtimeSession);
  if (typeof value.sessionId === 'string' && value.sessionId !== session.identity) {
    throw workbenchError('SESSION_STALE', 'Cannot assign debug state from another application generation');
  }
  session.debug = { ...value, sessionId: serial, identity: session.identity, appId: session.id };
  session.state = value.state ?? session.state;
}

/** Capture the target session synchronously and translate only its matching compatibility ID. */
export function createRuntimeFacade(sessions, { resolveSession = () => sessions.active, createSession } = {}) {
  return {
    get worker() { return resolveSession()?.worker.worker ?? null; },
    get pending() { return resolveSession()?.worker.pending ?? new Map(); },
    get generation() { return resolveSession()?.worker.generation ?? 0; },
    get activeSession() { return resolveSession(); },
    request(method, params = {}, options = {}) {
      let session = resolveSession();
      if (!session && method === 'launch') session = createSession?.(params);
      if (!session) return Promise.reject(workbenchError('SESSION_MISSING', 'Select or start an application first'));
      const wire = { ...params };
      if (typeof wire.sessionId === 'string') {
        if (wire.sessionId !== session.identity) return Promise.reject(workbenchError('SESSION_STALE', 'Selected application changed'));
        wire.identity = wire.sessionId;
        wire.sessionId = session.runtimeSession;
      }
      if (wire.runtimeSessionId !== undefined) {
        if (wire.runtimeSessionId !== session.runtimeSession) return Promise.reject(workbenchError('SESSION_STALE', 'Runtime generation changed'));
        delete wire.runtimeSessionId;
      }
      return session.request(method, wire, options);
    }
  };
}
