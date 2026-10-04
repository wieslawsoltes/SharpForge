import { cliSystemName, decodeCoded, decodeSignature, decodeTypeSignature } from '@sharpforge/cil';
import { createTypeDesc, completeTypeDesc, TypeDesc, TypeKind } from './type-desc.js';
import { ConstructedTypes, resolveArrayMethod } from './constructed-types.js';
import { TypeAssignability } from './casting.js';
import { MethodBaseDefinitions } from './method-base-definition.js';
import { TypeForwarders } from '../resolve/forwarders.js';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';

const fail = message => loadError(LoadErrorCode.TypeLoad, message);
const enumPrimitives = new Set(['sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong']);

/** Bounded, lazy inheritance loading; framework type binding is an explicit host policy. */
export class TypeLoader {
  #context;
  #resolveExternal;
  #maxDepth;
  #maxRows;
  #indices = new WeakMap();
  #intrinsics = new Map();
  #constructed;
  #casting;
  #methodBases;
  #maxConstructedTypes;
  #specMarkers = new WeakMap();
  #forwarders;
  #forwarderOptions;
  #lookupDefinition = (module, fullName) => this.#index(module).names.get(fullName);
  constructor(context, { resolveExternalType = null, maxDepth = 128, maxMetadataRows = 100000,
    maxConstructedTypes = 100000, maxForwarderHops = 128 } = {}) {
    if (resolveExternalType !== null && typeof resolveExternalType !== 'function') throw new TypeError('Invalid external type resolver');
    if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 512 ||
        !Number.isInteger(maxMetadataRows) || maxMetadataRows < 1 || maxMetadataRows > 1000000) throw new RangeError('Invalid type graph limits');
    this.#context = context;
    this.#resolveExternal = resolveExternalType;
    this.#maxDepth = maxDepth;
    this.#maxRows = maxMetadataRows;
    if (!Number.isSafeInteger(maxForwarderHops) || maxForwarderHops < 1 || maxForwarderHops > 1024) {
      throw loadError(LoadErrorCode.InvalidConfiguration, 'Invalid type forwarder hop limit');
    }
    this.#forwarderOptions = { maxMetadataRows, maxForwarderHops, maxDepth };
    if (!Number.isSafeInteger(maxConstructedTypes) || maxConstructedTypes < 1 || maxConstructedTypes > 1000000) {
      throw new RangeError('Invalid constructed type limit');
    }
    this.#maxConstructedTypes = maxConstructedTypes;
  }

  /** Explicit host BCL registration. Names never implicitly satisfy an AssemblyRef. */
  defineIntrinsic(fullName, { kind = TypeKind.Class, baseType = null, interfaces = [], genericArity = 0 } = {}) {
    if (this.#intrinsics.has(fullName)) throw fail(`Intrinsic ${fullName} is already registered`);
    if (typeof fullName !== 'string' || !fullName.length || fullName.length > 4096 ||
        ![TypeKind.Class, TypeKind.ValueType, TypeKind.Enum, TypeKind.Interface].includes(kind)) throw fail('Invalid intrinsic definition');
    if (this.#intrinsics.size >= 4096 || interfaces.length > 4096) throw loadError(LoadErrorCode.LimitExceeded, 'Intrinsic type limit exceeded');
    if (!Number.isInteger(genericArity) || genericArity < 0 || genericArity > 1024) throw fail('Invalid intrinsic generic arity');
    if (baseType !== null && !(baseType instanceof TypeDesc)) throw new TypeError('Expected base TypeDesc');
    for (const type of interfaces) if (!(type instanceof TypeDesc)) throw new TypeError('Expected interface TypeDesc');
    const split = fullName.lastIndexOf('.');
    const state = { name: fullName.slice(split + 1), namespace: split < 0 ? '' : fullName.slice(0, split), fullName,
      kind, module: null, token: 0, context: this.#context, declaringType: null, baseType,
      interfaces: Object.freeze([...interfaces]), loaded: true };
    const type = createTypeDesc(state);
    state.genericParameters = Object.freeze(Array.from({ length: genericArity }, (_, position) => createTypeDesc({
      name: `T${position}`, fullName: `T${position}`, namespace: '', kind: TypeKind.GenericParameter, context: this.#context,
      module: null, token: 0, declaringType: null, owner: type, position, loaded: true,
    })));
    this.#intrinsics.set(fullName, type);
    return type;
  }

  intrinsic(fullName) {
    const type = this.#intrinsics.get(fullName);
    if (!type) throw fail(`Host must register intrinsic ${fullName}`);
    return type;
  }

  isIntrinsic(type, fullName) { return type === this.#intrinsics.get(fullName); }
  get #constructions() { return this.#constructed ??= new ConstructedTypes(this, this.#context, this.#maxConstructedTypes); }
  constructElement(kind, element, rank = 0) {
    if (!(element instanceof TypeDesc)) throw new TypeError('Expected element TypeDesc');
    if (![TypeKind.SZArray, TypeKind.Array, TypeKind.Pointer, TypeKind.ByRef].includes(kind)) throw fail('Invalid element construction');
    const owner = element.loadContext.types;
    return owner === this ? this.#constructions.element(kind, element, rank) : owner.constructElement(kind, element, rank);
  }
  szArray(element) { return this.constructElement(TypeKind.SZArray, element, 1); }
  array(element, rank) { return this.constructElement(TypeKind.Array, element, rank); }
  pointer(element) { return this.constructElement(TypeKind.Pointer, element); }
  byRef(element) { return this.constructElement(TypeKind.ByRef, element); }
  functionPointer(signature) { return this.#constructions.functionPointer(signature); }
  /** Compare already loaded descriptors; unsupported generic/unsafe cases fail explicitly. */
  isAssignableFrom(target, source, options = {}) {
    this.#casting ??= new TypeAssignability({ maxDepth: this.#maxDepth, maxMetadataRows: this.#maxRows });
    return this.#casting.isAssignableFrom(target, source, options);
  }

  /** Resolve a canonical MethodDesc's implicit class override ancestry without decoding method bodies. */
  getBaseDefinition(method, options = {}) {
    this.#methodBases ??= new MethodBaseDefinitions(this, { maxDepth: this.#maxDepth, maxMetadataRows: this.#maxRows });
    return this.#methodBases.get(method, options);
  }

  #index(module) {
    if (this.#indices.has(module)) return this.#indices.get(module);
    const count = module.rowCount(2);
    if (count + module.rowCount(9) > this.#maxRows) throw loadError(LoadErrorCode.LimitExceeded, 'Type graph row limit exceeded');
    const index = { names: new Map(), interfaces: new Map() };
    for (let rid = 1; rid <= count; rid++) {
      const type = module.typeDefinition(0x02000000 + rid);
      if (index.names.has(type.fullName)) throw fail(`Duplicate type name ${type.fullName}`);
      index.names.set(type.fullName, type.metadataToken);
    }
    for (let rid = 1; rid <= module.rowCount(9); rid++) {
      const [owner, reference] = module.row(0x09000000 + rid);
      if (!owner || owner > count) throw fail('Invalid InterfaceImpl owner');
      if (!index.interfaces.has(owner)) index.interfaces.set(owner, []);
      index.interfaces.get(owner).push(decodeCoded('TypeDefOrRef', reference));
    }
    this.#indices.set(module, index);
    return index;
  }

  async find(module, fullName, options = {}) {
    checkCancellation(options.signal);
    try {
      if (typeof fullName !== 'string' || !fullName || fullName.length > 4096) throw fail('Invalid metadata type name');
      return await this.#find(module, fullName, { signal: options.signal, path: new Set(), references: new Map() });
    } catch (error) {
      if (error.code?.startsWith('SFCLR')) throw error;
      throw loadError(LoadErrorCode.InvalidImage, `Invalid type metadata: ${error.message}`);
    }
  }

  async #find(module, fullName, operation) {
    const token = this.#lookupDefinition(module, fullName);
    if (token) return this.#load(module, token, operation);
    this.#forwarders ??= new TypeForwarders(this.#forwarderOptions);
    const target = await this.#forwarders.resolve(module, fullName, this.#lookupDefinition, operation);
    return this.#load(target.module, target.token, operation);
  }

  /** Complete a canonical descriptor's base/interface graph without reading executable bodies. */
  async load(module, token, options = {}) {
    try { return await this.#load(module, token, { signal: options.signal, path: new Set(), references: new Map() }); }
    catch (error) {
      if (error.code?.startsWith('SFCLR')) throw error;
      throw loadError(LoadErrorCode.InvalidImage, `Invalid type metadata: ${error.message}`);
    }
  }

  async #load(module, token, operation) {
    checkCancellation(operation.signal);
    if (!Number.isInteger(token) || token < 0 || token > 0xffffffff || !(token & 0xffffff)) {
      throw loadError(LoadErrorCode.InvalidImage, 'Invalid type metadata token');
    }
    if (operation.path.size >= this.#maxDepth) throw loadError(LoadErrorCode.LimitExceeded, 'Type graph depth exceeded');
    if (module.assembly.loadContext !== this.#context) return module.assembly.loadContext.types.#load(module, token, operation);
    if (token >>> 24 === 1) return this.#reference(module, token, operation);
    if (token >>> 24 === 27) {
      const signature = decodeTypeSignature(module.blob(module.row(token)[0]));
      if (!this.#specMarkers.has(module)) this.#specMarkers.set(module, new Map());
      const markers = this.#specMarkers.get(module);
      if (!markers.has(token) && markers.size >= this.#maxConstructedTypes) throw loadError(LoadErrorCode.LimitExceeded, 'TypeSpec limit exceeded');
      if (!markers.has(token)) markers.set(token, Object.freeze({ token }));
      const marker = markers.get(token);
      if (operation.path.has(marker)) throw fail('Circular TypeSpec resolution');
      const nested = { ...operation, path: new Set([...operation.path, marker]) };
      return this.#constructions.signature(signature, reference => this.#load(module, reference, nested), operation.signal);
    }
    const type = module.typeDefinition(token);
    if (operation.path.has(type)) throw fail(`Circular inheritance involving ${type.fullName}`);
    if (type.isLoaded) return type;
    const row = module.row(token);
    const nested = { ...operation, path: new Set([...operation.path, type]) };
    const baseType = row[3] ? await this.#load(module, decodeCoded('TypeDefOrRef', row[3]), nested) : null;
    if (baseType?.isInterface || (type.isInterface && baseType)) throw fail('Invalid class/interface base relationship');
    if (baseType && [TypeKind.Array, TypeKind.SZArray, TypeKind.Pointer, TypeKind.ByRef, TypeKind.FunctionPointer].includes(baseType.kind)) {
      throw fail('Invalid constructed base type');
    }
    if (baseType && ((baseType.flags & 0x100) || [TypeKind.ValueType, TypeKind.Enum].includes(baseType.kind))) {
      throw fail('A type cannot derive from a sealed or value type');
    }
    const interfaces = new Set(baseType?.interfaces ?? []);
    for (const reference of this.#index(module).interfaces.get(token & 0xffffff) ?? []) {
      const contract = await this.#load(module, reference, nested);
      if (!contract.isInterface) throw fail('InterfaceImpl does not name an interface');
      interfaces.add(contract);
      for (const inherited of contract.interfaces) interfaces.add(inherited);
    }
    const kind = type.isInterface ? TypeKind.Interface : baseType === this.#intrinsics.get('System.Enum') ? TypeKind.Enum
      : baseType === this.#intrinsics.get('System.ValueType') ? TypeKind.ValueType : TypeKind.Class;
    const underlyingType = kind === TypeKind.Enum ? this.#enumUnderlying(module, token) : null;
    checkCancellation(operation.signal);
    if (!type.isLoaded) completeTypeDesc(type, { kind, baseType, interfaces: Object.freeze([...interfaces]), underlyingType, loaded: true });
    return type;
  }

  async #reference(module, token, operation) {
    const active = operation.references.get(module) ?? new Set();
    if (active.has(token)) throw fail('Circular TypeRef resolution');
    const references = new Map(operation.references).set(module, new Set([...active, token]));
    const nested = { ...operation, references, path: new Set([...operation.path, {}]) };
    const [scope, nameIndex, namespaceIndex] = module.row(token);
    const name = module.string(nameIndex);
    const namespace = module.string(namespaceIndex);
    const fullName = `${namespace ? namespace + '.' : ''}${name}`;
    const tag = scope & 3;
    const rid = scope >>> 2;
    let target = module;
    let targetName = fullName;
    if (tag === 3) {
      const parent = await this.#load(module, 0x01000000 + rid, nested);
      if (!parent.module) throw fail('Nested intrinsic TypeRef requires a metadata module');
      target = parent.module;
      targetName = `${parent.fullName}+${name}`;
    } else if (tag === 2 && rid) {
      const assemblyName = await module.assembly.reference(rid, operation);
      const external = await this.#resolveExternal?.({ module, assemblyName, namespace, name, signal: operation.signal,
        resolveType: (targetModule, targetToken) => this.#load(targetModule, targetToken, nested) });
      checkCancellation(operation.signal);
      if (external != null) {
        if (!(external instanceof TypeDesc) || !external.isLoaded) throw fail('External resolver must return a loaded TypeDesc');
        if (external.fullName !== fullName) throw fail(`External type resolver returned ${external.fullName} for ${fullName}`);
        return external;
      }
      target = (await module.assembly.resolveReference(rid, operation)).manifestModule;
    } else if (tag !== 0 || rid !== 1) throw fail('ModuleRef and null-scoped TypeRef resolution require a later loader batch');
    return this.#find(target, targetName, nested);
  }

  #enumUnderlying(module, token) {
    const fields = module.list(token, 'FieldList').filter(field => !(module.row(field)[0] & 0x10));
    if (fields.length !== 1) throw fail('Enum must have one instance field');
    const signature = decodeSignature(module.blob(module.row(fields[0])[2]));
    if (signature.kind !== 'field' || signature.type.kind !== 'primitive' || !enumPrimitives.has(signature.type.name)) {
      throw fail('Enum instance field must have an integral type');
    }
    return this.intrinsic(cliSystemName(signature.type.name));
  }

  /** Decode and exactly resolve an array MemberRef, including rank and lower-bound constructor signatures. */
  async resolveArrayMember(module, token, options = {}) {
    try { return await this.#resolveArrayMember(module, token, options); }
    catch (error) {
      if (error.code?.startsWith('SFCLR')) throw error;
      throw loadError(LoadErrorCode.InvalidImage, `Invalid array member metadata: ${error.message}`);
    }
  }

  async #resolveArrayMember(module, token, options) {
    checkCancellation(options.signal);
    if (!Number.isInteger(token) || token < 0 || token > 0xffffffff || token >>> 24 !== 10) throw fail('Expected MemberRef token');
    const [parent, name, blob] = module.row(token);
    if ((parent & 7) !== 4) throw fail('Array MemberRef must be scoped by TypeSpec');
    const type = await this.load(module, 0x1b000000 + (parent >>> 3), options);
    const signature = decodeSignature(module.blob(blob));
    if (signature.kind !== 'method' || !signature.hasThis || signature.explicitThis || signature.callingConvention !== 0 ||
        signature.genericArity || signature.sentinel !== -1) throw fail('Array member requires a default instance method signature');
    const resolveType = reference => this.load(module, reference, options);
    const returnType = await this.#constructions.signature(signature.returnType, resolveType, options.signal);
    const parameters = [];
    for (const parameter of signature.parameters) parameters.push(await this.#constructions.signature(parameter, resolveType, options.signal));
    return resolveArrayMethod(type, module.string(name), returnType, parameters);
  }
}
