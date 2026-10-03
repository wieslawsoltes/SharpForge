import { readPE } from '@sharpforge/cil';
import { assemblyIdentityFromRow } from './identity.js';
import { checkCancellation, loadError, LoadErrorCode } from './load-errors.js';

function namedIdentityRow(row, reference) {
  if (!reference) return { MajorVersion: row[1], MinorVersion: row[2], BuildNumber: row[3], RevisionNumber: row[4],
    Flags: row[5], PublicKey: row[6], Name: row[7], Culture: row[8] };
  return { MajorVersion: row[0], MinorVersion: row[1], BuildNumber: row[2], RevisionNumber: row[3],
    Flags: row[4], PublicKeyOrToken: row[5], Name: row[6], Culture: row[7] };
}

function readIdentity(metadata, row, reference, signal) {
  return assemblyIdentityFromRow(namedIdentityRow(row, reference), {
    reference, signal, readString: index => metadata.string(index), readBlob: index => metadata.blob(index),
  });
}

function guidText(bytes) {
  const hex = index => bytes[index].toString(16).padStart(2, '0');
  return [[3, 2, 1, 0], [5, 4], [7, 6], [8, 9], [10, 11, 12, 13, 14, 15]].map(group => group.map(hex).join('')).join('-');
}

/** One manifest module with cached metadata access and method bodies decoded only on demand. */
export class RuntimeModule {
  #pe;
  #assembly;
  #bodies = new Map();
  #typeHandles = new Map();
  #bodyReads = 0;
  constructor(assembly, pe) {
    this.#assembly = assembly;
    this.#pe = pe;
    const moduleRow = pe.metadata.row(1);
    this.scopeName = pe.metadata.string(moduleRow[1]);
    // Stream-loaded assemblies have no filesystem module name, matching CoreCLR Module.Name.
    this.name = '<Unknown>';
    this.moduleVersionId = guidText(pe.metadata.guid(moduleRow[2]));
    Object.freeze(this);
  }

  get assembly() { return this.#assembly; }
  get methodBodyReadCount() { return this.#bodyReads; }

  /** Copy a table row so callers cannot mutate the parsed image. */
  row(token) {
    this.#assembly.ensureUsable();
    try { return Object.freeze([...this.#pe.metadata.row(token)]); }
    catch (error) { throw loadError(LoadErrorCode.InvalidImage, error.message); }
  }

  rowCount(table) {
    this.#assembly.ensureUsable();
    return this.#pe.metadata.counts[table] ?? 0;
  }

  string(index) {
    this.#assembly.ensureUsable();
    return this.#pe.metadata.string(index);
  }

  blob(index) {
    this.#assembly.ensureUsable();
    return this.#pe.metadata.blob(index).slice();
  }

  /** Context-local canonical handle; the strong assembly edge keeps collectible metadata alive. */
  typeIdentity(token) {
    if (token >>> 24 !== 2) throw loadError(LoadErrorCode.InvalidImage, 'Type identity requires a TypeDef token');
    this.row(token);
    if (!this.#typeHandles.has(token)) {
      this.#typeHandles.set(token, Object.freeze({ kind: 'TypeDefinitionHandle', module: this, metadataToken: token }));
    }
    return this.#typeHandles.get(token);
  }

  /** Metadata decoding is lazy and counted once per method. Returned byte arrays are isolated copies. */
  methodBody(token) {
    this.#assembly.ensureUsable();
    if (token >>> 24 !== 6) throw loadError(LoadErrorCode.InvalidImage, 'Method body requires a MethodDef token');
    const row = this.row(token);
    if (row[0] === 0) return null;
    if (!this.#bodies.has(token)) {
      try {
        this.#bodies.set(token, this.#pe.methodBody(token));
        this.#bodyReads++;
      } catch (error) { throw loadError(LoadErrorCode.InvalidImage, error.message); }
    }
    const body = this.#bodies.get(token);
    return Object.freeze({
      ...body, code: body.code.slice(),
      handlers: Object.freeze(body.handlers.map(handler => Object.freeze({ ...handler }))),
    });
  }
}

/** Managed assembly metadata, bound to exactly one explicit load context. */
export class RuntimeAssembly {
  #context;
  #pe;
  #references = new Map();
  #manifestModule;
  constructor(context, pe, identity) {
    this.#context = context;
    this.#pe = pe;
    this.identity = identity;
    this.#manifestModule = new RuntimeModule(this, pe);
    Object.freeze(this);
  }

  /** Copies untrusted image bytes, bounds the PE parser, and reads only the manifest identity. */
  static async fromBytes(context, input, { signal, maxBytes = 64 * 1024 * 1024 } = {}) {
    checkCancellation(signal);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1024 * 1024) {
      throw new RangeError('Invalid PE image limit');
    }
    const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
    if (!(bytes instanceof Uint8Array) || bytes.length > maxBytes) throw loadError(LoadErrorCode.InvalidImage, 'Invalid assembly image');
    try {
      const pe = readPE(bytes.slice(), { maxBytes, inspection: true });
      if (pe.metadata.counts[32] !== 1 || pe.metadata.counts[0] !== 1) {
        throw loadError(LoadErrorCode.InvalidImage, 'Assembly image must contain one Assembly and one Module row');
      }
      const identity = await readIdentity(pe.metadata, pe.metadata.row(0x20000001), false, signal);
      checkCancellation(signal);
      return new RuntimeAssembly(context, pe, identity);
    } catch (error) {
      if (error.code?.startsWith('SFCLR')) throw error;
      throw loadError(LoadErrorCode.InvalidImage, `Invalid assembly image: ${error.message}`);
    }
  }

  get loadContext() { return this.#context; }
  get fullName() { return this.identity.fullName; }
  get manifestModule() { this.ensureUsable(); return this.#manifestModule; }
  get referenceCount() { this.ensureUsable(); return this.#pe.metadata.counts[35] ?? 0; }

  ensureUsable() { this.#context.ensureUsable(); }

  /** Decode one AssemblyRef identity, without resolving or loading the referenced assembly. */
  async reference(index, { signal } = {}) {
    this.ensureUsable();
    checkCancellation(signal);
    if (!Number.isSafeInteger(index) || index < 1 || index > this.referenceCount) {
      throw loadError(LoadErrorCode.InvalidImage, 'AssemblyRef index is out of range');
    }
    if (!this.#references.has(index)) {
      const identity = await readIdentity(this.#pe.metadata, this.#pe.metadata.row(0x23000000 + index), true, signal);
      this.ensureUsable();
      this.#references.set(index, identity);
    }
    return this.#references.get(index);
  }

  async getReferencedAssemblies(options) {
    const result = [];
    for (let index = 1; index <= this.referenceCount; index++) result.push(await this.reference(index, options));
    return Object.freeze(result);
  }

  async resolveReference(index, options = {}) {
    const reference = await this.reference(index, options);
    return this.#context.loadFromAssemblyName(reference, { ...options, requester: this });
  }
}
