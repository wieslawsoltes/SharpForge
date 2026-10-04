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
import { containsTypeParameter, allTypeParameters, typeMapOf } from '../../symbols/substitution.js';
import { DefinitionIds, typeKey, typeDepth, instantiationTypeName, instantiationMethodName } from './instantiation-names.js';
import { provenGrowth } from './instantiation-growth.js';

/**
 * Resource limits for a growth that could not be proved (instantiation-growth.js): constructions nested deeper than
 * this, or more of them than this, are taken to come from a generic that instantiates itself without end.
 */
const MAX_TYPE_DEPTH = 64;
const MAX_INSTANCES = 4096;
const endless = 'a generic instantiation that does not terminate';

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
    // Who asked for this construction first, and with which arguments as written (instantiation-growth.js).
    this.parent = null;
    this.openMap = null;
  }
}

/** A member seen in a construction: a member of a `TypeInstance`, or a generic method with closed type arguments. */
export class MemberInstance {
  constructor(owner, definition, typeArguments, map) {
    this.owner = owner;
    this.definition = definition;
    this.typeArguments = typeArguments;
    this.map = map;
    this.parent = null;
    this.openMap = null;
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
    // True while the fields of a construction are declared: its methods wait until code refers to them.
    this.deferMethods = false;
    this.ids = new DefinitionIds();
    this.plain = new Map();
    this.types = new Map();
    this.methods = new Map();
    // The construction each substitution belongs to, and the nesting of requests whose target depends on a closed type.
    this.contexts = new Map();
    this.opaque = 0;
  }
  /** The construction whose code is being declared or lowered, or null outside generic code. */
  get current() {
    return this.contexts.get(this.active) ?? null;
  }
  /** Runs `action`; constructions it asks for were chosen from a closed type, so their arguments are not known as written. */
  withClosedTarget(action) {
    this.opaque++;
    try {
      return action();
    } finally {
      this.opaque--;
    }
  }
  /**
   * The type arguments of a requested construction as written, over the type parameters of the construction being
   * lowered; null when they are not known to be independent of its closed arguments.
   */
  openMapOf(mentions, build) {
    if (!this.current) return TypeMap.empty;
    return this.opaque === 0 && mentions.some(type => containsTypeParameter(type)) ? build() : null;
  }
  /** Links a new construction to the one that asked for it and refuses a cycle that provably grows. */
  adopt(instance, parameters, openMap, syntax) {
    instance.parent = this.current;
    instance.openMap = openMap;
    this.contexts.set(instance.map, instance);
    const growing = instance.parent ? provenGrowth(instance.definition, parameters, openMap, instance.parent) : null;
    if (!growing) return;
    const name = instance.definition.toDisplayString(),
      detail = `'${name}' instantiates itself with '${growing.term.toDisplayString()}' for '${growing.parameter.name}'`;
    this.host.unsupported(`${endless} (${detail}; .NET creates such constructions at run time)`, syntax ?? instance.definition.locations?.[0]);
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
    return type instanceof NamedTypeSymbol && [TypeKind.Class, TypeKind.Struct, TypeKind.Interface].includes(type.typeKind) &&
      type.isGenericType && this.host.isSource(type);
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
    if (typeDepth(closed) > MAX_TYPE_DEPTH || this.types.size >= MAX_INSTANCES) this.host.unsupported(endless, syntax ?? closed.locations?.[0]);
    instance = new TypeInstance(closed, key);
    instance.name = instantiationTypeName(closed);
    // Registered before it is declared: a generic class may mention its own construction (`Node<T> next`).
    this.types.set(key, instance);
    this.adopt(
      instance,
      allTypeParameters(closed),
      this.openMapOf([type], () => typeMapOf(typeOf(type))),
      syntax,
    );
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
    // Most symbols have nothing generic about them; that is decided once per definition.
    let plain = this.plain.get(definition);
    if (plain === undefined) {
      plain = this.isPlain(definition);
      this.plain.set(definition, plain);
    }
    if (plain) return definition;
    if (symbol.kind === SymbolKind.NamedType) return this.instanceOf(symbol, syntax);
    const container = symbol.containingType ?? null,
      owner = container && this.isGenericClass(container) ? this.instanceOf(container, syntax) : null,
      generic = this.host.isSource(definition) && this.isGenericMethod(definition);
    if (!owner && !generic) return definition;
    const typeArguments = generic ? symbol.typeArguments.map(argument => this.closed(argument, syntax)) : null;
    return this.memberInstance(owner, definition, typeArguments, syntax, symbol);
  }
  /** The open map of a member as written at the place that refers to it: its containing construction and its own type arguments. */
  openMapOfMember(symbol, definition, isGeneric) {
    const container = symbol.containingType ?? null,
      written = isGeneric ? symbol.typeArguments.map(typeOf) : [];
    return this.openMapOf([...(container ? [container] : []), ...written], () => {
      const outer = container ? typeMapOf(container) : TypeMap.empty;
      return isGeneric ? outer.with(definition.typeParameters, written) : outer;
    });
  }
  /** True for a definition whose key is itself: neither a generic class, nor a member of one, nor a generic method. */
  isPlain(definition) {
    if (definition.kind === SymbolKind.NamedType) return !this.isGenericClass(definition);
    if (definition.methodKind === MethodKind.LocalFunction || definition.methodKind === MethodKind.AnonymousFunction) return true;
    const container = definition.containingType ?? null;
    if (container && this.isGenericClass(container)) return false;
    return !(this.host.isSource(definition) && this.isGenericMethod(definition));
  }
  memberInstance(owner, definition, typeArguments, syntax, written = null) {
    const table = owner ? owner.members : this.methods,
      key = this.ids.of(definition) + (typeArguments ? '{' + typeArguments.map(argument => typeKey(argument, this.ids)).join(';') + '}' : '');
    let instance = table.get(key);
    if (instance) return instance;
    if (typeArguments?.some(argument => typeDepth(argument) > MAX_TYPE_DEPTH) || this.methods.size >= MAX_INSTANCES)
      this.host.unsupported(endless, syntax ?? definition.locations?.[0]);
    // A substitution of its own, also for a member without type arguments: the substitution identifies the construction.
    const map = (owner?.map ?? TypeMap.empty).with(typeArguments ? definition.typeParameters : [], typeArguments ?? []);
    instance = new MemberInstance(owner, definition, typeArguments, map);
    table.set(key, instance);
    const parameters = [...(owner ? allTypeParameters(owner.type) : []), ...(typeArguments ? definition.typeParameters : [])];
    this.adopt(instance, parameters, written ? this.openMapOfMember(written, definition, !!typeArguments) : null, syntax);
    // Methods are declared when code first refers to them: declaring every method of a construction with the class
    // would never end for a signature that mentions a larger construction (`Box<Box<T>> Wrap()`).
    if (definition.kind === SymbolKind.Method) this.host.declareMethodInstance(instance);
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
