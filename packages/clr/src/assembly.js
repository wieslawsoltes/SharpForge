import { readPE } from '@sharpforge/cil';
import { assemblyIdentityFromRow } from './identity.js';
import { checkCancellation, loadError, LoadErrorCode } from './load-errors.js';
import { MetadataTypeDefinitions } from './type-system/metadata-type-definitions.js';
import { MetadataMemberDefinitions } from './type-system/metadata-member-definitions.js';
import { MetadataConstants } from './type-system/metadata-constants.js';
import { MetadataAccessors } from './type-system/metadata-accessors.js';
import { MetadataParameters } from './type-system/metadata-parameters.js';
import { MetadataPropertyParameters } from './type-system/metadata-property-parameters.js';
import { MetadataGenericParameters } from './type-system/metadata-generic-parameters.js';

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

function validateHeapLimit(maxBytes) {
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 256 * 1024 * 1024)) {
    throw loadError(LoadErrorCode.InvalidConfiguration, 'Invalid metadata heap byte limit');
  }
}

/** One manifest module with cached metadata access and method bodies decoded only on demand. */
export class RuntimeModule {
  #pe;
  #assembly;
  #bodies = new Map();
  #typeHandles = new Map();
  #bodyReads = 0;
  #typeDefinitions;
  #methodDefinitions;
  #fieldDefinitions;
  #propertyDefinitions;
  #eventDefinitions;
  #accessors;
  #constants;
  #parameterDefinitions;
  #propertyParameters;
  #genericParameters;
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

  /** Optional maxBytes bounds UTF-8 bytes before decoding; invalid limits and oversized values produce SFCLR006/007. */
  string(index, { maxBytes } = {}) {
    this.#assembly.ensureUsable();
    validateHeapLimit(maxBytes);
    if (maxBytes !== undefined) {
      const heap = this.#pe.metadata.streams.get('#Strings');
      if (!heap && index === 0) return '';
      if (!Number.isSafeInteger(index) || index < 0 || !heap || index >= heap.length) {
        throw loadError(LoadErrorCode.InvalidImage, 'Invalid string heap index');
      }
      let end = index;
      while (end < heap.length && heap[end] !== 0 && end - index <= maxBytes) end++;
      if (end - index > maxBytes) throw loadError(LoadErrorCode.LimitExceeded, 'Metadata string byte limit exceeded');
      if (end === heap.length) throw loadError(LoadErrorCode.InvalidImage, 'Unterminated metadata string');
    }
    return this.#pe.metadata.string(index);
  }

  /** Bounded metadata spelling of a TypeDef/TypeRef; no assembly binding or TypeSpec expansion. */
  typeName(token) {
    this.#requireTypeNameToken(token);
    const metadata = this.#pe.metadata;
    if ((metadata.counts[2] ?? 0) + (metadata.counts[41] ?? 0) > 100000) {
      throw loadError(LoadErrorCode.LimitExceeded, 'Type name metadata row limit exceeded');
    }
    let characters = 0;
    const adapter = { ...metadata, string: index => {
      const name = this.string(index, { maxBytes: 16384 });
      if (name.length > 4096 || (characters += name.length) > 16384) {
        throw loadError(LoadErrorCode.LimitExceeded, 'Type name expansion limit exceeded');
      }
      return name;
    } };
    try {
      const name = metadata.typeName.call(adapter, token);
      if (name.length > 4096) throw loadError(LoadErrorCode.LimitExceeded, 'Type name length exceeded');
      return name;
    } catch (error) {
      if (error.code?.startsWith('SFCLR')) throw error;
      throw loadError(LoadErrorCode.InvalidImage, `Invalid type name: ${error.message}`);
    }
  }

  #requireTypeNameToken(token) {
    this.#assembly.ensureUsable();
    if (!Number.isInteger(token) || token < 0 || token > 0xffffffff ||
        ![1, 2].includes(token >>> 24) || !(token & 0xffffff)) {
      throw loadError(LoadErrorCode.InvalidImage, 'Type name requires a TypeDef or TypeRef token');
    }
  }

  /** Return an owned copy, optionally rejecting maxBytes before materialization (SFCLR006/007 for invalid/exceeded limits). */
  blob(index, { maxBytes } = {}) {
    this.#assembly.ensureUsable();
    validateHeapLimit(maxBytes);
    const bytes = this.#pe.metadata.blob(index);
    if (maxBytes !== undefined && bytes.byteLength > maxBytes) {
      throw loadError(LoadErrorCode.LimitExceeded, 'Metadata blob byte limit exceeded');
    }
    return new Uint8Array(bytes);
  }

  /** Resolve a metadata owner list, including #- pointer table indirection. */
  list(token, column) {
    this.#assembly.ensureUsable();
    return Object.freeze([...this.#pe.metadata.list(token, column)]);
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

  /** Canonical named TypeDef identity, independent of inheritance and executable method loading. */
  typeDefinition(token) {
    this.#assembly.ensureUsable();
    this.#typeDefinitions ??= new MetadataTypeDefinitions(this);
    return this.#typeDefinitions.get(token);
  }

  /** Canonical MethodDef identity; decoding signatures and bodies remains explicit and lazy. */
  methodDefinition(token) {
    this.#assembly.ensureUsable();
    this.#methodDefinitions ??= new MetadataMemberDefinitions(this);
    return this.#methodDefinitions.get(token);
  }

  /** Immutable declared method list in metadata order; this does not apply reflection BindingFlags. */
  methodDefinitions(typeToken) {
    this.#assembly.ensureUsable();
    this.#methodDefinitions ??= new MetadataMemberDefinitions(this);
    return this.#methodDefinitions.forType(typeToken);
  }

  /** Frozen positional parameter/return metadata; raw constants are decoded only when requested. */
  methodParameters(methodToken) {
    this.#assembly.ensureUsable();
    this.#parameterDefinitions ??= new MetadataParameters(this);
    return this.#parameterDefinitions.forMethod(methodToken);
  }

  /** Canonical FieldDef metadata identity; signatures and raw constants remain lazy. */
  fieldDefinition(token) {
    this.#assembly.ensureUsable();
    this.#fieldDefinitions ??= new MetadataMemberDefinitions(this, 'field');
    return this.#fieldDefinitions.get(token);
  }

  /** Frozen declared-field list in metadata order, including #- FieldPtr indirection. */
  fieldDefinitions(typeToken) {
    this.#assembly.ensureUsable();
    this.#fieldDefinitions ??= new MetadataMemberDefinitions(this, 'field');
    return this.#fieldDefinitions.forType(typeToken);
  }

  /** Canonical Property metadata identity with lazy signature and accessor links. */
  propertyDefinition(token) {
    this.#assembly.ensureUsable();
    this.#propertyDefinitions ??= new MetadataMemberDefinitions(this, 'property');
    return this.#propertyDefinitions.get(token);
  }

  /** Frozen declared-property list through PropertyMap and optional #- PropertyPtr indirection. */
  propertyDefinitions(typeToken) {
    this.#assembly.ensureUsable();
    this.#propertyDefinitions ??= new MetadataMemberDefinitions(this, 'property');
    return this.#propertyDefinitions.forType(typeToken);
  }

  /** Frozen {getMethod, setMethod, otherMethods} using canonical methods; no visibility filtering or execution. */
  propertyAccessors(token) {
    this.#assembly.ensureUsable();
    this.#accessors ??= new MetadataAccessors(this);
    return this.#accessors.get(token);
  }

  /** Frozen index parameters projected from getter or setter Param metadata, with the Property as owning member. */
  propertyParameters(token) {
    this.#assembly.ensureUsable();
    this.#propertyParameters ??= new MetadataPropertyParameters(this);
    return this.#propertyParameters.get(token);
  }

  /** Canonical Event metadata identity; the event type is an unresolved module-relative token. */
  eventDefinition(token) {
    this.#assembly.ensureUsable();
    this.#eventDefinitions ??= new MetadataMemberDefinitions(this, 'event');
    return this.#eventDefinitions.get(token);
  }

  /** Frozen declared-event list through EventMap and optional #- EventPtr indirection. */
  eventDefinitions(typeToken) {
    this.#assembly.ensureUsable();
    this.#eventDefinitions ??= new MetadataMemberDefinitions(this, 'event');
    return this.#eventDefinitions.forType(typeToken);
  }

  /** Frozen {addMethod, removeMethod, raiseMethod, otherMethods}; no visibility filtering or invocation. */
  eventAccessors(token) {
    this.#assembly.ensureUsable();
    this.#accessors ??= new MetadataAccessors(this);
    return this.#accessors.get(token, 20);
  }

  /** Frozen raw Constant value for a Field/Param/Property token, or null; malformed metadata yields SFCLR005/007. */
  constant(token) {
    this.#assembly.ensureUsable();
    this.#constants ??= new MetadataConstants(this);
    return this.#constants.get(token);
  }

  /** Ordered canonical GenericParam identities for a TypeDef; constraints are unresolved metadata tokens. */
  genericParameters(typeToken) {
    this.#assembly.ensureUsable();
    this.#genericParameters ??= new MetadataGenericParameters(this);
    return this.#genericParameters.forType(typeToken);
  }

  /** Canonical MethodDef-owned generic parameter identities, checked against signature arity. */
  methodGenericParameters(methodToken) {
    this.#assembly.ensureUsable();
    this.#genericParameters ??= new MetadataGenericParameters(this);
    return this.#genericParameters.forMethod(methodToken);
  }

  /** Canonical GenericParam token lookup for either TypeDef or MethodDef ownership. */
  genericParameter(token) {
    this.#assembly.ensureUsable();
    this.#genericParameters ??= new MetadataGenericParameters(this);
    return this.#genericParameters.get(token);
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
      ...body, code: new Uint8Array(body.code),
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
      const pe = readPE(new Uint8Array(bytes), { maxBytes, inspection: true });
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
