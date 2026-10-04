import { loadError, LoadErrorCode } from '../load-errors.js';
import { verifyManifestFile } from './file-hash.js';
import { manifestFileBytes, manifestLimit, manifestOperation, sameBytes } from './manifest-options.js';

function sameDeclaration(left, right) {
  return left.containsMetadata === right.containsMetadata && left.hashAlgorithm === right.hashAlgorithm &&
    sameBytes(left.hashValue, right.hashValue);
}

/** Per-reader pinned snapshots. Pending work and owned bytes are bounded; provider/hash failures never cache. */
export class ManifestFiles {
  #options;
  #ensureUsable;
  #files = new WeakMap();
  #count = 0;
  #bytes = 0;
  #reservedBytes = 0;
  #pending = 0;
  constructor(options, ensureUsable) {
    this.#options = options;
    this.#ensureUsable = ensureUsable;
  }

  #existing(file) {
    const entry = this.#files.get(file.assembly)?.get(file.name);
    if (entry && !sameDeclaration(file, entry.file)) {
      throw loadError(LoadErrorCode.FileLoad, `Conflicting manifest declarations for file ${file.name}`);
    }
    return entry;
  }

  async #request(file, signal) {
    const request = Object.freeze({ assembly: file.assembly, name: file.name, metadataToken: file.metadataToken,
      containsMetadata: file.containsMetadata, hashAlgorithm: file.hashAlgorithm,
      hashValue: new Uint8Array(file.hashValue), maxBytes: this.#options.maxFileBytes, signal });
    try { return await this.#options.fileProvider(request); }
    catch (error) {
      this.#ensureUsable(signal);
      if (typeof error?.code === 'string' && error.code.startsWith('SFCLR')) throw error;
      throw loadError(LoadErrorCode.FileLoad, `Resource file provider failed for ${file.name}: ${error?.message ?? String(error)}`,
        { requester: file.assembly.fullName });
    }
  }

  async get(file, signal) {
    this.#ensureUsable(signal);
    file.assembly.ensureUsable();
    const existing = this.#existing(file);
    if (existing) return existing;
    if (!this.#options.fileProvider) throw loadError(LoadErrorCode.MissingFile, `No provider for manifest file ${file.name}`);
    if (this.#pending >= this.#options.maxPendingFiles) throw manifestLimit('Pending manifest file request limit exceeded');
    if (this.#count >= this.#options.maxFiles) throw manifestLimit('Manifest file cache count limit exceeded');
    this.#pending++;
    let reserved = 0;
    try {
      const result = await this.#request(file, signal);
      this.#ensureUsable(signal);
      file.assembly.ensureUsable();
      if (result === null || result === undefined) throw loadError(LoadErrorCode.MissingFile, `Manifest file ${file.name} was not found`);
      const input = manifestOperation(() => manifestFileBytes(result));
      if (input.length > this.#options.maxFileBytes) throw manifestLimit('Manifest file byte limit exceeded');
      if (!file.containsMetadata && input.length > this.#options.maxResourceBytes) throw manifestLimit('Manifest resource byte limit exceeded');
      if (input.length + this.#bytes + this.#reservedBytes > this.#options.maxCachedFileBytes) {
        throw manifestLimit('Manifest file cache byte budget exceeded');
      }
      reserved = input.length;
      this.#reservedBytes += reserved;
      const bytes = manifestOperation(() => new Uint8Array(input.bytes));
      await verifyManifestFile(file, bytes, signal);
      this.#ensureUsable(signal);
      file.assembly.ensureUsable();
      const winner = this.#existing(file);
      if (winner) {
        if (!sameBytes(bytes, winner.bytes)) throw loadError(LoadErrorCode.FileLoad, `Manifest file ${file.name} changed during concurrent reads`);
        return winner;
      }
      if (this.#count >= this.#options.maxFiles) throw manifestLimit('Manifest file cache count limit exceeded');
      const entry = Object.freeze({ file, bytes });
      if (!this.#files.has(file.assembly)) this.#files.set(file.assembly, new Map());
      this.#files.get(file.assembly).set(file.name, entry);
      this.#count++;
      this.#bytes += bytes.length;
      return entry;
    } finally {
      this.#pending--;
      this.#reservedBytes -= reserved;
    }
  }

  dispose() {
    this.#files = new WeakMap();
    // In-flight callers still unwind their own reservations; dispose must not reset those counters underneath them.
    this.#bytes = 0;
    this.#count = 0;
    this.#options = null;
  }
}
