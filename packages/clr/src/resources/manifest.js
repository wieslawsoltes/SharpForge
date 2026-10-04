import { readPE } from '@sharpforge/cil';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';
import { ManifestFiles } from './manifest-files.js';
import { indexManifestResources, linkedModuleResource, ManifestResourceLocation } from './manifest-index.js';
import { invalidManifest, manifestLimit, manifestOperation, manifestOptions, requireManifestNameBudget } from './manifest-options.js';

function sourceImage(assembly, pe, fileName = null) {
  return { assembly, pe, module: fileName ? null : assembly.manifestModule, fileName, index: null };
}

/** A disposable view over one assembly's resource manifest; all linked data remains explicit host-supplied input. */
export class ManifestResources {
  #primary;
  #options;
  #peers;
  #modules;
  #files;
  #sourceCount = 1;
  #characters = 0;
  constructor(assembly, pe, options = {}) {
    this.#options = manifestOptions(options);
    checkCancellation(options.signal);
    assembly.ensureUsable();
    this.#primary = sourceImage(assembly, pe);
    Object.freeze(this);
  }

  get isDisposed() { return this.#primary === null; }
  get names() { return this.getNames(); }

  #ensureUsable(signal) {
    if (this.isDisposed) throw loadError(LoadErrorCode.Disposed, 'Manifest resource reader is disposed');
    this.#primary.assembly.ensureUsable();
    checkCancellation(signal);
  }

  #index(source, signal) {
    this.#ensureUsable(signal);
    source.assembly.ensureUsable();
    if (!source.index) {
      const index = manifestOperation(() => indexManifestResources(source, this.#options,
        this.#options.maxMetadataCharacters - this.#characters, signal));
      checkCancellation(signal);
      source.index = index;
      this.#characters += index.characters;
    }
    return source.index;
  }

  /** Frozen manifest-row order. Enumeration does not load referenced assemblies or request external files. */
  getNames({ signal } = {}) { return this.#index(this.#primary, signal).names; }

  #name(name, signal) {
    this.#ensureUsable(signal);
    if (typeof name !== 'string' || !name || name.includes('\0')) {
      throw loadError(LoadErrorCode.InvalidConfiguration, 'Manifest resource name must be a nonempty string without NUL');
    }
    requireManifestNameBudget(name, this.#options.maxNameBytes);
  }

  #peer(assembly) {
    if (assembly === this.#primary.assembly) return this.#primary;
    this.#peers ??= new WeakMap();
    if (!this.#peers.has(assembly)) {
      if (this.#sourceCount >= this.#options.maxSources) throw manifestLimit('Manifest resource source limit exceeded');
      const peer = assembly.openManifestResources(this.#options);
      this.#peers.set(assembly, peer.#primary);
      this.#sourceCount++;
    }
    return this.#peers.get(assembly);
  }

  #module(entry, source) {
    this.#modules ??= new WeakMap();
    if (!this.#modules.has(entry)) {
      if (this.#sourceCount >= this.#options.maxSources) throw manifestLimit('Manifest resource source limit exceeded');
      const next = manifestOperation(() => {
        const pe = readPE(entry.bytes, { maxBytes: this.#options.maxFileBytes, inspection: true });
        if (pe.metadata.counts[32] || pe.metadata.counts[0] !== 1) {
          throw invalidManifest('Resource metadata file must be a netmodule with one Module row and no Assembly row');
        }
        return sourceImage(source.assembly, pe, entry.file.name);
      });
      this.#modules.set(entry, next);
      this.#sourceCount++;
    }
    return this.#modules.get(entry);
  }

  #result(source, resource, visited, signal, fileEntry = null) {
    this.#ensureUsable(signal);
    for (const prior of visited) prior.assembly.ensureUsable();
    const foreign = source.assembly !== this.#primary.assembly;
    const externalFile = resource.file && !resource.file.containsMetadata;
    const embedded = externalFile ? 0 : ManifestResourceLocation.Embedded;
    const manifest = embedded && !source.fileName ? ManifestResourceLocation.ContainedInManifestFile : 0;
    return { source, resource, fileEntry, visited, info: Object.freeze({
      fileName: externalFile ? resource.file.name : source.fileName,
      referencedAssembly: foreign ? source.assembly : null,
      resourceLocation: embedded | manifest | (foreign ? ManifestResourceLocation.ContainedInAnotherAssembly : 0),
      size: externalFile ? null : resource.size,
    }) };
  }

  #ensureResult(result, signal) {
    this.#ensureUsable(signal);
    if (result) for (const source of result.visited) source.assembly.ensureUsable();
  }

  async #resolve(name, signal, metadataOnly) {
    this.#name(name, signal);
    let source = this.#primary;
    const visited = new Set();
    const path = [];
    let hops = 0;
    for (;;) {
      this.#ensureUsable(signal);
      source.assembly.ensureUsable();
      const label = `${source.assembly.identity.name}/${source.module.scopeName}`;
      if (visited.has(source)) {
        throw loadError(LoadErrorCode.RecursiveResolution, `Manifest resource cycle for ${name}: ${[...path, label].join(' -> ')}`);
      }
      visited.add(source);
      path.push(label);
      const resource = this.#index(source, signal).records.get(name);
      if (!resource) return null;
      if (!resource.implementation) return this.#result(source, resource, visited, signal);
      if (hops++ >= this.#options.maxHops) throw manifestLimit(`Manifest resource hop limit exceeded for ${name}`);
      if (resource.file) {
        if (metadataOnly && !resource.file.containsMetadata) return this.#result(source, resource, visited, signal);
        this.#files ??= new ManifestFiles(this.#options, currentSignal => this.#ensureUsable(currentSignal));
        const entry = await this.#files.get(resource.file, signal);
        this.#ensureUsable(signal);
        if (!resource.file.containsMetadata) return this.#result(source, resource, visited, signal, entry);
        const module = this.#module(entry, source);
        const selected = manifestOperation(() => linkedModuleResource(module, resource, this.#options));
        visited.add(module);
        return this.#result(module, selected, visited, signal);
      } else {
        const assembly = await source.assembly.resolveReference(resource.implementation & 0xffffff, { signal });
        this.#ensureUsable(signal);
        source.assembly.ensureUsable();
        source = this.#peer(assembly);
      }
    }
  }

  /** Physical location with native flag values, or null. Pure data-file info needs no provider; linked module ranges are inspected lazily. */
  async getInfo(name, { signal } = {}) {
    const result = await this.#resolve(name, signal, true);
    this.#ensureResult(result, signal);
    return result?.info ?? null;
  }

  /** Owned stream-equivalent bytes, or null. Bytes are copied only after all range, hash, lifetime and operation budgets pass. */
  async read(name, { signal } = {}) {
    const result = await this.#resolve(name, signal, false);
    this.#ensureResult(result, signal);
    if (!result) return null;
    const size = result.fileEntry?.bytes.length ?? result.resource.size;
    if (size > this.#options.maxResourceBytes) throw manifestLimit(`Manifest resource ${name} exceeds the resource byte limit`);
    return result.fileEntry ? new Uint8Array(result.fileEntry.bytes)
      : result.source.pe.bytes.slice(result.resource.dataOffset, result.resource.dataOffset + size);
  }

  /** Release the reader's caches and callbacks; previously returned names, info records and byte snapshots retain their ownership. */
  dispose() {
    this.#files?.dispose();
    this.#files = null;
    this.#peers = null;
    this.#modules = null;
    this.#options = null;
    this.#primary = null;
  }
}
