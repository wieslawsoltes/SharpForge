import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { GIT_PROTOCOL_VERSION, GIT_WORKER_LIMITS, validateGitMessage } from './protocol.js';

/** A disposable worker endpoint. Retired session IDs cannot reopen resources through late messages. */
export function createGitWorkerServer({ endpoint, createService, maxPending = GIT_WORKER_LIMITS.maxPending,
  maxSessions = 32, maxSessionHistory = 1024 }) {
  checkLimit(maxPending, 10000, 'Pending Git worker requests');
  checkLimit(maxSessions, 1024, 'Active Git worker sessions');
  checkLimit(maxSessionHistory, 100000, 'Git worker session history');
  if (!maxPending || !maxSessions || maxSessionHistory < maxSessions) throw new GitError('Limit', 'Invalid Git worker session bounds');
  const sessions = new Map();
  const retired = new Set();
  const pending = new Map();
  let closed = false;
  let disposal;
  const send = message => { if (!closed) endpoint.postMessage({ version: GIT_PROTOCOL_VERSION, ...message }); };
  const listener = event => { void receive(event.data); };

  function errorEnvelope(service, error) {
    try {
      const value = service?.serializeError ? service.serializeError(error) : GitError.from(error).toJSON();
      return new GitError(value.code, value.message, value.details).toJSON();
    } catch { return new GitError('Corrupt', 'Git worker could not serialize its diagnostic').toJSON(); }
  }

  function retire(session, entry) {
    if (sessions.get(session) === entry) sessions.delete(session);
    retired.add(session);
  }

  function openSession(session) {
    if (sessions.size >= maxSessions || sessions.size + retired.size >= maxSessionHistory) {
      throw new GitError('Limit', 'Git worker session limit reached; create a new worker');
    }
    const entry = { lastId: 0, closing: false, disposal: null };
    entry.ready = Promise.resolve().then(() => createService(session));
    sessions.set(session, entry);
    entry.ready.catch(() => retire(session, entry));
    return entry;
  }

  function closeSession(session, entry) {
    if (entry.disposal) return entry.disposal;
    entry.closing = true;
    for (const [key, controller] of pending) if (key.startsWith(`${session}:`)) controller.abort();
    entry.disposal = entry.ready.then(service => service.dispose()).finally(() => retire(session, entry));
    return entry.disposal;
  }

  async function receive(input) {
    if (closed) return;
    let message;
    try { message = validateGitMessage(input); }
    catch (error) {
      if (typeof input?.session === 'string' && /^[a-zA-Z0-9._-]{1,128}$/.test(input.session) && Number.isSafeInteger(input?.id)) {
        send({ type: 'response', session: input.session, id: input.id, error: errorEnvelope(null, error) });
      }
      return;
    }
    const { session, id } = message;
    const key = `${session}:${id}`;
    if (message.type === 'cancel') { pending.get(key)?.abort(); return; }
    const envelope = { session, id, type: 'response' };
    if (retired.has(session)) {
      send({ ...envelope, ...(message.method === 'dispose' ? { result: true }
        : { error: new GitError('Disposed', 'Git worker session was disposed').toJSON() }) });
      return;
    }
    if (pending.has(key) || pending.size >= maxPending) {
      pending.get(key)?.abort();
      send({ ...envelope, error: new GitError('Limit', 'Duplicate or excessive Git worker request').toJSON() });
      return;
    }
    let entry = sessions.get(session);
    if (entry?.closing) {
      send({ ...envelope, error: new GitError('Disposed', 'Git worker session is closing').toJSON() });
      return;
    }
    if (message.method === 'dispose' && !entry) {
      if (sessions.size + retired.size >= maxSessionHistory) {
        send({ ...envelope, error: new GitError('Limit', 'Git worker session history is full').toJSON() });
      } else { retired.add(session); send({ ...envelope, result: true }); }
      return;
    }
    const controller = new AbortController();
    pending.set(key, controller);
    let service;
    try {
      entry ??= openSession(session);
      if (id <= entry.lastId) throw new GitError('Conflict', 'Git worker request identity was already used');
      entry.lastId = id;
      if (message.method === 'dispose') {
        await closeSession(session, entry);
        send({ ...envelope, result: true });
        return;
      }
      service = await entry.ready;
      checkCancelled(controller.signal);
      if (closed || entry.closing) throw new GitError('Disposed', 'Git worker session is closing');
      const result = await service.request(message.method, message.params, {
        signal: controller.signal,
        onProgress: progress => {
          if (!controller.signal.aborted && !entry.closing) send({ session, id, type: 'progress', progress });
        }
      });
      if (!controller.signal.aborted && !entry.closing) send({ ...envelope, result });
    } catch (error) {
      send({ ...envelope, error: errorEnvelope(service, error) });
    } finally { pending.delete(key); }
  }

  endpoint.addEventListener('message', listener);
  endpoint.start?.();
  return {
    dispose() {
      if (disposal) return disposal;
      closed = true;
      endpoint.removeEventListener('message', listener);
      for (const controller of pending.values()) controller.abort();
      const closing = [...sessions].map(([session, entry]) => closeSession(session, entry));
      disposal = Promise.allSettled(closing).then(results => {
        sessions.clear();
        retired.clear();
        pending.clear();
        const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (errors.length) throw new AggregateError(errors, 'Git worker disposal failed');
      });
      return disposal;
    }
  };
}
