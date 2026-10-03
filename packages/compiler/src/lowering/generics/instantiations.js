/**
 * Monomorphization of user-defined generics (SF-A02-T02.6).
 *
 * The bytecode IR calls methods by number and has no type arguments at run time, so a generic class or method declared
 * in source runs as one image class or method per closed construction:
 *
 *   class Box<T> { T value; }       Box<int>, Box<string>   ->  image classes `Box{int}`, `Box{string}`
 *   static T Id<T>(T x)             Id<int>, Id<Box<int>>   ->  image methods `Id{int}`, `Id{Box{int}}`
 *
 * A generic body is bound once, over its type parameters. It is lowered once per construction under a substitution
 * (the *active map*): every type the translator maps is closed through it first, and every member it refers to is
 * looked up in the construction that the closed containing type names. Constructions are declared when code first
 * refers to them, so only what the program uses is generated, and statics are per construction as in .NET.
 *
 * Keys: the generator stores image records per *key*. The key of a non-generic symbol is its definition; the key of
 * a member of a generic class, or of a constructed generic method, is the interned `TypeInstance` / `MemberInstance`
 * of that construction (`keyOf`).
 */
import { TypeMap, TypeKind, SymbolKind, NamedTypeSymbol, ArrayTypeSymbol, TypeWithAnnotations, typeOf } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { containsTypeParameter } from '../../symbols/substitution.js';
import { DefinitionIds, typeKey, typeDepth, instantiationTypeName, instantiationMethodName } from './instantiation-names.js';

/** Constructions nested deeper than this come from a generic that instantiates itself with ever larger arguments. */
const MAX_TYPE_DEPTH = 12;
const MAX_INSTANCES = 4096;

/** A closed construction of a source generic class: `{definition, type, typeArguments, map, key, record}`. */
export class TypeInstance {
  constructor(type, key) {
    this.definition = type.originalDefinition;
    this.type = type;
    this.typeArguments = type.typeArguments.map(typeOf);
    this.map = type.typeMap;
    this.key = key;
    this.record = null;
    this.members = new Map();
  }
}

/** A member seen in a construction: a member of a `TypeInstance`, or a generic method with closed type arguments. */
export class MemberInstance {
  constructor(owner, definition, typeArguments, map) {
    this.owner = owner;
    this.definition = definition;
    this.typeArguments = typeArguments;
    this.map = map;
  }
  /** The image name of a constructed generic method; null for a member that is not a generic method. */
  get methodName() {
    return this.typeArguments ? instantiationMethodName(this.definition.name, this.typeArguments) : null;
  }
}

export class GenericInstantiations {
  /**
   * @param host the generator: `{isSource(symbol), unsupported(construct, syntax), declareTypeInstance(instance),
   *   declareMethodInstance(instance)}`
   */
  constructor(host) {
    this.host = host;
    this.active = TypeMap.empty;
    this.ids = new DefinitionIds();
    this.types = new Map();
    this.methods = new Map();
  }
  /** Runs `action` with `map` as the active substitution and restores the previous one afterwards. */
  withMap(map, action) {
    const saved = this.active;
    this.active = map ?? TypeMap.empty;
    try {
      return action();
    } finally {
      this.active = saved;
    }
  }
  /** True for a source class that is generic or nested in a generic class: it exists only as constructions. */
  isGenericClass(type) {
    return type instanceof NamedTypeSymbol && type.typeKind === TypeKind.Class && type.isGenericType && this.host.isSource(type);
  }
  /** True for a source method that has type parameters of its own. */
  isGenericMethod(method) {
    const definition = method.originalDefinition ?? method;
    return definition.kind === SymbolKind.Method && definition.typeParameters?.length > 0 && definition.methodKind !== MethodKind.LocalFunction;
  }
  /** True when the active substitution binds this type parameter. */
  binds(parameter) {
    return !!this.active.get(parameter);
  }
  /** True for a generic method seen outside a construction of it: there is nothing to declare or lower for it. */
  isOpenMethod(method) {
    const definition = method.originalDefinition ?? method;
    return this.isGenericMethod(definition) && !this.binds(definition.typeParameters[0]);
  }
  /** True for a generic function (method or local function) whose type parameters the active substitution does not bind. */
  isOpenFunction(function_) {
    const parameters = (function_.originalDefinition ?? function_).typeParameters;
    return parameters?.length > 0 && !this.binds(parameters[0]);
  }
  /** The identity of a list of closed type arguments. */
  argumentsKey(typeArguments) {
    return typeArguments.map(argument => typeKey(argument, this.ids)).join(';');
  }
  /** The image name of a method: its own name, or `Name{args}` for the construction of a generic method being declared. */
  methodNameOf(method) {
    const definition = method.originalDefinition ?? method;
    if (!this.isGenericMethod(definition) || !this.host.isSource(definition)) return method.name;
    return instantiationMethodName(
      definition.name,
      definition.typeParameters.map(parameter => this.closed(parameter, definition.locations?.[0])),
    );
  }
  /** `type` with the active substitution applied. */
  close(type) {
    type = typeOf(type);
    if (!type || this.active.isEmpty) return type;
    const closed = typeOf(this.active.substituteType(type));
    return closed === type ? type : this.registryForm(closed);
  }
  /**
   * Substitution builds a plain construction; a framework generic that the registry lists closed (`Task<int>`) is
   * replaced by the registry's own symbol for it, which is the one that has an image type name and contracts.
   */
  registryForm(type) {
    if (type instanceof ArrayTypeSymbol) {
      const element = this.registryForm(type.elementType);
      return element === type.elementType ? type : new ArrayTypeSymbol(element, type.rank, { isSZArray: type.isSZArray });
    }
    if (!(type instanceof NamedTypeSymbol) || !type.originalDefinition.arity) return type;
    const definition = type.originalDefinition,
      typeArguments = type.typeArguments.map(argument => this.registryForm(typeOf(argument)));
    const listed = definition.instanceProvider?.(
      definition,
      typeArguments.map(argument => new TypeWithAnnotations(argument)),
    );
    return listed ?? type;
  }
  /** `type` closed; a type parameter that nothing binds is reported as not executable. */
  closed(type, syntax = null) {
    const result = this.close(type);
    if (containsTypeParameter(result)) this.host.unsupported('user-defined generics', syntax);
    return result;
  }
  /** The construction a closed (or closable) generic class type names, declared on first use. */
  instanceOf(type, syntax = null) {
    const closed = this.closed(type, syntax),
      key = typeKey(closed, this.ids);
    let instance = this.types.get(key);
    if (instance) return instance;
    if (typeDepth(closed) > MAX_TYPE_DEPTH || this.types.size >= MAX_INSTANCES)
      this.host.unsupported('a generic instantiation that does not terminate', syntax ?? closed.locations?.[0]);
    instance = new TypeInstance(closed, key);
    instance.name = instantiationTypeName(closed);
    // Registered before it is declared: a generic class may mention its own construction (`Node<T> next`).
    this.types.set(key, instance);
    this.host.declareTypeInstance(instance);
    return instance;
  }
  /**
   * The key the generator stores the image record of `symbol` under: the definition, or for a member of a generic
   * class and for a constructed generic method the interned instance. Declares the construction on first use.
   */
  keyOf(symbol, syntax = null) {
    if (symbol instanceof TypeInstance || symbol instanceof MemberInstance) return symbol;
    const definition = symbol.originalDefinition ?? symbol;
    if (symbol.kind === SymbolKind.NamedType) return this.isGenericClass(symbol) ? this.instanceOf(symbol, syntax) : definition;
    if (definition.methodKind === MethodKind.LocalFunction || definition.methodKind === MethodKind.AnonymousFunction) return definition;
    const container = symbol.containingType ?? null,
      owner = container && this.isGenericClass(container) ? this.instanceOf(container, syntax) : null,
      generic = this.host.isSource(definition) && this.isGenericMethod(definition);
    if (!owner && !generic) return definition;
    const typeArguments = generic ? symbol.typeArguments.map(argument => this.closed(argument, syntax)) : null;
    return this.memberInstance(owner, definition, typeArguments, syntax);
  }
  memberInstance(owner, definition, typeArguments, syntax) {
    const table = owner ? owner.members : this.methods,
      key = this.ids.of(definition) + (typeArguments ? '{' + typeArguments.map(argument => typeKey(argument, this.ids)).join(';') + '}' : '');
    let instance = table.get(key);
    if (instance) return instance;
    if (typeArguments?.some(argument => typeDepth(argument) > MAX_TYPE_DEPTH) || this.methods.size >= MAX_INSTANCES)
      this.host.unsupported('a generic instantiation that does not terminate', syntax ?? definition.locations?.[0]);
    const base = owner?.map ?? TypeMap.empty,
      map = typeArguments ? base.with(definition.typeParameters, typeArguments) : base;
    instance = new MemberInstance(owner, definition, typeArguments, map);
    table.set(key, instance);
    if (typeArguments) this.host.declareMethodInstance(instance);
    return instance;
  }
  /** What a key stands for: `{definition, map}`, the symbol whose body is lowered and the substitution to lower it under. */
  describe(key) {
    if (key instanceof MemberInstance || key instanceof TypeInstance) return { definition: key.definition, map: key.map };
    return { definition: key, map: TypeMap.empty };
  }
}

/**
 * A table of image records per symbol that resolves every symbol to its key first (`GenericInstantiations.keyOf`), so
 * that a lookup made while a generic body is lowered finds the record of the construction being lowered.
 */
export class InstantiationTable {
  /** @param {GenericInstantiations} generics */
  constructor(generics) {
    this.generics = generics;
    this.records = new Map();
  }
  get(symbol) {
    return this.records.get(this.generics.keyOf(symbol));
  }
  has(symbol) {
    return this.records.has(this.generics.keyOf(symbol));
  }
  set(symbol, record) {
    this.records.set(this.generics.keyOf(symbol), record);
    return this;
  }
  /** `[key, record]` pairs in insertion order; entries added while iterating are visited too. */
  [Symbol.iterator]() {
    return this.records[Symbol.iterator]();
  }
}
