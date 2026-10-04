import {SourceText, BoundedCache} from '@sharpforge/text';
import {documentSyntax} from './syntax-cache.js';
import {compileWorkspace} from './compilation.js';

/** Versioned source documents. Per-URI revision watermarks survive imports and document removal. */
export class Workspace {
  constructor(options = {}) {
    const {maxDocumentLength = 2_000_000, maxDocuments = Infinity, maxWorkspaceBytes = 64 * 1024 * 1024, tokenCacheSize = 32768,
      extensions = null, extensionOptions = {}, additionalFiles = [], compilationOptions = {}, documentStore = null} = options;
    Object.assign(this, {maxDocumentLength, maxDocuments, maxWorkspaceBytes, extensions, extensionOptions, additionalFiles, documentStore});
    this.compilationOptions = {...compilationOptions};
    this.generatedDocuments = new Map();
    this.documents = new Map();
    this.versions = new Map();
    this.tokenCache = new BoundedCache(tokenCacheSize);
    this.revision = 0;
    this.result = null;
    this.metrics = {parsedDocuments: 0, syntaxCacheHits: 0, compilationCacheHits: 0};
    this.loadedDocumentBytes = 0;
    this.unsubscribeEviction = documentStore?.subscribeEviction(uri => this.remove(uri));
  }

  validate(uri, text) {
    if (typeof uri === 'string' && uri.startsWith('generated://')) throw new Error('Generated documents are read-only');
    if (typeof uri !== 'string' || !uri || typeof text !== 'string') throw new TypeError('A URI and source string are required');
    if (text.length > this.maxDocumentLength) throw new RangeError('Document exceeds the source size limit');
  }

  update(uri, text, version, {fromStore = false} = {}) {
    this.validate(uri, text);
    const old = this.documents.get(uri);
    const previous = Math.max(this.versions.get(uri) ?? 0, old?.source.version ?? 0);
    version ??= previous + 1;
    if (!Number.isSafeInteger(version) || version < 1) throw new RangeError('Document version must be a positive safe integer');
    if (version <= previous) return false;
    if (!old && this.documents.size >= this.maxDocuments) throw new RangeError('Workspace document limit exceeded');
    const admittedBytes = this.loadedDocumentBytes - (old?.source.text.length ?? 0) * 2 + text.length * 2;
    if (admittedBytes > this.maxWorkspaceBytes) throw new RangeError('Workspace loaded document byte budget exceeded');
    if (!fromStore && this.documentStore?.loaded.has(uri)) this.documentStore.update(uri, text);
    this.loadedDocumentBytes -= (this.documents.get(uri)?.source.text.length ?? 0) * 2;
    this.documents.set(uri, {source: new SourceText(text, uri, version), parsed: null});
    this.loadedDocumentBytes += text.length * 2;
    this.versions.set(uri, version);
    this.revision++;
    this.result = null;
    return true;
  }

  change(uri, changes, version) {
    let source = this.documents.get(uri)?.source;
    if (!source) throw new Error('Document is not open');
    if (version <= source.version) return false;
    if (!Array.isArray(changes)) throw new TypeError('Document changes must be an array');
    for (const change of changes) {
      if (change.range) {
        const start = source.offsetAt(change.range.start);
        const end = source.offsetAt(change.range.end);
        source = source.withChange(start, end - start, change.text);
      } else source = new SourceText(change.text, uri, version);
    }
    return this.update(uri, source.text, version);
  }

  remove(uri) {
    const size = (this.documents.get(uri)?.source.text.length ?? 0) * 2;
    if (this.documents.delete(uri)) {
      this.loadedDocumentBytes -= size;
      this.revision++;
      this.result = null;
    }
  }

  /** Read syntax using configured or explicitly supplied compilation settings. */
  syntax(uri, options = this.compilationOptions) { return documentSyntax(this, uri, options); }

  compile(options = {}) { return compileWorkspace(this, options); }

  /** Semantic source queries share the current compilation and its options. */
  sourceModel(options = {}) {
    this.compile(options);
    return this.documents.size ? this.compilation.getSourceModel() : null;
  }

  /** Register physical metadata without loading its contents or admitting a SourceText. */
  registerFile(record) {
    if (!this.documentStore) throw new Error('Workspace has no lazy document store');
    return this.documentStore.register(record);
  }

  /** Open one document from its provider under the store's byte budget. Binaries remain available as records. */
  async openFile(uri, options = {}) {
    if (!this.documentStore) throw new Error('Workspace has no lazy document store');
    const record = await this.documentStore.load(uri, {...options, pin: options.pin ?? true});
    if (typeof record.text === 'string' && !this.documents.has(uri)) this.update(uri, record.text, undefined, {fromStore: true});
    return record;
  }

  /** Dirty buffers are retained unless discard was explicitly requested. */
  closeFile(uri, {discard = false} = {}) {
    if (!this.documentStore) { this.remove(uri); return true; }
    this.documentStore.pin(uri, false);
    const removed = this.documentStore.unload(uri, {force: discard});
    if (removed) this.remove(uri);
    return removed;
  }

  /** Materialize only compilation inputs; exceeding the byte budget is an explicit admission error. */
  async compileAsync(options = {}) {
    if (this.documentStore) {
      for (const record of this.documentStore.entries.values()) {
        if (/\.cs$/i.test(record.path) && record.compile !== false) await this.openFile(record.path, {signal: options.signal, pin: true});
      }
    }
    return this.compile(options);
  }

  exportProject() {
    return {format: 'sharpforge-project', version: 1,
      files: [...this.documents.values()].map(({source}) => ({uri: source.uri, text: source.text, version: source.version}))};
  }

  /** Validate imports completely before replacing buffers; never lower a local version watermark. */
  importProject(project) {
    if (project?.format !== 'sharpforge-project' || project.version !== 1 || !Array.isArray(project.files)) {
      throw new Error('Not a SharpForge project');
    }
    if (project.files.length > this.maxDocuments) throw new Error('Too many documents');
    const next = new Map();
    const versions = new Map(this.versions);
    let bytes = 0;
    for (const file of project.files) {
      this.validate(file?.uri, file?.text);
      bytes += file.text.length * 2;
      if (bytes > this.maxWorkspaceBytes) throw new RangeError('Workspace loaded document byte budget exceeded');
      if (next.has(file.uri)) throw new Error('Duplicate imported document URI: ' + file.uri);
      const previous = Math.max(versions.get(file.uri) ?? 0, this.documents.get(file.uri)?.source.version ?? 0);
      const imported = Number.isSafeInteger(file.version) && file.version > 0 ? file.version : 0;
      const version = Math.max(previous, imported) + 1;
      if (!Number.isSafeInteger(version)) throw new RangeError('Document version space exhausted');
      next.set(file.uri, {source: new SourceText(file.text, file.uri, version), parsed: null});
      versions.set(file.uri, version);
    }
    this.documents = next;
    this.loadedDocumentBytes = bytes;
    this.versions = versions;
    this.generatedDocuments.clear();
    this.revision++;
    this.result = null;
  }

  dispose() {
    this.unsubscribeEviction?.();
    this.documents.clear();
    this.generatedDocuments.clear();
    this.loadedDocumentBytes = 0;
    this.result = null;
  }
}
