/** Stable names in an EventPipe-shaped JSON stream. Timestamps count executed instructions. */
export const RuntimeEventName = Object.freeze({
  MethodLoad: 'MethodLoad', MethodEnter: 'MethodEnter', MethodLeave: 'MethodLeave',
  ExceptionThrown: 'ExceptionThrown', GCStart: 'GCStart', GCEnd: 'GCEnd',
  TierUp: 'TierUp', Suspend: 'Suspend', Resume: 'Resume', AllocationTick: 'AllocationTick'
});
const names = new Set(Object.values(RuntimeEventName));

function boundedInteger(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError('Invalid ' + name);
  return value;
}

function copyPayload(payload) {
  if (payload === undefined) return Object.freeze({});
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Event payload must be an object');
  const entries = Object.entries(payload);
  if (entries.length > 64) throw new RangeError('Runtime event payload has too many fields');
  for (const [key, value] of entries) {
    if (key.length > 256 || typeof value === 'string' && value.length > 16384) throw new RangeError('Runtime event text is too long');
    if (value !== null && typeof value !== 'string' && typeof value !== 'boolean' &&
        !(typeof value === 'number' && Number.isFinite(value))) {
      throw new TypeError('Runtime event payload values must be JSON scalars');
    }
  }
  return Object.freeze(Object.fromEntries(entries));
}

/** Bounded chronological ring. Subscribers run only when the host flushes, outside guest dispatch. */
export class RuntimeEventLog {
  constructor({capacity = 4096, maxSubscribers = 128} = {}) {
    this.capacity = boundedInteger(capacity, 'event capacity', 1_000_000);
    this.maxSubscribers = boundedInteger(maxSubscribers, 'subscriber limit', 4096);
    this.buffer = new Array(this.capacity);
    this.sequence = 0;
    this.count = 0;
    this.dropped = 0;
    this.subscribers = new Set();
    this.flushing = false;
  }

  emit(name, payload, instruction) {
    if (!names.has(name)) throw new TypeError('Unknown runtime event: ' + name);
    if (!Number.isSafeInteger(instruction) || instruction < 0) throw new RangeError('Invalid event instruction count');
    if (this.sequence === Number.MAX_SAFE_INTEGER) throw new RangeError('Runtime event sequence exhausted');
    const copied = copyPayload(payload);
    const sequence = this.sequence + 1;
    const event = Object.freeze({provider: 'Microsoft-Windows-DotNETRuntime', name,
      sequence, instruction, payload: copied});
    this.sequence = sequence;
    this.buffer[(sequence - 1) % this.capacity] = event;
    if (this.count === this.capacity) this.dropped++;
    else this.count++;
    return event;
  }

  read({after = 0, limit = this.capacity} = {}) {
    if (!Number.isSafeInteger(after) || after < 0) throw new RangeError('Invalid event cursor');
    boundedInteger(limit, 'event read limit', this.capacity);
    const first = Math.max(after + 1, this.sequence - this.count + 1);
    const end = Math.min(this.sequence + 1, first + limit);
    const events = [];
    for (let sequence = first; sequence < end; sequence++) events.push(this.buffer[(sequence - 1) % this.capacity]);
    return events;
  }

  subscribe(callback, {replay = false, signal} = {}) {
    if (typeof callback !== 'function') throw new TypeError('A runtime event subscriber must be a function');
    if (typeof replay !== 'boolean') throw new TypeError('Event replay must be a boolean');
    signal?.throwIfAborted();
    if (this.subscribers.size >= this.maxSubscribers) throw new RangeError('Runtime event subscriber limit exceeded');
    const subscriber = {callback, cursor: replay ? 0 : this.sequence};
    const unsubscribe = () => {
      this.subscribers.delete(subscriber);
      signal?.removeEventListener('abort', unsubscribe);
    };
    this.subscribers.add(subscriber);
    signal?.addEventListener('abort', unsubscribe, {once: true});
    return unsubscribe;
  }

  /** Callback failures propagate to the host; they are never turned into managed exceptions. */
  flush() {
    if (this.flushing || this.subscribers.size === 0 || this.count === 0) return;
    let after = this.sequence;
    for (const subscriber of this.subscribers) {
      after = Math.min(after, subscriber.cursor);
    }
    if (after === this.sequence) return;
    this.flushing = true;
    try {
      // Keep only the unread retained suffix alive across callbacks. Copy it
      // before delivery so ring overwrites cannot change this flush boundary.
      // New subscriptions and callback emissions belong to the next flush.
      const events = this.read({after});
      const subscribers = [...this.subscribers];
      for (const subscriber of subscribers) {
        for (const event of events) {
          if (!this.subscribers.has(subscriber)) break;
          if (event.sequence <= subscriber.cursor) continue;
          subscriber.cursor = event.sequence;
          subscriber.callback(event);
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  /** One retained event window; sequence and dropped remain whole-log counters. */
  export(options) {
    return {format: 'SharpForge.RuntimeEvents/1', clock: 'instructions', sequence: this.sequence,
      dropped: this.dropped, events: this.read(options)};
  }
}
