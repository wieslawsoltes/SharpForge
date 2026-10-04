import { SequenceCrdt } from '../../packages/git/src/collab/crdt.js';
import { collaborationMessage } from '../../packages/git/src/collab/protocol.js';

export function identity(clientId, overrides = {}) {
  return { workspaceId: 'workspace', roomId: 'room', documentId: 'Program.cs', clientId, ...overrides };
}

export function document(clientId, overrides = {}) {
  return new SequenceCrdt({ ...identity(clientId), actorId: clientId, ...overrides });
}

export function tokenFor(value) {
  return 'test-only:' + JSON.stringify([value.workspaceId, value.roomId, value.documentId, value.clientId]);
}

export function authorize({ identity: value, token }) {
  if (token !== tokenFor(value)) throw new Error('Rejected test-only room token');
  return { identity: value, permissions: { read: true, write: true } };
}

export function client(server, value) {
  const messages = [];
  const closed = [];
  const connection = server.attach({
    send: text => { messages.push(JSON.parse(text)); },
    close: (code, reason) => { closed.push({ code, reason }); }
  });
  return {
    messages, closed, connection, identity: value,
    send: (type, fields = {}) => connection.receive(JSON.stringify(collaborationMessage(type, fields))),
    authenticate: (token = tokenFor(value)) => connection.receive(JSON.stringify(collaborationMessage('auth', { identity: value, token })))
  };
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, failed) => { resolve = done; reject = failed; });
  return { promise, resolve, reject };
}

export function settle() {
  return new Promise(resolve => setImmediate(resolve));
}

export async function waitFor(predicate, message = 'Condition did not become true', timeout = 3000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= end) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

/** Deterministic timer adapter; it does not pretend to qualify a browser or a real socket. */
export class ManualClock {
  time = 0;
  serial = 0;
  timers = new Map();

  now = () => this.time;
  setTimeout = (callback, delay) => {
    const id = ++this.serial;
    this.timers.set(id, { at: this.time + delay, callback });
    return id;
  };
  clearTimeout = id => this.timers.delete(id);

  async advance(milliseconds) {
    const target = this.time + milliseconds;
    for (;;) {
      const next = [...this.timers].filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!next) break;
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
      await settle();
    }
    this.time = target;
    await settle();
  }
}

/** In-process socket contract fixture. Native RFC6455 conformance has its own loopback tests. */
export function socketConstructor(server, { fail = false } = {}) {
  return class Socket {
    static instances = [];
    readyState = 0;
    bufferedAmount = 0;
    sent = [];

    constructor(url) {
      this.url = url;
      this.constructor.instances.push(this);
      this.connection = server.attach({
        send: text => {
          if (this.readyState === 1) this.onmessage?.({ data: text });
        },
        close: (code, reason) => this.cut(code, reason)
      });
      queueMicrotask(() => {
        if (this.readyState !== 0) return;
        if (fail) { this.cut(1006, 'Offline fixture'); return; }
        this.readyState = 1;
        this.onopen?.();
      });
    }

    send(text) {
      if (this.readyState !== 1) throw new Error('Fixture socket is closed');
      this.sent.push(text);
      void this.connection.receive(text);
    }

    cut(code = 1006, reason = 'Disconnected fixture') {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.connection.close();
      this.onclose?.({ code, reason });
    }

    close(code = 1000, reason = 'Closed fixture') {
      this.cut(code, reason);
    }
  };
}
