import { eventStroke, normalizeSequence } from './platform.js';
import { compileWhen } from './when.js';

const samePrefix = (left, right) => left.every((key, index) => right[index] === key);
const overlap = (left, right) => left === right || left === 'Global' || right === 'Global';

function preferredExact(entries, length) {
  const exact = entries.findIndex(binding => binding.keys.length === length);
  const prefix = entries.findIndex(binding => binding.keys.length > length);
  return exact >= 0 && (prefix < 0 || exact < prefix) ? entries[exact] : null;
}

/** Per-workbench keybinding resolver. Registration preindexes prefixes; key handling scans only matching candidates. */
export class KeybindingService {
  constructor({ execute, context = () => ({}), onStatus = () => {}, onError, platform = 'windows', clock, timeout = 1500 } = {}) {
    if (typeof execute !== 'function') throw new TypeError('KeybindingService requires an execute callback');
    if (!Number.isFinite(timeout) || timeout < 100 || timeout > 10000) throw new RangeError('Invalid chord timeout');
    this.execute = execute;
    this.context = context;
    this.onStatus = onStatus;
    this.onError = onError ?? (error => onStatus(error.message));
    this.platform = platform;
    this.clock = clock ?? { setTimeout, clearTimeout };
    this.timeout = timeout;
    this.bindings = new Map();
    this.prefixes = new Map();
    this.filters = new Set();
    this.sequence = 0;
    this.pending = null;
    this.disposed = false;
  }

  register(binding) {
    if (this.disposed) throw new Error('KeybindingService is disposed');
    if (!binding || typeof binding.command !== 'string' || !binding.command) throw new TypeError('A binding requires a command');
    if (this.bindings.size >= 4096) throw new RangeError('Keybinding limit exceeded');
    const id = binding.id ?? `${binding.command}:${++this.sequence}`;
    if (this.bindings.has(id)) throw new Error(`Duplicate binding '${id}'`);
    const entry = Object.freeze({
      ...binding, id, keys: Object.freeze(normalizeSequence(binding.keys, this.platform)),
      scope: binding.scope ?? 'Text Editor', priority: binding.priority ?? 0,
      ordinal: this.sequence++, predicate: compileWhen(binding.when)
    });
    this.bindings.set(id, entry);
    for (let length = 1; length <= entry.keys.length; length++) {
      const prefix = entry.keys.slice(0, length).join(' ');
      if (!this.prefixes.has(prefix)) this.prefixes.set(prefix, new Set());
      this.prefixes.get(prefix).add(entry);
    }
    return () => this.remove(id);
  }

  remove(id) {
    const entry = this.bindings.get(id);
    if (!entry) return false;
    this.bindings.delete(id);
    for (let length = 1; length <= entry.keys.length; length++) {
      const prefix = entry.keys.slice(0, length).join(' ');
      const entries = this.prefixes.get(prefix);
      entries.delete(entry);
      if (!entries.size) this.prefixes.delete(prefix);
    }
    this.cancel();
    return true;
  }

  /** Hosts can remove a binding from resolution without intercepting other chords sharing its prefix. */
  addFilter(predicate) {
    if (this.disposed) throw new Error('KeybindingService is disposed');
    if (typeof predicate !== 'function') throw new TypeError('A keybinding filter must be a function');
    if (this.filters.size >= 32) throw new RangeError('Keybinding filter limit exceeded');
    this.filters.add(predicate);
    this.cancel();
    return () => { this.filters.delete(predicate); this.cancel(); };
  }

  allows(binding, context) {
    for (const predicate of this.filters) if (!predicate(binding, context)) return false;
    return true;
  }

  setBindings(bindings) {
    if (this.disposed) throw new Error('KeybindingService is disposed');
    if (!Array.isArray(bindings)) throw new TypeError('Bindings must be an array');
    const next = new KeybindingService({
      execute: this.execute, context: this.context, onStatus: this.onStatus,
      onError: this.onError, platform: this.platform, clock: this.clock, timeout: this.timeout
    });
    for (const binding of bindings) next.register(binding);
    this.cancel();
    this.bindings = next.bindings;
    this.prefixes = next.prefixes;
    this.sequence = next.sequence;
  }

  candidates(keys, { scope = 'Text Editor', context = this.readContext() } = {}) {
    const values = this.prefixes.get(keys.join(' '));
    if (!values) return [];
    return [...values].filter(binding => (binding.scope === 'Global' || binding.scope === scope)
      && binding.predicate(context) && this.allows(binding, context))
      .sort((left, right) => right.priority - left.priority ||
        Number(right.scope === scope) - Number(left.scope === scope) || right.ordinal - left.ordinal);
  }

  readContext() { return typeof this.context === 'function' ? this.context() : this.context; }

  resolve(keys, options = {}) {
    const sequence = normalizeSequence(keys, this.platform);
    const entries = this.candidates(sequence, options);
    const exact = preferredExact(entries, sequence.length);
    return { binding: exact ?? null, isPrefix: entries.some(binding => binding.keys.length > sequence.length), candidates: entries };
  }

  handle(event, options = {}) {
    if (this.disposed || event.defaultPrevented) return false;
    const stroke = eventStroke(event, this.platform);
    if (!stroke) return false;
    if (stroke === 'Escape' && this.pending) {
      this.cancel('Key sequence cancelled');
      event.preventDefault();
      event.stopPropagation?.();
      return true;
    }
    const keys = [...(this.pending?.keys ?? []), stroke];
    const entries = this.candidates(keys, options);
    const exact = preferredExact(entries, keys.length);
    const isPrefix = entries.some(binding => binding.keys.length > keys.length);
    const hadPending = !!this.pending;
    this.cancel();
    if (!entries.length) {
      if (hadPending) {
        this.onStatus(`The key sequence ${keys.join(', ')} is not assigned`);
        event.preventDefault();
        event.stopPropagation?.();
      }
      return hadPending;
    }
    event.preventDefault();
    event.stopPropagation?.();
    if (exact && (!isPrefix || !exact.deferForChord)) {
      this.invoke(exact, event);
    } else {
      const timer = this.clock.setTimeout(() => {
        this.pending = null;
        if (exact) this.invoke(exact, event);
        else this.onStatus(`The key sequence ${keys.join(', ')} timed out`);
      }, this.timeout);
      this.pending = { keys, timer };
      this.onStatus(`${keys.join(', ')} …`);
    }
    return true;
  }

  invoke(binding, event) {
    try {
      const result = this.execute(binding.command, binding.args, { binding, event });
      if (result?.then) result.catch(this.onError);
    } catch (error) { this.onError(error); }
  }

  cancel(message) {
    if (this.pending) this.clock.clearTimeout(this.pending.timer);
    this.pending = null;
    if (message) this.onStatus(message);
  }

  list() { return [...this.bindings.values()].map(({ predicate, ordinal, ...binding }) => binding); }
  bindingsFor(command) { return this.list().filter(binding => binding.command === command); }
  commandsFor(keys) {
    const sequence = normalizeSequence(keys, this.platform);
    return this.list().filter(binding => samePrefix(sequence, binding.keys) && sequence.length === binding.keys.length);
  }
  conflicts(candidate) {
    const sources = candidate ? [{ ...candidate, keys: normalizeSequence(candidate.keys, this.platform) }] : this.list();
    const result = [];
    const seen = new Set();
    for (const left of sources) for (const right of this.bindings.values()) {
      if (left.id === right.id || !overlap(left.scope ?? 'Text Editor', right.scope)) continue;
      if (!samePrefix(left.keys, right.keys) && !samePrefix(right.keys, left.keys)) continue;
      const key = [left.id ?? left.command, right.id].sort().join('\0');
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ left, right, kind: left.keys.length === right.keys.length ? 'exact' : 'prefix',
        shadowing: (left.scope ?? 'Text Editor') !== right.scope });
    }
    return result;
  }
  dispose() { this.cancel(); this.bindings.clear(); this.prefixes.clear(); this.filters.clear(); this.disposed = true; }
}
