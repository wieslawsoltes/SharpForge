/**
 * Constructor chaining and initialisation order (SF-A02-T03.4, C# spec 15.11).
 *
 * Every instance constructor starts with exactly one of: `this(...)` (another constructor of the same type),
 * `base(...)` (explicit), or the implicit `base()`. `constructorInitializerKind` classifies it, `checkImplicitBaseCall`
 * reports a missing accessible parameterless base constructor (CS7036 / CS1729 / CS0122) and `checkConstructorCycles`
 * the `this(...)` cycles (CS0516 for a direct self call, CS0768 for longer cycles).
 * `initializationOrder` is the sequence .NET executes for `new T(...)`:
 *   static: static field initializers in textual order, then the static constructor body (once, before first use;
 *           `beforeFieldInit` when there is no explicit static constructor);
 *   instance: field and auto-property initializers of the most derived type in textual order, then the base
 *           constructor (which does the same for its type), then the constructor body - a constructor that chains
 *           with `this(...)` runs no initializers itself.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { isAccessible } from './accessibility.js';

/** 'this' | 'base' | 'implicitBase' | 'none' (object, static constructors, structs without initializer). */
export function constructorInitializerKind(ctor, type) {
  if (ctor.methodKind !== MethodKind.Constructor) return 'none';
  const init = ctor.initializerSyntax;
  if (init) return init.kind === 'ThisConstructorInitializer' ? 'this' : 'base';
  if (type.typeKind !== TypeKind.Class || !type.baseType || type.specialType === 'System_Object') return 'none';
  return 'implicitBase';
}
const instanceConstructors = type =>
  type.getMembers('.ctor').filter(m => m.kind === SymbolKind.Method && m.methodKind === MethodKind.Constructor);
/**
 * The implicit `base()` call of a constructor (or of the implicit default constructor) needs an accessible
 * parameterless - or all-optional / params - base constructor.
 * @returns {null|{code,args}}
 */
export function checkImplicitBaseCall(type, resolver) {
  const base = type.baseType;
  if (!base || type.typeKind !== TypeKind.Class || base.isErrorType?.()) return null;
  const ctors = instanceConstructors(base);
  if (!ctors.length) return null;
  const accessible = ctors.filter(c =>
    isAccessible(c.originalDefinition ?? c, type.originalDefinition, { throughType: type.originalDefinition }),
  );
  if (!accessible.length) return { code: DiagnosticId.CS0122, args: [ctors[0].toDisplayString()] };
  const result = resolver.resolve(accessible, [], { isConstructor: true });
  if (result.succeeded) return null;
  return result.error.code === DiagnosticId.CS1729 ? { code: DiagnosticId.CS1729, args: [base.toDisplayString(), 0] } : result.error;
}
/** `this(...)` cycles among the constructors of a type, given each constructor's resolved `this` target. @returns [{code,args,ctor}] */
export function checkConstructorCycles(type, targetOf) {
  const results = [];
  for (const ctor of instanceConstructors(type)) {
    const target = targetOf(ctor);
    if (!target) continue;
    if (target === ctor) {
      results.push({ code: DiagnosticId.CS0516, args: [ctor.toDisplayString()], ctor });
      continue;
    }
    const seen = new Set([ctor]);
    for (let c = target; c; c = targetOf(c)) {
      if (c === ctor) {
        // A cycle is reported once, on its last constructor in declaration order (as Roslyn does).
        const last = [...seen].every(other => (other.locations[0]?.start ?? 0) <= (ctor.locations[0]?.start ?? 0));
        if (last) results.push({ code: DiagnosticId.CS0768, args: [ctor.toDisplayString()], ctor });
        break;
      }
      if (seen.has(c)) break;
      seen.add(c);
    }
  }
  return results;
}
const textual = (a, b) =>
  (a.locations[0]?.uri ?? '').localeCompare(b.locations[0]?.uri ?? '') || (a.locations[0]?.start ?? 0) - (b.locations[0]?.start ?? 0);
/** Fields and auto-properties with initializers, in the order they run. */
export function initializers(type, isStatic) {
  return type
    .getMembers()
    .filter(
      m =>
        (m.kind === SymbolKind.Field || m.kind === SymbolKind.Property || m.kind === SymbolKind.Event) &&
        m.initializerSyntax &&
        !m.isConst &&
        m.isStatic === isStatic,
    )
    .sort(textual);
}
/**
 * The steps `new type(...)` through `ctor` executes, outermost type first resolved recursively.
 * @param {(ctor)=>MethodSymbol|null} chainedTo the constructor a `this(...)`/`base(...)` initializer (or implicit base()) resolves to
 * @returns {{kind:'initializer'|'baseCall'|'thisCall'|'body',symbol,type}[]}
 */
export function initializationOrder(type, ctor, chainedTo) {
  const steps = [],
    kind = constructorInitializerKind(ctor, type),
    target = chainedTo(ctor);
  if (kind === 'this') {
    steps.push({ kind: 'thisCall', symbol: target, type });
    if (target) steps.push(...initializationOrder(type, target, chainedTo));
  } else {
    for (const m of initializers(type, false)) steps.push({ kind: 'initializer', symbol: m, type });
    if (kind === 'base' || kind === 'implicitBase') {
      steps.push({ kind: 'baseCall', symbol: target, type: type.baseType });
      if (target && type.baseType?.isSource)
        steps.push(...initializationOrder(type.baseType.originalDefinition, target.originalDefinition ?? target, chainedTo));
    }
  }
  if (!ctor.isImplicitlyDeclared) steps.push({ kind: 'body', symbol: ctor, type });
  return steps;
}
/** Static initialisation of a type: initializers in textual order, then the static constructor. */
export function staticInitializationOrder(type) {
  const steps = initializers(type, true).map(m => ({ kind: 'initializer', symbol: m, type })),
    cctor = type.getMembers('.cctor').find(m => m.methodKind === MethodKind.StaticConstructor);
  if (cctor) steps.push({ kind: 'body', symbol: cctor, type });
  return steps;
}
/** beforefieldinit: static field initializers may run any time before first field access when there is no explicit static constructor. */
export function isBeforeFieldInit(type) {
  return !type.getMembers('.cctor').some(m => m.methodKind === MethodKind.StaticConstructor && !m.isImplicitlyDeclared);
}
