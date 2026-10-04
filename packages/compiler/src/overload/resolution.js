/**
 * Overload resolution core (SF-A02-T06.2, C# spec 12.6.4): applicable function members, better conversion, better
 * function member with its tie-breakers, and the diagnostics of a failed resolution (CS0121, CS1501, CS1503, CS7036,
 * CS1739, CS1620, CS1615, CS0411). It replaces `findMethod`: candidates are symbols and arguments are bound
 * expressions, so the same code resolves methods, constructors, indexers, delegates and operators.
 *
 * An argument is `{type, constantValue?, literal?, form?, convert?, refKind?, name?, lambda?, methodGroup?}` - the
 * shape `Conversions.classifyFromExpression` and the type inferrer consume.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { RefKind, TypeKind, SymbolDisplayFormat, typeOf } from '../symbols/types.js';
import { mapArguments, acceptsArgumentCount } from './arguments.js';
import { inferMethodTypeArguments } from './type-inference.js';
import { numericKind, isSignedKind, isIntegralKind } from '../conversions/numeric.js';
import { ConversionKind } from '../conversions/classify.js';
import { spanElementType } from '../conversions/span.js';
import { baseTypeChain, containsTypeParameter } from '../symbols/substitution.js';
import { paramsElementType, betterParamsCollection, keepHighestPriority } from './params-collections.js';

const refOf = arg => (arg.refKind && arg.refKind !== 'none' ? arg.refKind : RefKind.None);
const display = type => (type ? type.toDisplayString() : '<null>');
/** How an argument is described in CS1503: its type, `<null>`, `method group`, `lambda expression`... */
export function argumentDisplay(arg) {
  const prefix = refOf(arg) === RefKind.None ? '' : refOf(arg) + ' ';
  if (arg.literal === 'null') return '<null>';
  if (arg.literal === 'default') return 'default';
  if (arg.form === 'methodGroup') return 'method group';
  if (arg.form === 'lambda') return arg.isAnonymousMethod ? 'anonymous method' : 'lambda expression';
  if (arg.form === 'implicitNew') return 'new()';
  if (arg.form === 'collection') return 'collection expressions';
  return prefix + (arg.type ? display(arg.type) : '?');
}
/** One candidate after applicability analysis. */
class Candidate {
  constructor(method, definition) {
    this.method = method;
    this.definition = definition;
    this.applicable = false;
    this.expanded = false;
    this.mapping = null;
    this.conversions = null;
    this.parameterTypes = null;
    this.failure = null;
    this.usedDefaults = false;
  }
}
export class OverloadResolver {
  constructor(conversions, core) {
    this.conversions = conversions;
    this.core = core;
  }
  /**
   * Analyses one candidate in one form.
   * @returns a Candidate; `failure` is `{kind,...}` when not applicable: 'arity' (type argument count), 'mapping'
   *   (mapArguments error), 'inference' (CS0411), 'refKind' {argument,expected}, 'conversion' {argument,to}
   */
  analyse(method, args, { typeArguments = null, expanded = false } = {}) {
    const c = new Candidate(method, method.constructedFrom ?? method);
    c.expanded = expanded;
    const mapping = mapArguments(method.parameters, args, { expanded });
    if (!mapping.ok) {
      c.failure = { kind: 'mapping', error: mapping.error };
      return c;
    }
    if (expanded && !paramsElementType(method.parameters.at(-1).type)) {
      c.failure = { kind: 'mapping', error: { code: DiagnosticId.CS1501, kind: 'notExpandable' } };
      return c;
    }
    c.mapping = mapping;
    c.usedDefaults = mapping.defaults.length > 0;
    const formal = i => {
      const p = method.parameters[mapping.parameterOf[i]];
      return expanded && mapping.parameterOf[i] === method.parameters.length - 1 ? paramsElementType(p.type) : p.type;
    };
    let constructed = method;
    if (method.arity && !method._typeArguments) {
      if (typeArguments) {
        if (typeArguments.length !== method.arity) {
          c.failure = { kind: 'arity' };
          return c;
        }
        constructed = method.construct(typeArguments);
      } else {
        const inferred = inferMethodTypeArguments(
          method,
          args.map((_, i) => formal(i)),
          args,
          this.conversions,
          this.core,
        );
        if (inferred.error) {
          c.failure = { kind: 'inference', error: inferred.error };
          return c;
        }
        constructed = method.construct(inferred.typeArguments);
        c.inferred = inferred.typeArguments;
      }
    } else if (typeArguments && typeArguments.length) {
      c.failure = { kind: 'arity' };
      return c;
    }
    c.method = constructed;
    const formalOf = i => {
      const p = constructed.parameters[mapping.parameterOf[i]];
      return expanded && mapping.parameterOf[i] === constructed.parameters.length - 1 ? paramsElementType(p.type) : p.type;
    };
    c.parameterTypes = args.map((_, i) => formalOf(i));
    c.conversions = [];
    for (let i = 0; i < args.length; i++) {
      const parameter = constructed.parameters[mapping.parameterOf[i]],
        wanted = expanded && mapping.parameterOf[i] === constructed.parameters.length - 1 ? RefKind.None : parameter.refKind,
        given = refOf(args[i]);
      // `in` parameters take an argument with or without `in`, and with `ref` (C# 12; the binder reports the version
      // and the warning); ref readonly parameters take ref, in or nothing.
      const refOk =
        wanted === given ||
        (wanted === RefKind.In && (given === RefKind.None || given === RefKind.Ref)) ||
        (wanted === RefKind.RefReadOnlyParameter && [RefKind.None, RefKind.In, RefKind.Ref].includes(given));
      // COM interop: `ref` may be omitted on a call to a COM interface method; the argument is then passed by value.
      // An argument that does not convert to the parameter type is still reported as a missing `ref`.
      const mayOmit = !refOk && wanted === RefKind.Ref && given === RefKind.None && !!this.allowsRefOmission?.(method),
        byValue = mayOmit ? this.conversions.classifyFromExpression(args[i], c.parameterTypes[i]) : null,
        omitsRef = !!byValue?.exists && byValue.isImplicit;
      if (omitsRef) c.omitsRef = true;
      else if (!refOk) {
        c.failure ??= { kind: 'refKind', argument: i, expected: wanted, given };
        c.conversions.push(null);
        continue;
      }
      if ((wanted === RefKind.Ref && !omitsRef) || wanted === RefKind.Out) {
        // By-reference arguments need an identical type; `out var x` / `out _` have none and take the parameter's type.
        const ok = !args[i].type || this.conversions.isIdentity(args[i].type, c.parameterTypes[i]);
        if (!ok) c.failure ??= { kind: 'conversion', argument: i, to: c.parameterTypes[i] };
        c.conversions.push(ok ? this.conversions.constructor.identity : null);
        continue;
      }
      const conversion = this.conversions.classifyFromExpression(args[i], c.parameterTypes[i]);
      if (!conversion.exists || !conversion.isImplicit || conversion.isAmbiguous) {
        c.failure ??= { kind: 'conversion', argument: i, to: c.parameterTypes[i] };
        c.conversions.push(null);
      } else c.conversions.push(conversion);
    }
    c.applicable = !c.failure;
    return c;
  }
  /**
   * Resolves a call.
   * @param {MethodSymbol[]} methods candidate set (already filtered for accessibility and hiding)
   * @param {object[]} args  @param {{typeArguments?:TypeSymbol[]|null,name?:string,isConstructor?:boolean,isDelegate?:boolean}} [options]
   * @returns {{succeeded:true,method,expanded,mapping,conversions,candidate}|{succeeded:false,error:{code,args,argument?:number},candidates,best?:Candidate}}
   */
  resolve(methods, args, options = {}) {
    const unique = [];
    for (const m of methods) if (!m.isOverride && !unique.includes(m)) unique.push(m);
    let analysed = [];
    for (const method of unique) {
      const normal = this.analyse(method, args, options);
      if (normal.applicable || !method.parameters.at(-1)?.isParams) {
        analysed.push(normal);
        continue;
      }
      const expanded = this.analyse(method, args, { ...options, expanded: true });
      analysed.push(expanded.applicable ? expanded : preferFailure(normal, expanded));
    }
    let applicable = analysed.filter(c => c.applicable);
    // Candidates declared in a base type of an applicable candidate's type are removed (spec 12.6.4.1).
    if (applicable.length > 1 && !options.keepBaseCandidates) {
      const hidden = c =>
        applicable.some(
          o =>
            o !== c &&
            o.definition.containingType &&
            c.definition.containingType &&
            !o.definition.containingType.originalDefinition.equals?.(c.definition.containingType.originalDefinition) &&
            o.definition.containingType.typeKind !== TypeKind.Interface &&
            baseTypeChain(o.definition.containingType.originalDefinition, this.core)
              .slice(1)
              .some(b => b.originalDefinition === c.definition.containingType.originalDefinition),
        );
      const kept = applicable.filter(c => !hidden(c));
      if (kept.length) applicable = kept;
    }
    applicable = keepHighestPriority(applicable, c => c.definition);
    // The framework registry lists some members twice (one contract per runtime implementation): they are one member,
    // which matters once a third candidate is applicable too (`string.Concat(string, string)` next to the params form).
    if (applicable.length > 2) applicable = applicable.filter((c, i) => !applicable.slice(0, i).some(o => this.isSameImportedMember(o, c)));
    if (applicable.length === 1) return success(applicable[0]);
    if (applicable.length > 1) {
      const best = applicable.filter(c => applicable.every(o => o === c || this.better(c, o, args)));
      if (best.length === 1) return success(best[0]);
      // The framework registry lists some members twice (one contract per runtime implementation): they are one member.
      if (applicable.every(c => this.isSameImportedMember(c, applicable[0]))) return success(applicable[0]);
      const pair = best.length > 1 ? best : applicable;
      return {
        succeeded: false,
        error: { code: DiagnosticId.CS0121, args: [memberDisplay(pair[0].definition), memberDisplay(pair[1].definition)] },
        candidates: analysed,
        ambiguous: pair.map(c => c.method),
      };
    }
    return {
      succeeded: false,
      error: this.failureDiagnostic(analysed, args, options),
      candidates: analysed,
      best: this.bestFailure(analysed, args),
    };
  }
  /** True for two candidates that are the same member of a type that is not declared in source. */
  isSameImportedMember(a, b) {
    const x = a.definition,
      y = b.definition;
    if (x === y) return true;
    if (x.locations?.length || y.locations?.length || x.containingType !== y.containingType) return false;
    if (x.name !== y.name || !!x.isStatic !== !!y.isStatic || x.parameters.length !== y.parameters.length) return false;
    const sameParameter = (p, q) => (p.refKind ?? RefKind.None) === (q.refKind ?? RefKind.None) && this.conversions.isIdentity(p.type, q.type);
    return x.parameters.every((p, i) => sameParameter(p, y.parameters[i]));
  }
  /** The inapplicable candidate the error is reported against: fewest problems, declaration order on ties. */
  bestFailure(analysed, args) {
    const rank = c =>
      c.failure.kind === 'conversion' || c.failure.kind === 'refKind'
        ? 0
        : c.failure.kind === 'inference'
          ? 1
          : c.failure.kind === 'arity'
            ? 3
            : 2;
    return [...analysed].sort((a, b) => rank(a) - rank(b) || badCount(a) - badCount(b))[0] ?? null;
  }
  failureDiagnostic(analysed, args, { name = null, isConstructor = false, isDelegate = false } = {}) {
    if (!analysed.length) return { code: DiagnosticId.CS1501, args: [name ?? '?', args.length] };
    const best = this.bestFailure(analysed, args),
      method = best.definition,
      shown = name ?? (isConstructor ? method.containingType?.name : method.name),
      f = best.failure;
    if (f.kind === 'conversion')
      return {
        code: DiagnosticId.CS1503,
        args: [
          f.argument + 1,
          argumentDisplay(args[f.argument]),
          refPrefix(best.method.parameters[best.mapping.parameterOf[f.argument]], best) + display(f.to),
        ],
        argument: f.argument,
      };
    if (f.kind === 'refKind') {
      const takesNoKeyword = f.expected === RefKind.In || f.expected === RefKind.RefReadOnlyParameter;
      if (f.expected === RefKind.None || (takesNoKeyword && f.given !== RefKind.None))
        return { code: DiagnosticId.CS1615, args: [f.argument + 1, f.given], argument: f.argument };
      return { code: DiagnosticId.CS1620, args: [f.argument + 1, f.expected], argument: f.argument };
    }
    if (f.kind === 'inference') return { code: DiagnosticId.CS0411, args: f.error.args };
    if (f.kind === 'arity')
      return {
        code: method.arity ? DiagnosticId.CS0305 : DiagnosticId.CS0308,
        args: method.arity ? [memberDisplay(method), 'method group', method.arity] : [memberDisplay(method), 'method'],
      };
    const e = f.error;
    if (e.kind === 'noSuchName') return { code: DiagnosticId.CS1739, args: [isDelegate ? shown : shown, e.name], argument: e.argument };
    if (e.kind === 'nameUsedTwice') return { code: DiagnosticId.CS1740, args: [e.name], argument: e.argument };
    if (e.kind === 'namedAlreadyPositional') return { code: DiagnosticId.CS1744, args: [e.name], argument: e.argument };
    if (e.kind === 'badNonTrailingName') return { code: DiagnosticId.CS8323, args: [e.name], argument: e.argument };
    // Too few arguments: Roslyn names the first required parameter without an argument when exactly one candidate
    // could otherwise be meant; with several candidates of other arities it reports the argument count.
    const missing = analysed.filter(c => c.failure.kind === 'mapping' && c.failure.error.kind === 'missing');
    if (e.kind === 'missing' && analysed.length === 1) {
      const c = missing.sort((a, b) => a.definition.parameters.length - b.definition.parameters.length)[0];
      return { code: DiagnosticId.CS7036, args: [c.failure.error.parameter.name, memberDisplay(c.definition)] };
    }
    return {
      code: isDelegate ? DiagnosticId.CS1593 : isConstructor ? DiagnosticId.CS1729 : DiagnosticId.CS1501,
      args: isConstructor ? [method.containingType?.toDisplayString() ?? shown, args.length] : [shown, args.length],
    };
  }
  /** True when candidate `a` is a better function member than `b` for these arguments. */
  better(a, b, args) {
    let anyBetter = false;
    for (let i = 0; i < args.length; i++) {
      const r =
        this.betterConversion(args[i], a.parameterTypes[i], a.conversions[i], b.parameterTypes[i], b.conversions[i]) ||
        this.betterParamsTarget(a, b, i);
      if (r < 0) return false;
      if (r > 0) anyBetter = true;
    }
    if (anyBetter) return true;
    // Tie-breakers apply when the parameter type sequences are equivalent.
    if (!args.every((_, i) => this.conversions.isIdentity(a.parameterTypes[i], b.parameterTypes[i]))) return false;
    const generic = c => c.definition.arity > 0;
    if (generic(a) !== generic(b)) return !generic(a);
    if (a.expanded !== b.expanded) return !a.expanded;
    if (a.expanded && b.expanded && a.definition.parameters.length !== b.definition.parameters.length)
      return a.definition.parameters.length > b.definition.parameters.length;
    if (a.usedDefaults !== b.usedDefaults) return !a.usedDefaults;
    const specific = this.moreSpecific(a, b);
    if (specific !== 0) return specific > 0;
    return this.prefersByValue(a, b, args) > 0;
  }
  /** C# 13: an argument both candidates take into their params collection prefers the better collection type. */
  betterParamsTarget(a, b, i) {
    const last = c => c.expanded && c.mapping.parameterOf[i] === c.method.parameters.length - 1;
    if (!last(a) || !last(b) || !this.conversions.isIdentity(a.parameterTypes[i], b.parameterTypes[i])) return 0;
    return betterParamsCollection(a.method.parameters.at(-1).type, b.method.parameters.at(-1).type, this.conversions);
  }
  /**
   * The last tie-breaker (C# 7.2): for an argument passed without a modifier, a by-value parameter is better than
   * an `in` parameter. >0 when a is better in this way, <0 when b is, 0 when neither or both are.
   */
  prefersByValue(a, b, args) {
    let result = 0;
    for (let i = 0; i < args.length; i++) {
      if (refOf(args[i]) !== RefKind.None) continue;
      const x = a.method.parameters[a.mapping.parameterOf[i]].refKind ?? RefKind.None,
        y = b.method.parameters[b.mapping.parameterOf[i]].refKind ?? RefKind.None;
      const r = x === RefKind.None && y === RefKind.In ? 1 : x === RefKind.In && y === RefKind.None ? -1 : 0;
      if (r === 0) continue;
      if (result !== 0 && r !== result) return 0;
      result = r;
    }
    return result;
  }
  /** >0 when a's uninstantiated parameter types are more specific than b's, <0 for the reverse, 0 otherwise. */
  moreSpecific(a, b) {
    let result = 0;
    const count = Math.min(a.mapping.parameterOf.length, b.mapping.parameterOf.length);
    for (let i = 0; i < count; i++) {
      const x = a.definition.parameters[a.mapping.parameterOf[i]].type,
        y = b.definition.parameters[b.mapping.parameterOf[i]].type,
        r = specificity(x, y);
      if (r === 0) continue;
      if (result !== 0 && Math.sign(r) !== Math.sign(result)) return 0;
      result = r;
    }
    return result;
  }
  /** 1 when converting the argument to t1 is better than to t2, -1 for the reverse, 0 when neither is better. */
  betterConversion(arg, t1, c1, t2, c2) {
    if (this.conversions.isIdentity(t1, t2)) return 0;
    // C# 10: for an interpolated string that is not a constant, the conversion to a handler type is the better one.
    const handler1 = c1?.kind === ConversionKind.InterpolatedStringHandler,
      handler2 = c2?.kind === ConversionKind.InterpolatedStringHandler;
    if (handler1 !== handler2 && !arg.constantValue) return handler1 ? 1 : -1;
    const exact = t => arg.type && !arg.literal && this.conversions.isIdentity(arg.type, t);
    if (exact(t1) && !exact(t2)) return 1;
    if (exact(t2) && !exact(t1)) return -1;
    // C# 14 (first-class spans): when neither matches exactly, an implicit span conversion is the better conversion.
    if (this.conversions.firstClassSpans && !exact(t1)) {
      const span1 = c1?.kind === ConversionKind.ImplicitSpan,
        span2 = c2?.kind === ConversionKind.ImplicitSpan;
      if (span1 !== span2) return span1 ? 1 : -1;
    }
    // A lambda prefers the delegate whose return type is better for its inferred return type.
    if (arg.lambda) {
      const d1 = typeOf(t1).delegateInvokeMethod,
        d2 = typeOf(t2).delegateInvokeMethod;
      if (d1 && d2 && d1.parameters.length === d2.parameters.length) {
        const r1 = d1.returnType,
          r2 = d2.returnType;
        if (r1 && r2 && !this.conversions.isIdentity(r1, r2)) {
          if (d1.returnsVoid !== d2.returnsVoid) return d2.returnsVoid ? 1 : -1;
          const inferred = arg.lambda.inferReturnType(d1.parameters.map(p => p.type));
          if (inferred) {
            if (this.conversions.isIdentity(inferred, r1)) return 1;
            if (this.conversions.isIdentity(inferred, r2)) return -1;
          }
          return this.betterTarget(r1, r2);
        }
      }
    }
    return this.betterTarget(t1, t2);
  }
  /** Better conversion target: an implicit conversion t1 -> t2 but not back; signed integral over unsigned. */
  betterTarget(t1, t2) {
    if (this.conversions.firstClassSpans) {
      // C# 14: ReadOnlySpan<E> is better than Span<E>; two spans otherwise compare only as two ReadOnlySpans.
      const span1 = spanElementType(typeOf(t1), 'Span'),
        span2 = spanElementType(typeOf(t2), 'Span'),
        readOnly1 = spanElementType(typeOf(t1), 'ReadOnlySpan'),
        readOnly2 = spanElementType(typeOf(t2), 'ReadOnlySpan');
      if (readOnly1 && span2 && this.conversions.isIdentity(readOnly1, span2)) return 1;
      if (readOnly2 && span1 && this.conversions.isIdentity(readOnly2, span1)) return -1;
      if ((span1 || readOnly1) && (span2 || readOnly2) && !(readOnly1 && readOnly2)) return 0;
    }
    const to = this.conversions.classifyImplicit(t1, t2).exists,
      from = this.conversions.classifyImplicit(t2, t1).exists;
    if (to && !from) return 1;
    if (from && !to) return -1;
    const k1 = numericKind(t1.isNullableValueType ? t1.nullableUnderlyingType : t1),
      k2 = numericKind(t2.isNullableValueType ? t2.nullableUnderlyingType : t2);
    if (k1 && k2 && isIntegralKind(k1) && isIntegralKind(k2) && k1 !== 'char' && k2 !== 'char') {
      if (isSignedKind(k1) && !isSignedKind(k2)) return 1;
      if (isSignedKind(k2) && !isSignedKind(k1)) return -1;
    }
    return 0;
  }
}
const badCount = c => (c.conversions ? c.conversions.filter(x => x === null).length : 99);
const preferFailure = (normal, expanded) => (normal.failure.kind === 'mapping' && expanded.failure.kind !== 'mapping' ? expanded : normal);
const success = c => ({
  succeeded: true,
  method: c.method,
  expanded: c.expanded,
  mapping: c.mapping,
  conversions: c.conversions,
  parameterTypes: c.parameterTypes,
  candidate: c,
});
const refPrefix = (parameter, c) =>
  parameter.refKind && parameter.refKind !== RefKind.None && !(c.expanded && parameter.isParams) ? parameter.refKind + ' ' : '';
/** A member as Roslyn prints it in overload diagnostics: `C.M(int, string)`. */
export function memberDisplay(method) {
  return method.toDisplayString(SymbolDisplayFormat.ErrorMessage);
}
/** More specific type (spec 12.6.4.3): a non-type-parameter beats a type parameter; constructed types compare argument-wise; arrays by element. */
function specificity(x, y) {
  x = typeOf(x);
  y = typeOf(y);
  const px = x.typeKind === TypeKind.TypeParameter,
    py = y.typeKind === TypeKind.TypeParameter;
  if (px !== py) return px ? -1 : 1;
  if (px) return 0;
  if (x.elementType && y.elementType) return specificity(x.elementType, y.elementType);
  if (x.typeArguments?.length && x.typeArguments.length === y.typeArguments?.length && x.originalDefinition === y.originalDefinition) {
    let result = 0;
    for (let i = 0; i < x.typeArguments.length; i++) {
      const r = specificity(x.typeArguments[i].type, y.typeArguments[i].type);
      if (r === 0) continue;
      if (result !== 0 && Math.sign(r) !== Math.sign(result)) return 0;
      result = r;
    }
    return result;
  }
  return 0;
}
export { containsTypeParameter };
