import { WorkbenchEvents, requireIdentifier } from './state-events.js';

class OutputBuffer {
  constructor(maxEntries, maxCharacters) {
    this.capacity = maxEntries;
    this.maxCharacters = maxCharacters;
    this.entries = new Array(maxEntries);
    this.first = 0;
    this.count = 0;
    this.characters = 0;
    this.dropped = 0;
    this.next = 0;
    this.cached = '';
  }

  removeFirst() {
    const entry = this.entries[this.first];
    this.characters -= entry.text.length;
    this.entries[this.first] = undefined;
    this.first = (this.first + 1) % this.capacity;
    this.count--;
    this.dropped++;
  }

  append(text, metadata) {
    if (!text) return;
    if (text.length > this.maxCharacters) text = text.slice(-this.maxCharacters);
    while (this.count && (this.count === this.capacity || this.characters + text.length > this.maxCharacters)) {
      this.removeFirst();
    }
    const entry = Object.freeze({ ...metadata, id: ++this.next, text });
    this.entries[(this.first + this.count) % this.capacity] = entry;
    this.count++;
    this.characters += text.length;
    this.cached = null;
    return entry;
  }

  read(start, count) {
    const result = [];
    const end = Math.min(this.count, start + count);
    for (let index = start; index < end; index++) result.push(this.entries[(this.first + index) % this.capacity]);
    return result;
  }

  text() {
    if (this.cached === null) this.cached = this.read(0, this.count).map(entry => entry.text).join('');
    return this.cached;
  }

  clear() {
    this.entries.fill(undefined);
    this.first = 0;
    this.count = 0;
    this.characters = 0;
    this.dropped = 0;
    this.cached = '';
  }
}

const standardChannels = ['Build', 'Build Order', 'Debug', 'MSBuild', 'Designer', 'Tests'];

/** Named bounded channels isolate project and application output; reading is viewport-sized. */
export class OutputChannels {
  constructor({ maxChannels = 512, maxEntries = 4096, maxCharacters = 2_000_000, now = () => Date.now() } = {}) {
    for (const limit of [maxChannels, maxEntries, maxCharacters]) {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Invalid output limit');
    }
    this.limits = { maxChannels, maxEntries, maxCharacters };
    this.channels = new Map();
    this.events = new WorkbenchEvents();
    this.now = now;
    for (const name of standardChannels) this.ensure(name, { name });
  }

  subscribe(listener, options) { return this.events.subscribe(listener, options); }

  ensure(id, { name = id, projectId = null, sessionId = null, kind = 'system' } = {}) {
    requireIdentifier(id, 'Channel id');
    if (this.channels.has(id)) return this.get(id);
    if (this.channels.size >= this.limits.maxChannels) throw new RangeError('Output channel limit reached');
    const buffer = new OutputBuffer(this.limits.maxEntries, this.limits.maxCharacters);
    this.channels.set(id, { id, name, projectId, sessionId, kind, buffer, revision: 0 });
    this.events.emit({ type: 'channel', channelId: id, channel: this.get(id) });
    return this.get(id);
  }

  program(session) {
    const id = `program:${session.id}`;
    this.ensure(id, { name: `${session.name} · Program`, projectId: session.projectId, sessionId: session.id, kind: 'program' });
    return id;
  }

  get(id) {
    const channel = this.channels.get(id);
    if (!channel) return null;
    const { buffer, ...metadata } = channel;
    return Object.freeze({ ...metadata, count: buffer.count, characters: buffer.characters, dropped: buffer.dropped });
  }

  list({ projectId, sessionId, kind } = {}) {
    return [...this.channels.values()]
      .filter(channel => projectId === undefined || channel.projectId === projectId)
      .filter(channel => sessionId === undefined || channel.sessionId === sessionId)
      .filter(channel => kind === undefined || channel.kind === kind)
      .map(channel => this.get(channel.id));
  }

  append(id, text, metadata = {}) {
    if (typeof text !== 'string') throw new TypeError('Output must be text');
    if (!this.channels.has(id)) this.ensure(id);
    const channel = this.channels.get(id);
    const entry = channel.buffer.append(text, { timestamp: this.now(), severity: 'info', ...metadata });
    if (!entry) return null;
    channel.revision++;
    this.events.emit({ type: 'output', channelId: id, channel: this.get(id), entry });
    return entry;
  }

  read(id, { start = 0, count = 200 } = {}) {
    if (![start, count].every(value => Number.isSafeInteger(value) && value >= 0)) throw new RangeError('Invalid output viewport');
    return this.channels.get(id)?.buffer.read(start, Math.min(count, this.limits.maxEntries)) ?? [];
  }

  text(id) { return this.channels.get(id)?.buffer.text() ?? ''; }

  clear(id) {
    const channel = this.channels.get(id);
    if (!channel) return;
    channel.buffer.clear();
    channel.revision++;
    this.events.emit({ type: 'clear', channelId: id, channel: this.get(id) });
  }

  remove(id) {
    if (this.channels.delete(id)) this.events.emit({ type: 'removed', channelId: id });
  }

  dispose() { this.channels.clear(); this.events.dispose(); }
}
