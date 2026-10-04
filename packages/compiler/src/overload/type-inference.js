/**
 * Method type inference (SF-A02-T02.4, C# spec 12.6.3): the two-phase algorithm.
 *
 * Phase 1 walks the arguments: an argument with a type contributes a lower-bound inference to its parameter type
 * (an exact inference for ref/out arguments); explicitly typed lambdas contribute their parameter types exactly.
 * Phase 2 repeatedly fixes the type parameters that no longer depend on unfixed ones and then makes output type
 * inferences from lambdas and method groups whose input types are now known, until everything is fixed or no
 * progress is possible (CS0411).
 * Fixing picks, among the candidate bounds, the unique type every other candidate converts to after discarding those
 * that violate an exact, lower or upper bound.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import {
  TypeKind,
  SymbolKind,
  NamedTypeSymbol,
  ArrayTypeSymbol,
  TypeParameterSymbol,
  TypeMap,
  TypeWithAnnotations,
  Variance,
  RefKind,
  typeOf,
} from '../symbols/types.js';
import { baseTypeChain, allInterfacesOf, containsTypeParameter } from '../symbols/substitution.js';
import { isNullableType } from '../conversions/nullable.js';
import { spanInferencePair } from '../conversions/span.js';

class Bounds {
  constructor() {
    this.exact = [];
    this.lower = [];
    this.upper = [];
    this.fixed = null;
  }
}
const add = (list, type) => {
  if (type && !type.isErrorType() && type.specialType !== 'System_Void' && !list.some(t => t.equals(type))) list.push(type);
};

/**
 * The inferred return type of an async lambda is `Task<X>`; when the delegate returns another generic task type
 * (`ValueTask<TOut>`) the result `X` is what `TOut` is inferred from (C# spec: inferred return type of an async
 * function against a task-like return type).
 */
function asyncResultFor(inferred, output) {
  const isGenericTask = type => type?.typeArguments?.length === 1 && type.containingNamespace?.name === 'Tasks';
  if (!isGenericTask(inferred) || inferred.name !== 'Task' || !isGenericTask(output) || output.name !== 'ValueTask') return inferred;
  return (output.originalDefinition ?? output).construct([inferred.typeArguments[0]]);
}

export class TypeInferrer {
  /**
   * @param {TypeParameterSymbol[]} typeParameters the method's type parameters
   * @param conversions a Conversions instance  @param core CoreTypes
   */
  constructor(typeParameters, conversions, core) {
    this.parameters = typeParameters;
    this.conversions = conversions;
    this.core = core;
    this.bounds = new Map(typeParameters.map(p => [p, new Bounds()]));
  }
  isUnfixed(type) {
    return type instanceof TypeParameterSymbol && this.bounds.has(type) && !this.bounds.get(type).fixed;
  }
  mentionsUnfixed(type) {
    return containsTypeParameter(
      type,
      this.parameters.filter(p => !this.bounds.get(p).fixed),
    );
  }
  get map() {
    const fixed = this.parameters.filter(p => this.bounds.get(p).fixed);
    return new TypeMap(
      fixed,
      fixed.map(p => this.bounds.get(p).fixed),
    );
  }
  substitute(type) {
    return typeOf(this.map.substituteType(type));
  }

  /** The element types of a C# 14 span inference from `u` to `v` (conversions/span.js), or null. */
  spanPair(u, v) {
    return this.conversions?.firstClassSpans ? spanInferencePair(u, v) : null;
  }
  exact(u, v) {
    u = typeOf(u);
    v = typeOf(v);
    if (!u || !v) return;
    if (this.isUnfixed(v)) {
      add(this.bounds.get(v).exact, u);
      return;
    }
    if (u instanceof ArrayTypeSymbol && v instanceof ArrayTypeSymbol && u.rank === v.rank) {
      this.exact(u.elementType, v.elementType);
      return;
    }
    if (isNullableType(u) && isNullableType(v)) {
      this.exact(u.nullableUnderlyingType, v.nullableUnderlyingType);
      return;
    }
    const span = this.spanPair(u, v);
    if (span) {
      this.exact(span.source, span.target);
      return;
    }
    if (
      u instanceof NamedTypeSymbol &&
      v instanceof NamedTypeSymbol &&
      u.originalDefinition === v.originalDefinition &&
      u.typeArguments.length === v.typeArguments.length
    ) {
      u.typeArguments.forEach((a, i) => this.exact(a.type, v.typeArguments[i].type));
      if (u.containingType && v.containingType) this.exact(u.containingType, v.containingType);
    }
  }
  lower(u, v) {
    u = typeOf(u);
    v = typeOf(v);
    if (!u || !v) return;
    if (this.isUnfixed(v)) {
      add(this.bounds.get(v).lower, u);
      return;
    }
    if (isNullableType(v) && isNullableType(u)) {
      this.lower(u.nullableUnderlyingType, v.nullableUnderlyingType);
      return;
    }
    // A non-nullable U still infers through V1? (C# 8+): int to T? gives T = int.
    if (isNullableType(v) && u.isValueType === true && !isNullableType(u)) {
      this.exact(u, v.nullableUnderlyingType);
      return;
    }
    const span = this.spanPair(u, v);
    if (span) {
      // To a Span<V1> the inference is exact; to a ReadOnlySpan<V1> it is a lower bound for a reference type.
      if (span.isSpanTarget || span.source.isReferenceType !== true) this.exact(span.source, span.target);
      else this.lower(span.source, span.target);
      return;
    }
    if (u instanceof ArrayTypeSymbol) {
      let element = null;
      if (v instanceof ArrayTypeSymbol && v.rank === u.rank) element = v.elementType;
      else if (
        u.isSZArray &&
        v instanceof NamedTypeSymbol &&
        v.typeArguments.length === 1 &&
        [
          this.core.ienumerableT,
          this.core.icollectionT,
          this.core.ilistT,
          this.core.ireadOnlyListT,
          this.core.ireadOnlyCollectionT,
        ].includes(v.originalDefinition)
      )
        element = v.typeArguments[0].type;
      if (element) {
        if (u.elementType.isReferenceType === true) this.lower(u.elementType, element);
        else this.exact(u.elementType, element);
        return;
      }
    }
    if ((v instanceof NamedTypeSymbol && v.typeArguments.length && !v.isDefinition) || (v instanceof NamedTypeSymbol && v.arity)) {
      const match = this.uniqueConstruction(u, v);
      if (!match) return;
      const definition = v.originalDefinition;
      definition.typeParameters.forEach((p, i) => {
        const a = match.typeArguments[i].type,
          b = v.typeArguments[i].type;
        if (a.isReferenceType !== true) this.exact(a, b);
        else if (p.variance === Variance.Out) this.lower(a, b);
        else if (p.variance === Variance.In) this.upper(a, b);
        else this.exact(a, b);
      });
    }
  }
  upper(u, v) {
    u = typeOf(u);
    v = typeOf(v);
    if (!u || !v) return;
    if (this.isUnfixed(v)) {
      add(this.bounds.get(v).upper, u);
      return;
    }
    if (u instanceof ArrayTypeSymbol && v instanceof ArrayTypeSymbol && u.rank === v.rank) {
      if (u.elementType.isReferenceType === true) this.upper(u.elementType, v.elementType);
      else this.exact(u.elementType, v.elementType);
      return;
    }
    if (isNullableType(u) && isNullableType(v)) {
      this.upper(u.nullableUnderlyingType, v.nullableUnderlyingType);
      return;
    }
    if (u instanceof NamedTypeSymbol && v instanceof NamedTypeSymbol && u.typeArguments.length) {
      const match = this.uniqueConstruction(v, u);
      if (!match || match.originalDefinition !== u.originalDefinition) return;
      u.originalDefinition.typeParameters.forEach((p, i) => {
        const a = u.typeArguments[i].type,
          b = match.typeArguments[i].type;
        if (a.isReferenceType !== true) this.exact(a, b);
        else if (p.variance === Variance.Out) this.upper(a, b);
        else if (p.variance === Variance.In) this.lower(a, b);
        else this.exact(a, b);
      });
    }
  }
  /** The unique construction of `v`'s definition among `u`, its base classes and its interfaces. */
  uniqueConstruction(u, v) {
    const definition = v.originalDefinition,
      found = [];
    for (const t of [...baseTypeChain(u, this.core), ...allInterfacesOf(u, this.core)])
      if (t instanceof NamedTypeSymbol && t.originalDefinition === definition && !found.some(x => x.equals(t))) found.push(t);
    return found.length === 1 ? found[0] : null;
  }
  /** Fixes one type parameter; returns false when its bounds are contradictory or empty. */
  fix(parameter) {
    const b = this.bounds.get(parameter);
    let candidates = [];
    for (const t of [...b.exact, ...b.lower, ...b.upper]) add(candidates, t);
    if (!candidates.length) return false;
    // The conversion from `dynamic` exists for expressions only: as a bound, `dynamic` converts to itself and `object`.
    const fromDynamic = (x, y) => x.typeKind === TypeKind.Dynamic && y.specialType !== 'System_Object';
    const implicit = (x, y) => x.equals(y) || (!fromDynamic(x, y) && this.conversions.classifyImplicit(x, y).exists);
    for (const e of b.exact) candidates = candidates.filter(c => c.equals(e));
    for (const l of b.lower) candidates = candidates.filter(c => implicit(l, c));
    for (const u of b.upper) candidates = candidates.filter(c => implicit(c, u));
    const best = candidates.filter(c => candidates.every(o => implicit(o, c)));
    if (best.length !== 1) return false;
    b.fixed = best[0];
    return true;
  }
  /**
   * Runs both phases.
   * @param {TypeSymbol[]} parameterTypes formal parameter types (open), one per argument
   * @param {object[]} args `{type, refKind, lambda?:{parameterTypes?:TypeSymbol[]|null, inferReturnType(parameterTypes):TypeSymbol|null},
   *   methodGroup?:{returnTypeFor(parameterTypes):TypeSymbol|null}}`
   * @returns {TypeSymbol[]|null} the inferred type arguments in type-parameter order, or null (CS0411)
   */
  infer(parameterTypes, args) {
    // Phase 1
    args.forEach((arg, i) => {
      const t = parameterTypes[i];
      if (!t) return;
      if (arg.lambda) {
        const invoke = delegateInvoke(t);
        if (invoke && arg.lambda.parameterTypes)
          arg.lambda.parameterTypes.forEach((p, k) => {
            if (invoke.parameters[k]) this.exact(p, invoke.parameters[k].type);
          });
        return;
      }
      if (!arg.type || arg.literal) return;
      if (arg.refKind && arg.refKind !== RefKind.None && arg.refKind !== 'none' && arg.refKind !== RefKind.In) this.exact(arg.type, t);
      else this.lower(arg.type, t);
    });
    // Phase 2
    for (let guard = 0; guard <= this.parameters.length * 2 + 2; guard++) {
      const unfixed = this.parameters.filter(p => !this.bounds.get(p).fixed);
      if (!unfixed.length) break;
      // Xi depends on Xj when Xj occurs in the input types of an argument whose output type mentions Xi.
      const dependsOnUnfixed = p =>
        args.some((arg, i) => {
          const io = this.inputOutput(arg, parameterTypes[i]);
          return io && containsTypeParameter(io.output, [p]) && io.inputs.some(t => this.mentionsUnfixed(t));
        });
      let ready = unfixed.filter(p => hasBounds(this.bounds.get(p)) && !dependsOnUnfixed(p));
      if (!ready.length) ready = unfixed.filter(p => hasBounds(this.bounds.get(p)));
      if (!ready.length) {
        if (!this.outputInferences(parameterTypes, args)) return null;
        continue;
      }
      for (const p of ready) if (!this.fix(p)) return null;
      this.outputInferences(parameterTypes, args);
    }
    if (this.parameters.some(p => !this.bounds.get(p).fixed)) return null;
    return this.parameters.map(p => this.bounds.get(p).fixed);
  }
  inputOutput(arg, parameterType) {
    if (!arg.lambda && !arg.methodGroup) return null;
    const invoke = delegateInvoke(parameterType);
    if (!invoke) return null;
    return { inputs: invoke.parameters.map(p => p.type), output: invoke.returnType };
  }
  /** Output type inferences from lambdas and method groups whose delegate input types are fully fixed. Returns true when a bound was added. */
  outputInferences(parameterTypes, args) {
    let progress = false;
    args.forEach((arg, i) => {
      const io = this.inputOutput(arg, parameterTypes[i]);
      if (!io || arg.outputDone) return;
      if (io.inputs.some(t => this.mentionsUnfixed(t)) || !this.mentionsUnfixed(io.output)) return;
      const inputs = io.inputs.map(t => this.substitute(t)),
        result = arg.lambda ? arg.lambda.inferReturnType(inputs) : arg.methodGroup.returnTypeFor(inputs);
      arg.outputDone = true;
      if (!result) return;
      const before = this.boundCount();
      this.lower(asyncResultFor(result, io.output), io.output);
      if (this.boundCount() !== before) progress = true;
    });
    for (const arg of args) delete arg.outputDone;
    return progress;
  }
  boundCount() {
    let n = 0;
    for (const b of this.bounds.values()) n += b.exact.length + b.lower.length + b.upper.length;
    return n;
  }
}
const hasBounds = b => b.exact.length + b.lower.length + b.upper.length > 0;
/** The Invoke method of a delegate type (or of the delegate inside Expression<TDelegate>), or null. */
export function delegateInvoke(type) {
  type = typeOf(type);
  if (!type) return null;
  if (type.typeKind === TypeKind.Delegate) return type.delegateInvokeMethod;
  if (
    type instanceof NamedTypeSymbol &&
    type.name === 'Expression' &&
    type.typeArguments.length === 1 &&
    type.typeArguments[0].type.typeKind === TypeKind.Delegate
  )
    return type.typeArguments[0].type.delegateInvokeMethod;
  return null;
}
/**
 * Infers the type arguments of a generic method for a call.
 * @returns {{typeArguments:TypeSymbol[]}|{error:{code:'CS0411',args:[string]}}}
 */
export function inferMethodTypeArguments(method, parameterTypes, args, conversions, core) {
  const definition = method.constructedFrom ?? method,
    inferrer = new TypeInferrer([...definition.typeParameters], conversions, core);
  const result = inferrer.infer(parameterTypes, args);
  return result ? { typeArguments: result } : { error: { code: DiagnosticId.CS0411, args: [definition.toDisplayString()] } };
}
export { SymbolKind, TypeWithAnnotations };
