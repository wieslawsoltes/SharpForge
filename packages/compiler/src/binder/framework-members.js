/**
 * Framework member lookup and overload selection over symbols (SF-A02-T19).
 *
 * The execution binder asks this class for the methods, constructors, properties, indexers and events of framework
 * types. Candidates are the member symbols the registry bridge exposes (symbols/registry-bridge.js); the choice
 * among overloads is made by `OverloadResolver` with the conversions of the execution profile
 * (conversions/execution-profile.js). The registry's own lookup functions are not consulted.
 *
 * A selected method symbol carries `contract`, the registry entry code generation needs for the ABI call.
 */
import { canonicalType } from '@sharpforge/framework';
import { frameworkBridge } from '../symbols/registry-bridge.js';
import { CoreTypes } from '../symbols/core-types.js';
import { MethodKind } from '../symbols/members.js';
import { TypeKind } from '../symbols/types.js';
import { OverloadResolver } from '../overload/resolution.js';
import { ExecutionProfileConversions, hasNaturalType } from '../conversions/execution-profile.js';

const maximumBaseDepth = 64;
const sharedStates = new WeakMap();
const delegateGroups = new WeakMap();
const noMethods = Object.freeze([]);

/**
 * Overload resolution of the execution profile: an argument without a natural type (the null literal, a method
 * group, a target-typed expression, an erroneous expression) gives no candidate an advantage, so a call that the
 * string-typed profile reported as ambiguous (CS0121) is still reported instead of silently picking an overload.
 */
class ExecutionProfileResolver extends OverloadResolver {
  betterConversion(arg, t1, c1, t2, c2) {
    return hasNaturalType(arg) ? super.betterConversion(arg, t1, c1, t2, c2) : 0;
  }
}

/**
 * What is derived from a bridge and shared by every compilation: the resolver, the method groups per
 * (owner type, name, static) and the resolutions per method group and argument types. The bridge's symbols are immutable
 * after creation, so none of it is ever invalidated; the keys only name registry types, so the caches are bounded
 * by the registry.
 */
function sharedStateFor(bridge) {
  let state = sharedStates.get(bridge);
  if (!state) {
    const core = new CoreTypes(bridge);
    state = {
      resolver: new ExecutionProfileResolver(new ExecutionProfileConversions(core), core),
      groups: new WeakMap(),
      constructors: new WeakMap(),
      resolutions: new WeakMap(),
    };
    sharedStates.set(bridge, state);
  }
  return state;
}

export class FrameworkMembers {
  /**
   * @param {object} [options] `bridge`: the registry bridge; `typeOf(name)`: the TypeSymbol of a legacy type name
   *   (defaults to the bridge's types, which is enough when no user type is involved).
   */
  constructor({ bridge = frameworkBridge(), typeOf = null } = {}) {
    this.bridge = bridge;
    this.typeOf = typeOf ?? (name => bridge.typeFromName(name));
    this.shared = sharedStateFor(bridge);
    this.resolver = this.shared.resolver;
    this.ownerTypes = new Map();
    /** Called with `{ kind, name, candidates, result }` after every overload resolution; for tests and tracing. */
    this.observer = null;
  }

  get conversions() {
    return this.resolver.conversions;
  }

  /** The symbol of the registry type a legacy type name stands for, or null when the name is not a registry type. */
  type(name) {
    if (typeof name !== 'string') return null;
    // Per compilation: the names include the program's own type names, which must not outlive it.
    let type = this.ownerTypes.get(name);
    if (type === undefined) {
      const canonical = canonicalType(name);
      type = this.bridge.types.has(canonical) ? this.bridge.typeFromName(canonical) : null;
      this.ownerTypes.set(name, type);
    }
    return type;
  }

  /**
   * The registry-backed method symbols called `name` on a framework type and its base types, most derived first.
   * The same (frozen) array is returned for the same question, so it can key further caches.
   * @param {string} owner legacy or registry type name  @param {boolean} [isStatic] undefined matches both
   */
  methods(owner, name, isStatic) {
    const type = this.type(owner);
    if (!type) return noMethods;
    let groups = this.shared.groups.get(type);
    if (!groups) this.shared.groups.set(type, (groups = new Map()));
    const key = isStatic === undefined ? name : isStatic ? name + '\u0001' : name + '\u0002',
      cached = groups.get(key);
    if (cached) return cached;
    const found = [];
    for (let current = type, depth = 0; current && depth < maximumBaseDepth; current = current.baseType, depth++) {
      for (const member of current.getMembers(name)) {
        if (member.kind === 'Method' && member.contract && (isStatic === undefined || member.isStatic === isStatic)) found.push(member);
      }
    }
    const group = found.length ? Object.freeze(found) : noMethods;
    groups.set(key, group);
    return group;
  }

  /** The first method called `name` (accessors and other members that are not overloaded), or null. */
  method(owner, name, isStatic) {
    return this.methods(owner, name, isStatic)[0] ?? null;
  }

  /** The accessors of a property seen from `owner`: the nearest getter and the nearest setter, or null when neither exists. */
  property(owner, name, isStatic) {
    const getter = this.method(owner, 'get_' + name, isStatic),
      setter = this.method(owner, 'set_' + name, isStatic);
    return getter || setter ? { getter, setter } : null;
  }

  /** The accessors of the indexer of a framework type, or null. */
  indexer(owner) {
    return this.property(owner, 'Item', false);
  }

  /** The instance constructors declared by the type itself. */
  constructors(owner) {
    const type = this.type(owner);
    if (!type) return noMethods;
    const cached = this.shared.constructors.get(type);
    if (cached) return cached;
    const found = type.getMembers('.ctor').filter(member => member.methodKind === MethodKind.Constructor && member.contract),
      group = found.length ? Object.freeze(found) : noMethods;
    this.shared.constructors.set(type, group);
    return group;
  }

  /**
   * The cache key of a call whose arguments are all registry types or the null literal; null when an argument is
   * target-typed or of a type declared by the program (such calls are resolved every time).
   */
  resolutionKey(args) {
    let key = '';
    for (const arg of args) {
      if (arg.form) return null;
      if (arg.literal === 'null') key += '\u0001';
      else {
        const name = arg.type ? this.bridge.registryName(arg.type) : null;
        if (!name) return null;
        key += '\u0002' + name;
      }
    }
    return key;
  }

  /** True when a candidate of the group takes a delegate (its method-group arguments then need the exact-return rule). */
  hasDelegateParameters(group) {
    let known = delegateGroups.get(group);
    if (known === undefined) {
      known = group.some(method => method.parameters.some(parameter => parameter.type.typeKind === TypeKind.Delegate));
      delegateGroups.set(group, known);
    }
    return known;
  }

  /** The add or remove accessor of an event. */
  eventAccessor(owner, name, isAddition) {
    return this.method(owner, (isAddition ? 'add_' : 'remove_') + name, false);
  }

  /**
   * Resolves a call among candidate symbols.
   * @param {MethodSymbol[]} candidates  @param {object[]} args resolver arguments (see overload/resolution.js)
   * @param {{name?:string,isConstructor?:boolean}} [options]
   * @returns the `OverloadResolver.resolve` result (shared and read-only when it came from the cache)
   */
  resolve(candidates, args, options = {}) {
    const key = Object.isFrozen(candidates) ? this.resolutionKey(args) : null;
    let results = key === null ? null : this.shared.resolutions.get(candidates),
      result = results?.get(key);
    if (!result) {
      result = this.resolver.resolve(candidates, args, { ...options, keepBaseCandidates: true });
      if (key !== null) {
        if (!results) this.shared.resolutions.set(candidates, (results = new Map()));
        results.set(key, result);
      }
    }
    this.observer?.({ kind: options.isConstructor ? 'constructor' : 'method', name: options.name ?? null, candidates, result });
    return result;
  }

  /**
   * The static method called `name` that overload resolution selects for arguments of exactly these types and
   * whose first parameter has the first argument's type (operator-like members: `Vector.Add`, `Async.Await`).
   * @param {TypeSymbol[]} argumentTypes  @returns {MethodSymbol|null}
   */
  exactStaticMethod(owner, name, argumentTypes) {
    const args = argumentTypes.map(type => ({ type })),
      result = this.resolve(this.methods(owner, name, true), args, { name });
    return result.succeeded && result.conversions[0]?.isIdentity ? result.method : null;
  }
}

let shared = null;
/** Framework members over the live registry for callers that only deal with framework types (operator classification). */
export function frameworkMembers() {
  return (shared ??= new FrameworkMembers());
}
