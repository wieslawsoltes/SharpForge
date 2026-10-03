/**
 * Named, optional and params arguments (SF-A02-T06.3, C# spec 12.6.2).
 *
 * `mapArguments` assigns each argument to a parameter of one candidate in its normal or expanded (params) form and
 * says why it cannot (too many arguments, unknown or duplicate name, a required parameter left without an argument).
 * `buildCallPlan` then lays the call out for lowering: arguments are evaluated left to right in source order - into
 * temporaries when named arguments are out of parameter order - defaults are inserted for omitted optional
 * parameters and the trailing arguments of an expanded call are collected into one array.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { RefKind } from '../symbols/types.js';

/**
 * @param {ParameterSymbol[]} parameters
 * @param {{name?:string|null,refKind?:string}[]} args in source order
 * @param {{expanded?:boolean}} [options] expanded = params form (the last parameter takes zero or more arguments)
 * @returns
 *   on success `{ ok: true, parameterOf: number[], expanded, paramsCount, defaults: number[] }`;
 *   on failure `{ ok: false, error: { code, kind, argument?, parameter?, name? } }`
 *   error kinds: 'tooMany' (CS1501), 'noSuchName' (CS1739), 'nameUsedTwice' (CS1740), 'namedAlreadyPositional' (CS1744),
 *   'badNonTrailingName' (CS8323), 'missing' (CS7036), 'notExpandable'
 */
export function mapArguments(parameters, args, { expanded = false } = {}) {
  const last = parameters.length - 1,
    hasParams = last >= 0 && parameters[last].isParams;
  if (expanded && !hasParams) return { ok: false, error: { code: DiagnosticId.CS1501, kind: 'notExpandable' } };
  const parameterOf = new Array(args.length).fill(-1),
    taken = new Array(parameters.length).fill(false);
  let paramsCount = 0;
  const positionalAfter = i => args.slice(i + 1).some(later => (later.name ?? null) === null);
  for (let i = 0; i < args.length; i++) {
    const name = args[i].name ?? null;
    if (name === null) {
      if (expanded && i >= last) {
        parameterOf[i] = last;
        paramsCount++;
        taken[last] = true;
        continue;
      }
      if (i > last) return { ok: false, error: { code: DiagnosticId.CS1501, kind: 'tooMany', argument: i } };
      parameterOf[i] = i;
      taken[i] = true;
      continue;
    }
    // The parameters of a partial method are named by its defining declaration (symbols/source/partial-members.js).
    const index = parameters.findIndex(p => ((p.originalDefinition ?? p).callerName ?? p.name) === name);
    if (index < 0) return { ok: false, error: { code: DiagnosticId.CS1739, kind: 'noSuchName', argument: i, name } };
    // A named argument may be followed by positional ones only when it stands in its parameter's position (C# 7.2).
    if (index !== i && positionalAfter(i)) return { ok: false, error: { code: DiagnosticId.CS8323, kind: 'badNonTrailingName', argument: i, name } };
    if (taken[index])
      return {
        ok: false,
        error: {
          code: args.slice(0, i).some(a => a.name === name) ? DiagnosticId.CS1740 : DiagnosticId.CS1744,
          kind: args.slice(0, i).some(a => a.name === name) ? 'nameUsedTwice' : 'namedAlreadyPositional',
          argument: i,
          name,
          parameter: parameters[index],
        },
      };
    parameterOf[i] = index;
    taken[index] = true;
    if (expanded && index === last) paramsCount++;
  }
  const defaults = [];
  for (let p = 0; p < parameters.length; p++) {
    if (taken[p]) continue;
    if (expanded && p === last) continue;
    if (parameters[p].isOptional || parameters[p].hasExplicitDefaultValue) {
      defaults.push(p);
      continue;
    }
    return { ok: false, error: { code: DiagnosticId.CS7036, kind: 'missing', parameter: parameters[p] } };
  }
  return { ok: true, parameterOf, expanded, paramsCount, defaults };
}
/** True when the candidate could be called with this many positional arguments in either form (used to pick the best error). */
export function acceptsArgumentCount(parameters, count) {
  const required = parameters.filter(p => !p.isOptional && !p.hasExplicitDefaultValue && !p.isParams).length;
  return count >= required && (count <= parameters.length || parameters.at(-1)?.isParams === true);
}
/**
 * Lays out a resolved call for lowering.
 * @param mapping a successful `mapArguments` result  @param parameters the (constructed) method's parameters
 * @returns {{slots:object[],evaluation:object[],needsTemps:boolean}}
 *   `slots[p]` describes parameter p: `{kind:'argument',argument}`, `{kind:'default',value,hasValue}` or
 *   `{kind:'paramsArray',arguments:[...],elementType}`; `evaluation` lists the source arguments in evaluation order
 *   with `temp:true` for those that must be captured before the call because they are out of parameter order.
 */
export function buildCallPlan(mapping, parameters, args = []) {
  const last = parameters.length - 1,
    slots = parameters.map((p, i) =>
      mapping.expanded && i === last ? { kind: 'paramsArray', arguments: [], elementType: p.type?.elementType ?? null } : null,
    );
  mapping.parameterOf.forEach((p, a) => {
    if (mapping.expanded && p === last) slots[p].arguments.push(a);
    else slots[p] = { kind: 'argument', argument: a };
  });
  for (const p of mapping.defaults)
    slots[p] = { kind: 'default', hasValue: parameters[p].hasExplicitDefaultValue, value: parameters[p].explicitDefaultValue ?? null };
  // Arguments are evaluated in source order. When that differs from parameter order, every argument evaluated before
  // a later-positioned one is spilled to a temporary - except constants and by-ref arguments, which have no side effects to order.
  let needsTemps = false;
  const evaluation = [];
  let highest = -1;
  const order = mapping.parameterOf.map((p, a) => ({ argument: a, parameter: p }));
  const outOfOrder = order.some((o, i) => order.slice(0, i).some(prev => prev.parameter > o.parameter));
  for (const o of order) {
    const arg = args[o.argument],
      pure = !!arg?.constantValue || (arg?.refKind && arg.refKind !== RefKind.None && arg.refKind !== 'none');
    const temp = outOfOrder && !pure;
    if (temp) needsTemps = true;
    highest = Math.max(highest, o.parameter);
    evaluation.push({ argument: o.argument, parameter: o.parameter, temp });
  }
  return { slots, evaluation, needsTemps };
}
