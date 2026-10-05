import { decodeCoded, decodeSignature } from '@sharpforge/cil';
import { createTypeDesc, completeTypeDesc, TypeDesc, TypeKind } from './type-desc.js';
import { ConstructedTypes, resolveArrayMethod } from './constructed-types.js';
import { TypeAssignability } from './casting.js';
import { MethodBaseDefinitions } from './method-base-definition.js';
import { TypeForwarders } from '../resolve/forwarders.js';
import { GenericTypeInstantiations } from '../generics/instantiation.js';
import { copyResolutionContext, copyTypeArguments, GenericResolutionContext } from '../generics/resolution-context.js';
import { genericSignatureTypes } from '../generics/signature-types.js';
import { GenericTypeCompletion, isGenericCompletionKind } from '../generics/type-completion.js';
import { GenericContextLifetime } from '../generics/context-lifetime.js';
import { InstantiationClosures } from '../generics/instantiation-closure.js';
import { DefinitionBindings } from '../generics/definition-bindings.js';
import { TypeDefinitionCompletion } from './type-definition-completion.js';
import { TypeSpecifications } from './type-specifications.js';
import { awaitContextBinding } from '../binding-wait.js';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';

const fail = message => loadError(LoadErrorCode.TypeLoad, message);

function requireTypeToken(token) {
  if (!Number.isInteger(token) || token < 0 || token > 0xffffffff || !(token & 0xffffff)) {
    throw loadError(LoadErrorCode.InvalidImage, 'Invalid type metadata token');
  }
}

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
  #specifications;
  #forwarders;
  #maxForwarderHops;
  #lookupDefinition;
  #instantiations;
  #definitionScopes;
  #maxGenericWork;
  #maxTypeSignatureBytes;
  #genericLifetime;
  #completion;
  #closures;
  #bindings;
  #definitions;
  #closureDefinitions;
  constructor(context, { resolveExternalType = null, maxDepth = 128, maxMetadataRows = 100000,
    maxConstructedTypes = 100000, maxForwarderHops = 128, maxGenericWork = 100000, maxTypeSignatureBytes = 65536 } = {}) {
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
    this.#maxForwarderHops = maxForwarderHops;
    if (!Number.isSafeInteger(maxConstructedTypes) || maxConstructedTypes < 1 || maxConstructedTypes > 1000000) {
      throw new RangeError('Invalid constructed type limit');
    }
    this.#maxConstructedTypes = maxConstructedTypes;
    if (!Number.isSafeInteger(maxGenericWork) || maxGenericWork < 1 || maxGenericWork > 1000000 ||
        !Number.isSafeInteger(maxTypeSignatureBytes) || maxTypeSignatureBytes < 1 || maxTypeSignatureBytes > 1048576) {
      throw loadError(LoadErrorCode.InvalidConfiguration, 'Invalid generic resolution limits');
    }
    this.#maxGenericWork = maxGenericWork;
    this.#maxTypeSignatureBytes = maxTypeSignatureBytes;
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
  get #constructions() {
    return this.#constructed ??= new ConstructedTypes(this, this.#context, this.#maxConstructedTypes, {
      signatureExtensions: genericSignatureTypes,
      instantiate: (definition, arguments_) => this.#intern(definition, arguments_),
    });
  }

  #intern(definition, arguments_) {
    if (!(definition instanceof TypeDesc)) throw fail('Generic instantiation requires a TypeDesc definition');
    const owner = definition.loadContext.types;
    if (owner !== this) return owner.#intern(definition, arguments_);
    this.#instantiations ??= new GenericTypeInstantiations(this.#context, this.#constructions.cache, {
      maxDepth: this.#maxDepth, maxWork: this.#maxGenericWork,
    });
    return this.#instantiations.get(definition, arguments_);
  }

  /** Canonical open/partial/closed identity plus inheritance graph; unsupported semantic constraints reject with SFCLR013. */
  async instantiate(definition, typeArguments, options = {}) {
    try {
      checkCancellation(options.signal);
      const originContext = definition instanceof TypeDesc ? definition.loadContext : null;
      if (originContext && originContext !== this.#context) return await originContext.types.instantiate(definition, typeArguments, options);
      const originWasUnloading = originContext?.isUnloading;
      const arguments_ = copyTypeArguments(typeArguments);
      checkCancellation(options.signal);
      const type = this.#intern(definition, arguments_);
      checkCancellation(options.signal);
      if (!originWasUnloading && originContext.isUnloading) throw loadError(LoadErrorCode.Disposed, 'Generic type context began unloading');
      if (type.isLoaded && this.#closures?.has(type)) return type;
      const operation = this.#operation(options.signal);
      operation.contextOwnedBindings = true;
      operation.originContext = originContext;
      operation.originWasUnloading = originWasUnloading;
      return await this.#finish(operation, () => {
        const work = this.#genericOperation(operation);
        work.observeContext(originContext, originWasUnloading);
        work.observe(type);
        return this.#complete(type, operation);
      });
    } catch (error) {
      if (error.code?.startsWith('SFCLR')) throw error;
      throw loadError(LoadErrorCode.InvalidImage, `Invalid generic type metadata: ${error.message}`);
    }
  }
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
      const owner = module.assembly.loadContext;
      if (owner !== this.#context) return await owner.types.find(module, fullName, options);
      if (typeof fullName !== 'string' || !fullName || fullName.length > 4096) throw fail('Invalid metadata type name');
      const token = this.#index(module).names.get(fullName);
      if (token) return await this.#start(module, token, options);
      const operation = this.#operation(options.signal);
      return await this.#finish(operation, () => this.#find(module, fullName, operation));
    } catch (error) {
      if (error.code?.startsWith('SFCLR')) throw error;
      throw loadError(LoadErrorCode.InvalidImage, `Invalid type metadata: ${error.message}`);
    }
  }

  async #find(module, fullName, operation) {
    const token = this.#index(module).names.get(fullName);
    if (token) return this.#load(module, token, operation);
    this.#forwarders ??= new TypeForwarders({ maxMetadataRows: this.#maxRows,
      maxForwarderHops: this.#maxForwarderHops, maxDepth: this.#maxDepth });
    this.#lookupDefinition ??= (target, name) => this.#index(target).names.get(name);
    const bindings = operation.root.contextOwnedBindings ? {
      ...operation, resolveReference: (assembly, index) => this.#assemblyReference(assembly, index, operation),
    } : operation;
    const target = await this.#forwarders.resolve(module, fullName, this.#lookupDefinition, bindings);
    return this.#load(target.module, target.token, operation);
  }

  /** Complete a canonical descriptor's base/interface graph without reading executable bodies. */
  async load(module, token, options = {}) {
    try { return await this.#start(module, token, options); }
    catch (error) {
      if (error.code?.startsWith('SFCLR')) throw error;
      throw loadError(LoadErrorCode.InvalidImage, `Invalid type metadata: ${error.message}`);
    }
  }

  #operation(signal, scope = null) {
    const operation = { signal, path: new Set(), references: new Map(), scope, rootResult: true,
      originContext: this.#context, originWasUnloading: this.#context.isUnloading, contextOwnedBindings: scope !== null };
    operation.root = operation;
    return operation;
  }

  async #finish(operation, action) {
    try {
      const result = await action();
      const work = operation.generic;
      if (work) {
        for (const definition of work.pendingCategories()) {
          await work.closure(this.#closureService).require(definition, operation);
          work.validateCategories();
        }
        work.validateCategories(true);
      }
      operation.generic?.complete();
      operation.generic?.publishClosure();
      return result;
    } finally {
      operation.generic?.dispose();
    }
  }

  #start(module, token, options) {
    checkCancellation(options.signal);
    requireTypeToken(token);
    const owner = module.assembly.loadContext;
    if (owner !== this.#context) return owner.types.#start(module, token, options);
    const scope = copyResolutionContext(options);
    if (scope) checkCancellation(options.signal);
    if (token >>> 24 === 2) {
      const type = module.typeDefinition(token);
      if (type.isLoaded && (!this.#closureDefinitions?.has(type) || this.#closures?.has(type))) return type;
    }
    const operation = this.#operation(options.signal, scope);
    return this.#finish(operation, () => this.#load(module, token, operation));
  }

  async #load(module, token, operation) {
    checkCancellation(operation.signal);
    requireTypeToken(token);
    if (operation.path.size >= this.#maxDepth) throw loadError(LoadErrorCode.LimitExceeded, 'Type graph depth exceeded');
    if (module.assembly.loadContext !== this.#context) return module.assembly.loadContext.types.#load(module, token, operation);
    if (token >>> 24 === 1) return this.#reference(module, token, operation);
    if (token >>> 24 === 27) return this.#typeSpecifications.load(module, token, operation);
    const type = module.typeDefinition(token);
    if (operation.identityOnly && operation.root.contextOwnedBindings) this.#genericOperation(operation).observe(type);
    return operation.identityOnly ? type : this.#complete(type, operation);
  }

  async #complete(type, operation) {
    this.#checkOperation(operation);
    if (operation.root.contextOwnedBindings) {
      const work = this.#genericOperation(operation);
      work.observeContext(operation.root.originContext, operation.root.originWasUnloading);
      work.observe(type);
    }
    if (operation.path.size >= this.#maxDepth) throw loadError(LoadErrorCode.LimitExceeded, 'Type graph depth exceeded');
    const owner = type.loadContext.types;
    if (owner !== this) return owner.#complete(type, operation);
    if (operation.path.has(type)) throw fail(`Circular inheritance involving ${type.fullName}`);
    if (operation.root.contextOwnedBindings || type.genericDefinition || type.genericParameters.length
        || type.elementType || type.signature || this.#closureDefinitions?.has(type)) {
      operation.root.contextOwnedBindings = true;
      const work = this.#genericOperation(operation);
      work.observeContext(operation.root.originContext, operation.root.originWasUnloading);
      await work.closure(this.#closureService).require(type, operation);
      this.#checkOperation(operation);
      work.validateCategories();
    }
    if (type.isLoaded) return type;
    if (isGenericCompletionKind(type.kind)) return this.#genericCompletion.complete(type, operation);
    return this.#definitionCompletion.complete(type, operation);
  }

  get #closureService() {
    return this.#closures ??= new InstantiationClosures((type, operation) => type.loadContext.types.#closureTemplate(type, operation),
      { maxEntries: this.#maxConstructedTypes, maxDepth: this.#maxDepth },
      (type, binding, work) => type.loadContext.types.#definitionBindings.observe(type, binding, work));
  }

  async #closureTemplate(type, operation) {
    if (type.isLoaded) return this.#definitionBindings.get(type);
    const module = type.module;
    const nested = { ...operation, scope: this.#definitionScope(type), identityOnly: true, rootResult: false };
    const parent = module.row(type.metadataToken)[3];
    const baseType = parent ? await this.#load(module, decodeCoded('TypeDefOrRef', parent), nested) : null;
    const interfaces = [];
    for (const token of this.#index(module).interfaces.get(type.metadataToken & 0xffffff) ?? []) {
      interfaces.push(await this.#load(module, token, nested));
    }
    return { baseType, interfaces };
  }

  #definitionScope(type) {
    if (!type.module.rowCount(42)) return null;
    this.#definitionScopes ??= new WeakMap();
    const cached = this.#definitionScopes.get(type);
    if (cached !== undefined) return cached;
    const parameters = type.genericParameters;
    const scope = parameters.length ? Object.freeze({ typeArguments: parameters, methodArguments: undefined }) : null;
    this.#definitionScopes.set(type, scope);
    return scope;
  }

  get #definitionBindings() { return this.#bindings ??= new DefinitionBindings(this.#maxGenericWork); }

  get #definitionCompletion() {
    return this.#definitions ??= new TypeDefinitionCompletion({
      scope: type => this.#definitionScope(type),
      complete: (type, operation) => this.#complete(type, operation),
      load: (module, token, operation) => this.#load(module, token, operation),
      interfaces: (module, token) => this.#index(module).interfaces.get(token & 0xffffff),
      intrinsic: name => this.#intrinsics.get(name),
      requireIntrinsic: name => this.intrinsic(name),
      publish: (type, graph, operation, binding) => this.#publish(type, graph, operation, binding),
    });
  }

  #genericOperation(operation) {
    const root = operation.root;
    if (!root.generic) {
      root.generic = new GenericResolutionContext(this.#maxGenericWork, operation.signal,
        (context, observer) => context.types.#watchGenericLifetime(observer));
      if (root.scope) {
        root.generic.observeContext(root.originContext, root.originWasUnloading);
        for (const argument of root.scope.typeArguments ?? []) root.generic.observe(argument);
        for (const argument of root.scope.methodArguments ?? []) root.generic.observe(argument);
      }
    }
    return root.generic;
  }

  #watchGenericLifetime(operation) {
    this.#genericLifetime ??= new GenericContextLifetime(this.#context, this.#maxGenericWork);
    return this.#genericLifetime.add(operation);
  }

  #checkOperation(operation) {
    checkCancellation(operation.signal);
    if (operation.root.contextOwnedBindings) this.#genericOperation(operation).visit();
  }

  #publish(type, state, operation, binding = null) {
    this.#checkOperation(operation);
    operation.root.generic?.validateCategories();
    if (operation.rootResult) operation.root.generic?.complete();
    if (binding) {
      operation.root.generic?.verifyBinding(type, binding);
      if (operation.root.contextOwnedBindings) (this.#closureDefinitions ??= new WeakSet()).add(type);
      this.#definitionBindings.publish(type, state, binding);
    } else if (!type.isLoaded) completeTypeDesc(type, state);
  }

  get #typeSpecifications() {
    return this.#specifications ??= new TypeSpecifications(this.#constructions, {
      maxSpecifications: this.#maxConstructedTypes, maxSignatureBytes: this.#maxTypeSignatureBytes,
    }, {
      load: (module, token, operation) => this.#load(module, token, operation),
      complete: (type, operation) => this.#complete(type, operation),
      work: operation => this.#genericOperation(operation),
      instantiate: (definition, arguments_) => this.#intern(definition, arguments_),
    });
  }

  get #genericCompletion() {
    return this.#completion ??= new GenericTypeCompletion({
      complete: (type, operation) => this.#complete(type, operation),
      work: operation => this.#genericOperation(operation),
      instantiate: (definition, arguments_) => this.#intern(definition, arguments_),
      element: (kind, element, rank) => this.constructElement(kind, element, rank),
      functionPointer: signature => this.functionPointer(signature),
      intrinsic: name => this.intrinsic(name),
      publish: (type, state, operation) => this.#publish(type, state, operation),
    }, this.#maxDepth);
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
      const resolution = this.#resolveExternal?.({ module, assemblyName, namespace, name, signal: operation.signal,
        resolveType: (targetModule, targetToken) => this.#load(targetModule, targetToken, { ...nested, identityOnly: false, rootResult: false }) });
      const external = await (operation.root.contextOwnedBindings
        ? awaitContextBinding(Promise.resolve(resolution), operation.signal) : resolution);
      checkCancellation(operation.signal);
      if (external != null) {
        if (!(external instanceof TypeDesc) || !external.isLoaded) throw fail('External resolver must return a loaded TypeDesc');
        if (external.fullName !== fullName) throw fail(`External type resolver returned ${external.fullName} for ${fullName}`);
        if (operation.root.contextOwnedBindings) this.#genericOperation(operation).observe(external);
        return operation.identityOnly ? external : this.#complete(external, operation);
      }
      target = (await this.#assemblyReference(module.assembly, rid, operation)).manifestModule;
    } else if (tag !== 0 || rid !== 1) throw fail('ModuleRef and null-scoped TypeRef resolution require a later loader batch');
    return this.#find(target, targetName, nested);
  }

  #assemblyReference(assembly, index, operation) {
    this.#checkOperation(operation);
    if (!operation.root.contextOwnedBindings) return assembly.resolveReference(index, operation);
    return awaitContextBinding(assembly.resolveReference(index), operation.signal);
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
    const owner = module.assembly.loadContext;
    if (owner !== this.#context) return owner.types.#resolveArrayMember(module, token, options);
    const operation = this.#operation(options.signal, copyResolutionContext(options));
    return this.#finish(operation, async () => {
      if (!Number.isInteger(token) || token < 0 || token > 0xffffffff || token >>> 24 !== 10) throw fail('Expected MemberRef token');
      const [parent, name, blob] = module.row(token);
      if ((parent & 7) !== 4) throw fail('Array MemberRef must be scoped by TypeSpec');
      const type = await this.#load(module, 0x1b000000 + (parent >>> 3), operation);
      const signature = decodeSignature(module.blob(blob));
      if (signature.kind !== 'method' || !signature.hasThis || signature.explicitThis || signature.callingConvention !== 0 ||
          signature.genericArity || signature.sentinel !== -1) throw fail('Array member requires a default instance method signature');
      const returnType = await this.#typeSpecifications.signature(module, signature.returnType, operation);
      const parameters = [];
      for (const parameter of signature.parameters) parameters.push(await this.#typeSpecifications.signature(module, parameter, operation));
      return resolveArrayMethod(type, module.string(name), returnType, parameters);
    });
  }
}
