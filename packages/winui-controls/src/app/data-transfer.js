import { ControlError } from '../policy/events.js';

const supportedFormats = new Set(['Text', 'Html', 'Uri']);

export class DataPackage {
  #values = new Map();
  #externalFormats = [];
  #requestedOperation = 0;
  constructor({ maximumBytes = 8 * 1024 * 1024, externalFormats = [] } = {}) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > 64 * 1024 * 1024) {
      throw new ControlError('SFUI1691', 'Invalid data-package byte budget');
    }
    this.maximumBytes = maximumBytes;
    this.bytes = 0;
    this.setExternalFormats(externalFormats);
  }
  get RequestedOperation() { return this.#requestedOperation; }
  set RequestedOperation(value) {
    if (!Number.isInteger(value) || value < 0 || value > 7) throw new ControlError('SFUI1690', 'Invalid data-package operation mask');
    this.#requestedOperation = value;
    this.onChanged?.(this.snapshot());
  }
  set(format, value) {
    if (!supportedFormats.has(format)) throw new ControlError('SFUI1690', 'Unsupported data-package format', { format });
    if (typeof value !== 'string') throw new ControlError('SFUI1691', 'Data-package values must be strings');
    const bytes = this.bytes - (this.#values.get(format)?.length ?? 0) * 2 + value.length * 2;
    if (bytes > this.maximumBytes) throw new ControlError('SFUI1691', 'Data-package value is too large');
    this.#values.set(format, value);
    this.bytes = bytes;
    this.onChanged?.(this.snapshot());
  }
  get(format) { return this.#values.get(format) ?? ''; }
  contains(format) { return this.#values.has(format) || this.#externalFormats.includes(format); }
  get availableFormats() { return [...this.#values.keys(), ...this.#externalFormats]; }
  get externalFormats() { return [...this.#externalFormats]; }
  setExternalFormats(values) {
    if (!Array.isArray(values) || values.some(value => value !== 'StorageItems')) {
      throw new ControlError('SFUI1690', 'Unknown opaque data-package format');
    }
    this.#externalFormats = [...new Set(values)];
    this.onChanged?.(this.snapshot());
  }
  setText(value) { this.set('Text', value); }
  setHtml(value) { this.set('Html', value); }
  setUri(value) { this.set('Uri', value); }
  snapshot() { return { version: 1, values: [...this.#values], requestedOperation: this.RequestedOperation,
    externalFormats: [...this.#externalFormats] }; }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new ControlError('SFUI1691', 'Invalid data package snapshot');
    if (!Number.isInteger(snapshot.requestedOperation) || snapshot.requestedOperation < 0 || snapshot.requestedOperation > 7) {
      throw new ControlError('SFUI1690', 'Invalid data-package operation mask');
    }
    const restored = new DataPackage({ maximumBytes: this.maximumBytes, externalFormats: snapshot.externalFormats ?? [] });
    for (const [format, value] of snapshot.values) restored.set(format, value);
    this.#values = restored.#values;
    this.bytes = restored.bytes;
    this.#externalFormats = restored.#externalFormats;
    this.#requestedOperation = snapshot.requestedOperation;
  }
}

/** Permission failures return explicit results; the browser clipboard is never silently replaced by a process-global buffer. */
export class ClipboardService {
  constructor({ policy, clipboard, ClipboardItem = globalThis.ClipboardItem, Blob = globalThis.Blob } = {}) {
    this.policy = policy;
    this.clipboard = clipboard;
    this.ClipboardItem = ClipboardItem;
    this.Blob = Blob;
  }
  get available() { return !!this.clipboard; }
  async setContent(data, { signal } = {}) {
    if (!(data instanceof DataPackage)) throw new TypeError('Clipboard content must be a DataPackage');
    if (data.externalFormats.length) return { ok: false, reason: 'unsupported-format' };
    if (!await this.policy.authorize('clipboard-write', {}, { signal })) return { ok: false, reason: 'permission-denied' };
    if (!this.clipboard) return { ok: false, reason: 'platform-unavailable' };
    try {
      if (data.availableFormats.some(format => format !== 'Text')) {
        if (!this.clipboard.write || !this.ClipboardItem || !this.Blob) return { ok: false, reason: 'rich-clipboard-unavailable' };
        const values = {};
        for (const [format, mime] of [['Text', 'text/plain'], ['Html', 'text/html'], ['Uri', 'text/uri-list']]) {
          if (data.contains(format)) values[mime] = new this.Blob([data.get(format)], { type: mime });
        }
        await this.clipboard.write([new this.ClipboardItem(values)]);
      } else await this.clipboard.writeText(data.get('Text'));
      signal?.throwIfAborted();
      return { ok: true };
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      return { ok: false, reason: error.name === 'NotAllowedError' ? 'permission-denied' : 'clipboard-failed' };
    }
  }
  async getContent({ signal } = {}) {
    if (!await this.policy.authorize('clipboard-read', {}, { signal })) return { ok: false, reason: 'permission-denied', data: null };
    if (!this.clipboard) return { ok: false, reason: 'platform-unavailable', data: null };
    try {
      const data = new DataPackage();
      if (this.clipboard.read) {
        const items = await this.clipboard.read();
        for (const item of items) for (const [format, mime] of [['Text', 'text/plain'], ['Html', 'text/html'], ['Uri', 'text/uri-list']]) {
          if (item.types.includes(mime)) data.set(format, await (await item.getType(mime)).text());
        }
      } else data.setText(await this.clipboard.readText());
      signal?.throwIfAborted();
      return { ok: true, data };
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      return { ok: false, reason: error.name === 'NotAllowedError' ? 'permission-denied' : 'clipboard-failed', data: null };
    }
  }
}

export class LauncherService {
  constructor({ policy, open } = {}) { this.policy = policy; this.open = open; }
  async launchUri(value, { signal } = {}) {
    let uri;
    try { uri = this.policy.url(value, { capability: 'launch-uri' }); }
    catch (error) { if (error instanceof ControlError) return false; throw error; }
    if (!await this.policy.authorize('launch-uri', { origin: new URL(uri).origin }, { signal })) return false;
    if (!this.open) return false;
    const result = await this.open(uri, { signal, target: '_blank', features: 'noopener,noreferrer' });
    signal?.throwIfAborted();
    return result !== false && result !== null;
  }
}
