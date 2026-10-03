/**
 * Open members of registry generics (SF-A02-T02).
 *
 * The framework registry lists closed instantiations only: `List<int>`, `List<string>`, `List<object>`, each with its
 * own contracts. The definition `List<T>` has no members of its own, so `List<T>` inside a generic body and
 * `List<Animal>` could not be bound. This module derives the open signatures from the registry itself, by
 * anti-unifying the contracts of two instantiations whose type arguments differ:
 *
 *   List<object>.Insert(int, object)   +   List<int>.Insert(int, int)        ->  List<T>.Insert(int, T)
 *   Dictionary<string, object>.Keys : string[]  +  Dictionary<int, int>.Keys : int[]  ->  Dictionary<T1, T2>.Keys : T1[]
 *
 * A position is a type parameter only where the two contracts show exactly the two type arguments; a position that
 * cannot be explained drops the member. Each open member carries `openContract`, the key that finds the contract of
 * an instantiation again (`contractOfInstance`). Code generation never calls an open member: it closes the receiver
 * type and calls the contract of the registry instantiation, or reports the contract the registry lacks.
 */
import {registryMethodModifiers} from './registry-contracts.js';
import { ArrayTypeSymbol, ConstructedNamedTypeSymbol, TypeWithAnnotations, TypeKind, Accessibility } from './types.js';
import { MethodSymbol, PropertySymbol, ParameterSymbol, MethodKind, DeclarationModifiers } from './members.js';

const accessorKinds = Object.freeze({ get: MethodKind.PropertyGet, set: MethodKind.PropertySet });

/** Splits "A.B.Name`2<x, y<z>>" into `{path, args}`; a name without type arguments has none. */
function parseName(name) {
  const open = name.indexOf('<');
  if (open < 0 || !name.endsWith('>')) return { path: name, args: [] };
  const args = [];
  let depth = 0,
    start = open + 1;
  for (let i = open + 1; i < name.length - 1; i++) {
    const c = name[i];
    if (c === '<') depth++;
    else if (c === '>') depth--;
    else if (c === ',' && depth === 0) {
      args.push(name.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(name.slice(start, -1).trim());
  return { path: name.slice(0, open), args };
}

const keyedByBridge = new WeakMap();

/** The contracts of a registry type keyed by what identifies a member across instantiations. */
function keyedContracts(bridge, registryName) {
  let cache = keyedByBridge.get(bridge);
  if (!cache) keyedByBridge.set(bridge, (cache = new Map()));
  let keyed = cache.get(registryName);
  if (keyed) return keyed;
  keyed = new Map();
  cache.set(registryName, keyed);
  const seen = new Map();
  for (const contract of bridge.byOwner.get(registryName) ?? []) {
    const shape = `${contract.kind}|${contract.name}|${contract.isStatic ? 's' : 'i'}|${contract.parameters.length}`,
      occurrence = seen.get(shape) ?? 0;
    seen.set(shape, occurrence + 1);
    keyed.set(`${shape}|${occurrence}`, contract);
  }
  return keyed;
}

/** Two instantiations whose arguments differ at every position, with a distinct pair of arguments per position. */
function referencePair(instances) {
  for (const first of instances) {
    for (const second of instances) {
      const pairs = first.args.map((argument, i) => argument + '\u0001' + second.args[i]);
      if (first.args.every((argument, i) => argument !== second.args[i]) && new Set(pairs).size === pairs.length) return [first, second];
    }
  }
  return null;
}

class OpenSignatures {
  constructor(bridge, definition, first, second) {
    this.bridge = bridge;
    this.definition = definition;
    this.first = first;
    this.second = second;
  }
  /** The open type two registry type names stand for, or null when they cannot be explained by the type arguments. */
  type(a, b) {
    if (a === b) return this.bridge.typeFromName(a);
    const parameter = this.first.args.findIndex((argument, i) => argument === a && this.second.args[i] === b);
    if (parameter >= 0) return this.definition.typeParameters[parameter];
    if (a.endsWith('[]') && b.endsWith('[]')) {
      const element = this.type(a.slice(0, -2), b.slice(0, -2));
      return element ? new ArrayTypeSymbol(element, 1, { baseType: () => this.bridge.typeProvider.getCoreType('System_Array') }) : null;
    }
    const left = parseName(a),
      right = parseName(b);
    if (!left.args.length || left.path !== right.path || left.args.length !== right.args.length) return null;
    const generic = this.bridge.typeFromName(a)?.originalDefinition;
    if (!generic || generic.arity !== left.args.length) return null;
    const typeArguments = left.args.map((argument, i) => this.type(argument, right.args[i]));
    if (typeArguments.some(argument => !argument)) return null;
    if (generic === this.definition && typeArguments.every((argument, i) => argument === generic.typeParameters[i])) return generic;
    return new ConstructedNamedTypeSymbol(
      generic,
      typeArguments.map(argument => new TypeWithAnnotations(argument)),
    );
  }
  /** `{parameters, result}` as open types, or null. */
  signature(a, b) {
    if (a.name !== b.name || a.kind !== b.kind || a.parameters.length !== b.parameters.length) return null;
    const parameters = a.parameters.map((parameter, i) => this.type(parameter, b.parameters[i])),
      result = a.kind === 'constructor' ? this.bridge.byName.get('void') : this.type(a.result, b.result);
    return result && parameters.every(Boolean) ? { parameters, result } : null;
  }
}

function methodSymbol(owner, contract, signature, key, methodKind) {
  const method = new MethodSymbol({
    name: contract.name,
    methodKind,
    declaredAccessibility: Accessibility.Public,
    containingSymbol: owner,
    returnType: signature.result,
    parameters: signature.parameters.map((type, ordinal) => new ParameterSymbol({ name: 'arg' + ordinal, type, ordinal })),
    modifiers: registryMethodModifiers(contract, owner),
  });
  method.openContract = key;
  return method;
}

function indexerOf(owner, getter, setters) {
  const setter =
    setters.find(
      candidate =>
        candidate.parameters.length === getter.parameters.length + 1 &&
        getter.parameters.every((parameter, i) => parameter.type.equals(candidate.parameters[i].type)),
    ) ?? null;
  const indexer = new PropertySymbol({
    name: 'this[]',
    type: getter.returnType,
    declaredAccessibility: Accessibility.Public,
    containingSymbol: owner,
    parameters: getter.parameters.map((parameter, ordinal) => new ParameterSymbol({ name: parameter.name, type: parameter.type, ordinal })),
  });
  indexer.getMethod = getter;
  indexer.setMethod = setter;
  return indexer;
}

/**
 * The open members of a registry generic definition; empty when the registry lists fewer than two usable
 * instantiations of it.
 * @param bridge the registry bridge  @param definition the open definition (`definition.instances` are the listed ones)
 */
export function openMembersOf(bridge, definition) {
  const instances = (definition.instances ?? []).map(type => ({ type, name: type.registryName, args: parseName(type.registryName).args }));
  const pair = referencePair(instances);
  if (!pair || definition.typeKind === TypeKind.Delegate) return [];
  const [first, second] = pair,
    open = new OpenSignatures(bridge, definition, first, second),
    others = keyedContracts(bridge, second.name),
    members = [],
    properties = new Map();
  for (const [key, contract] of keyedContracts(bridge, first.name)) {
    const other = others.get(key),
      signature = other ? open.signature(contract, other) : null;
    if (!signature || contract.kind === 'eventAdd' || contract.kind === 'eventRemove') continue;
    if (contract.kind === 'constructor') members.push(methodSymbol(definition, contract, signature, key, MethodKind.Constructor));
    else if (contract.kind === 'get' || contract.kind === 'set') {
      const property = properties.get(contract.property) ?? { isStatic: contract.isStatic };
      property[contract.kind] = methodSymbol(definition, contract, signature, key, accessorKinds[contract.kind]);
      properties.set(contract.property, property);
    } else members.push(methodSymbol(definition, contract, signature, key, MethodKind.Ordinary));
  }
  for (const [name, property] of properties) {
    members.push(
      new PropertySymbol({
        name,
        type: property.get?.returnType ?? property.set.parameters[0].type,
        getMethod: property.get ?? null,
        setMethod: property.set ?? null,
        declaredAccessibility: Accessibility.Public,
        containingSymbol: definition,
        modifiers: property.isStatic ? DeclarationModifiers.Static : 0,
      }),
      ...[property.get, property.set].filter(Boolean),
    );
  }
  const setters = members.filter(member => member.kind === 'Method' && member.name === 'set_Item' && !member.isStatic);
  for (const getter of members.filter(member => member.kind === 'Method' && member.name === 'get_Item' && !member.isStatic)) {
    members.push(indexerOf(definition, getter, setters));
  }
  return members;
}

/**
 * Gives a registry generic definition its open members, next to whatever the core library declares for it. Members
 * are derived on first use, because the registry instantiations of a definition are declared one after another.
 */
export function attachOpenMembers(bridge, definition) {
  if (definition.hasOpenMembers) return;
  definition.hasOpenMembers = true;
  const declared = definition._members;
  definition._members = () => {
    const own = typeof declared === 'function' ? declared() : declared,
      names = new Set(own.map(member => member.name));
    return [...own, ...openMembersOf(bridge, definition).filter(member => !names.has(member.name))];
  };
}

/**
 * The contract of a registry instantiation an open member stands for, as the instantiation's own member symbol.
 * @param bridge the registry bridge  @param member a member of an open definition or of a construction of it
 * @param instance a registry instantiation (`RegistryConstructedType`)
 * @returns the method symbol carrying `contract`, or null when the instantiation does not list it
 */
export function contractOfInstance(bridge, member, instance) {
  const key = (member.originalDefinition ?? member).openContract;
  if (!key || !instance?.registryName) return null;
  const contract = keyedContracts(bridge, instance.registryName).get(key);
  return contract ? bridge.symbolForContract(contract) : null;
}
