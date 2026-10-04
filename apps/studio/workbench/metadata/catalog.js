import {cancellable, abortError} from '../events.js';
import {workerRequest} from '../worker-request.js';
import {frameworkMetadata} from './framework-model.js';
import {suppliedMetadata} from './legacy-summary.js';
import {findMetadataDefinition, metadataDefinition} from './definition.js';
import {metadataLimits, metadataError} from './limits.js';

/** Per-shell metadata cache. Worker jobs are serialized, cancellable, and invalidated by reference/source identity. */
export class MetadataCatalog {
  constructor({sources = async () => [], inspect, createWorker, timeoutMs = metadataLimits.timeoutMs} = {}) {
    this.sources = sources;
    this.createWorker = createWorker ?? (globalThis.Worker ? () => new Worker(
      new URL('./metadata.worker.js', import.meta.url), {type: 'module'}) : null);
    this.inspect = inspect ?? ((bytes, source, signal) => {
      if (!this.createWorker) throw metadataError('METADATA_WORKER_REQUIRED', 'PE metadata inspection requires an interruptible worker');
      return workerRequest({bytes, source}, {createWorker: this.createWorker, signal, timeoutMs});
    });
    this.cache = new Map();
    this.controllers = new Set();
    this.queue = Promise.resolve();
    this.framework = null;
    this.disposed = false;
  }

  frameworkModel() { return this.framework ??= frameworkMetadata(); }

  async assembly(descriptor, signal) {
    if (descriptor.error) throw descriptor.error;
    const key = descriptor.id + ':' + descriptor.version;
    const cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); return cached; }
    const source = {id: descriptor.id, path: descriptor.path, projectId: descriptor.projectId,
      version: descriptor.version, workspaceEpoch: descriptor.workspaceEpoch};
    const operation = this.queue.catch(() => {}).then(async () => {
      signal.throwIfAborted();
      if (this.disposed) throw abortError('Metadata catalog was closed');
      if (this.cache.has(key)) return this.cache.get(key);
      let model = descriptor.model;
      if (!model && descriptor.summary) model = suppliedMetadata(descriptor.summary, source);
      if (!model) {
        const bytes = await cancellable(descriptor.read({signal}), signal);
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > metadataLimits.bytes) {
          throw metadataError('METADATA_BYTES_LIMIT', 'Reference must contain at most ' + metadataLimits.bytes + ' PE bytes');
        }
        model = await this.inspect(bytes, source, signal);
      }
      signal.throwIfAborted();
      if (this.disposed) throw abortError('Metadata catalog was closed');
      model = {...model, source};
      if (!Array.isArray(model.types) || !Number.isSafeInteger(model.symbols) || model.symbols < 0 || model.symbols > metadataLimits.symbols) {
        throw metadataError('METADATA_PROVIDER_RESULT', 'Metadata provider returned an invalid or oversized declaration model');
      }
      for (const [previous, value] of this.cache) if (value.source.id === descriptor.id) this.cache.delete(previous);
      this.cache.set(key, model);
      let count = [...this.cache.values()].reduce((sum, value) => sum + value.symbols, 0);
      while (count > metadataLimits.cachedSymbols || this.cache.size > metadataLimits.assemblies) {
        const oldest = this.cache.keys().next().value;
        count -= this.cache.get(oldest).symbols;
        this.cache.delete(oldest);
      }
      return model;
    });
    this.queue = operation.catch(() => {});
    return cancellable(operation, signal);
  }

  async load({projectId, signal} = {}) {
    if (this.disposed) throw abortError('Metadata catalog was closed');
    signal?.throwIfAborted();
    if (this.controllers.size >= 8) throw metadataError('METADATA_REQUEST_LIMIT', 'Too many pending metadata requests');
    const controller = new AbortController(), abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, {once: true});
    this.controllers.add(controller);
    try {
      const assemblies = [await this.frameworkModel()], diagnostics = [];
      controller.signal.throwIfAborted();
      const descriptors = await cancellable(this.sources(), controller.signal);
      if (!Array.isArray(descriptors) || descriptors.length > metadataLimits.sources) {
        throw metadataError('METADATA_ASSEMBLY_LIMIT', 'Metadata source provider exceeded its reference limit');
      }
      const keys = new Set(descriptors.map(descriptor => descriptor.id + ':' + descriptor.version));
      for (const key of this.cache.keys()) if (!keys.has(key)) this.cache.delete(key);
      let count = assemblies[0].symbols;
      for (const descriptor of descriptors) {
        if (projectId && descriptor.projectId && descriptor.projectId !== projectId && !descriptor.consumers?.includes(projectId)) continue;
        try {
          if (assemblies.length > metadataLimits.assemblies) throw metadataError('METADATA_ASSEMBLY_LIMIT',
            'Select a project with at most ' + metadataLimits.assemblies + ' referenced metadata sources');
          const model = await this.assembly(descriptor, controller.signal);
          if (count + model.symbols > metadataLimits.cachedSymbols) throw metadataError('METADATA_SYMBOL_LIMIT',
            'The selected references exceed the ' + metadataLimits.cachedSymbols + ' declaration limit');
          assemblies.push(model);
          count += model.symbols;
        }
        catch (error) {
          if (error.name === 'AbortError') throw error;
          diagnostics.push({code: error.code ?? 'METADATA_INVALID', message: error.message, source: descriptor});
        }
      }
      return {assemblies, diagnostics};
    } finally {
      signal?.removeEventListener('abort', abort);
      this.controllers.delete(controller);
    }
  }

  async definition(query, options = {}) {
    if (this.disposed) throw abortError('Metadata catalog was closed');
    const framework = await this.frameworkModel();
    if (this.disposed) throw abortError('Metadata catalog was closed');
    options.signal?.throwIfAborted();
    const registered = findMetadataDefinition([framework], query);
    if (registered) return metadataDefinition(registered, options);
    const {assemblies, diagnostics} = await this.load(options);
    const match = findMetadataDefinition(assemblies, query);
    if (!match && diagnostics.length) throw metadataError('METADATA_REFERENCE_UNAVAILABLE', diagnostics.map(item => item.message).join('\n'));
    return metadataDefinition(match, options);
  }

  dispose() {
    this.disposed = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.cache.clear();
    this.framework = null;
  }
}
