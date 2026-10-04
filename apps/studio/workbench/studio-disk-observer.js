import {readStudioSource} from './studio-source-reader.js';
import {AUTOMATIC_DOCUMENT_CHARACTERS as MAXIMUM_CHARACTERS, documentSize} from './document-size.js';
import {workbenchError} from './state-events.js';

const MAXIMUM_BYTES = MAXIMUM_CHARACTERS * 3 + 3;
const ENCODINGS = new Set(['utf-8', 'utf-16le', 'utf-16be']);

function stale() {
  return workbenchError('STUDIO_DISK_OBSERVATION_STALE', 'The document, disk contents, or save target changed after this observation');
}

function checkCancellation(signal) {
  if (signal.aborted) throw new DOMException('Disk observation cancelled', 'AbortError');
}

function validateText(text) {
  if (typeof text !== 'string') throw new TypeError('A disk observation must contain source text');
  if (text.length > MAXIMUM_CHARACTERS) throw new RangeError('Disk observation exceeds the 8,000,000-character watch limit');
}

function acceptNativeMetadata(record, observed) {
  const next = {};
  for (const [name, value] of [['nativeHash', observed.hash], ['nativeBaseline', observed.text]]) {
    const descriptor = Object.getOwnPropertyDescriptor(record, name);
    if (!descriptor && !Object.isExtensible(record) || descriptor && !descriptor.configurable
      && (!('value' in descriptor) || !descriptor.writable && descriptor.value !== value)) {
      throw new TypeError('Native reload baseline metadata is immutable: ' + name);
    }
    next[name] = descriptor && !descriptor.configurable ? {...descriptor, value}
      : {value, writable: true, configurable: true, enumerable: true};
  }
  Object.defineProperties(record, next);
}

/** Observations are owned by exact document and save-target instances; temporary decoder models never transfer ownership. */
export function createStudioDiskObserver(options) { return new StudioDiskObserver(options); }

class StudioDiskObserver {
  #observations = new WeakMap();
  #targets = new WeakMap();
  #operations = new Set();
  #disposed = false;

  constructor({documents, state, nativeBuild, target, confirm}) {
    if (!documents || typeof state !== 'function' || typeof nativeBuild !== 'function' || typeof target !== 'function') {
      throw new TypeError('Disk observation requires documents and explicit state, native-client, and target providers');
    }
    Object.assign(this, {documents, state, nativeBuild, target, confirm});
  }

  begin(signal) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (this.#disposed || signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, {once: true});
    const operation = {controller, signal: controller.signal,
      finish: () => {
        signal?.removeEventListener('abort', cancel);
        this.#operations.delete(operation);
      }};
    this.#operations.add(operation);
    return operation;
  }

  capture(uri) {
    const record = this.documents.get(uri);
    if (!record || this.documents.disposed || this.#disposed) return null;
    const size = documentSize(this.documents, record);
    if (size === null || size > MAXIMUM_CHARACTERS) {
      throw new RangeError('Document exceeds the automatic disk observation limit or lacks size metadata');
    }
    const captured = {uri, record, version: record.version, native: Boolean(this.state().nativeMode)};
    if (captured.native) {
      captured.client = this.nativeBuild()?.client;
      captured.savedHash = record.nativeHash;
      return captured.client ? captured : null;
    }
    captured.disk = this.target(uri);
    captured.handle = captured.disk?.handles.get(uri);
    captured.diskVersion = captured.disk?.getVersion(uri);
    captured.encoding = captured.disk?.byPath.get(uri)?.encoding;
    return captured.handle ? captured : null;
  }

  current(captured, {version = true} = {}) {
    if (this.#disposed || this.documents.disposed || this.documents.get(captured.uri) !== captured.record
      || Boolean(this.state().nativeMode) !== captured.native
      || version && captured.record.version !== captured.version) return false;
    if (captured.native) return this.nativeBuild()?.client === captured.client && captured.record.nativeHash === captured.savedHash;
    return this.target(captured.uri) === captured.disk && captured.disk.handles.get(captured.uri) === captured.handle
      && captured.disk.getVersion(captured.uri) === captured.diskVersion;
  }

  check(captured, signal, options) {
    checkCancellation(signal);
    if (!this.current(captured, options)) throw stale();
  }

  async readBrowser(captured, signal) {
    const file = await captured.handle.getFile();
    this.check(captured, signal);
    const maximum = Math.min(MAXIMUM_BYTES, captured.disk.limits.maxFileBytes, captured.disk.limits.maxAssemblyBytes);
    if (file.size > maximum) throw new RangeError('Disk observation exceeds its encoded byte limit');
    let prepared;
    try {
      prepared = await readStudioSource(file, {path: captured.uri, encoding: captured.encoding, signal,
        limits: {...captured.disk.limits, maxFileBytes: maximum}, maxCharacters: MAXIMUM_CHARACTERS});
      this.check(captured, signal);
      const source = prepared.source;
      const text = source.getText(0, source.length);
      validateText(text);
      return {text, source, encoding: prepared.encoding, bom: prepared.bom, byteLength: prepared.byteLength};
    } finally { prepared?.model.dispose(); }
  }

  async readNative(captured, signal) {
    const value = await captured.client.read(captured.uri, {signal});
    this.check(captured, signal);
    validateText(value?.text);
    if (value.path !== captured.uri || !/^[a-f0-9]{64}$/.test(value.hash ?? '') || !ENCODINGS.has(value.encoding)
      || typeof value.bom !== 'boolean' || !Number.isSafeInteger(value.size) || value.size < 0 || value.size > MAXIMUM_BYTES) {
      throw new TypeError('The native host returned an invalid disk observation');
    }
    return {text: value.text, hash: value.hash, encoding: value.encoding, bom: value.bom, byteLength: value.size};
  }

  targetIdentity(captured) {
    const owner = captured.native ? captured.client : captured.disk;
    const handle = captured.native ? captured.client : captured.handle;
    let handles = this.#targets.get(owner);
    if (!handles) this.#targets.set(owner, handles = new WeakMap());
    let identity = handles.get(handle);
    if (!identity) handles.set(handle, identity = Object.freeze({}));
    return identity;
  }

  /** Bounded reads return text/encoding metadata plus an opaque token required by reload; stale reads return null. */
  async read(uri, {signal} = {}) {
    const operation = this.begin(signal);
    try {
      checkCancellation(operation.signal);
      const captured = this.capture(uri);
      if (!captured) return null;
      const observed = captured.native ? await this.readNative(captured, operation.signal)
        : await this.readBrowser(captured, operation.signal);
      this.check(captured, operation.signal);
      const observation = Object.freeze({});
      this.#observations.set(observation, {...captured, ...observed});
      return Object.freeze({text: observed.text, encoding: observed.encoding, bom: observed.bom,
        byteLength: observed.byteLength, target: this.targetIdentity(captured), observation,
        isCurrent: () => this.current(captured)});
    } catch (error) {
      if (error.code === 'STUDIO_DISK_OBSERVATION_STALE') return null;
      throw error;
    } finally { operation.finish(); }
  }

  validateReload(uri, text, options) {
    const observed = this.#observations.get(options.observation);
    if (!observed || observed.uri !== uri || observed.text !== text || options.expectedRecord !== observed.record
      || options.expectedVersion !== observed.version) throw stale();
    validateText(text);
    return observed;
  }

  commitDocument(observed, accept, signal) {
    this.check(observed, signal);
    return this.documents.reload(observed.uri, observed.text, {
      expectedRecord: observed.record, expectedVersion: observed.version,
      encoding: observed.encoding, bom: observed.bom, byteLength: observed.byteLength,
      commitMetadata: () => {
        this.check(observed, signal, {version: false});
        accept?.();
        if (observed.native) acceptNativeMetadata(observed.record, observed);
      }
    });
  }

  async acceptBrowser(observed, signal) {
    let committing = false;
    await observed.disk.acceptBaseline(observed.uri, observed, {
      expectedVersion: observed.diskVersion, expectedHandle: observed.handle, signal,
      check: () => this.check(observed, signal, {version: !committing}),
      commit: accept => {
        this.check(observed, signal);
        committing = true;
        return this.commitDocument(observed, accept, signal);
      }
    });
  }

  async acceptNative(observed, signal) {
    const current = await this.readNative(observed, signal);
    if (current.hash !== observed.hash || current.text !== observed.text || current.encoding !== observed.encoding
      || current.bom !== observed.bom || current.byteLength !== observed.byteLength) throw stale();
    this.check(observed, signal);
    this.commitDocument(observed, null, signal);
  }

  /** Confirm and revalidate the captured version, then commit the existing shared document and its actual disk baseline. */
  async reload(uri, text, options = {}) {
    const operation = this.begin(options.signal);
    let observed;
    try {
      checkCancellation(operation.signal);
      observed = this.validateReload(uri, text, options);
      this.check(observed, operation.signal);
      if (options.confirmDirty && observed.record.dirty) {
        if (typeof this.confirm !== 'function') throw workbenchError('STUDIO_DISK_CONFIRM_UNAVAILABLE', 'Reload requires a confirmation provider');
        const accepted = await this.confirm('Discard editor changes in ' + uri + ' and reload from disk?');
        this.check(observed, operation.signal);
        if (!accepted) return false;
      }
      if (observed.native) await this.acceptNative(observed, operation.signal);
      else await this.acceptBrowser(observed, operation.signal);
      this.#observations.delete(options.observation);
      return true;
    } catch (error) {
      if (error.committed) this.#observations.delete(options.observation);
      throw error;
    } finally { operation.finish(); }
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const operation of this.#operations) operation.controller.abort();
    this.#operations.clear();
    this.#observations = new WeakMap();
    this.#targets = new WeakMap();
  }
}
