/**
 * Closure conversion, analysis half (SF-A02-T07.3): which variables of a method are captured by its lambdas and
 * local functions, and what each of those functions captures.
 *
 * A captured variable does not live in a local slot: it lives in a heap cell created where the variable is declared
 * (so a variable declared in a loop body gets a fresh cell per iteration, and a `for` variable one cell for the
 * whole loop, as C# requires). A lambda becomes a method of a display class whose fields hold the cells it uses
 * and, when it uses `this`, the receiver. A local function becomes a static method that receives the cells as
 * extra parameters, so calling it allocates nothing.
 *
 * The analysis is transitive: a function that calls a capturing local function captures what that function does.
 */
import { walk } from '../bound/semantic-walker.js';
import { SymbolKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { markVariablesPassedByReference } from './by-reference.js';

/** What one lambda or local function captures. */
class FunctionCaptures {
  constructor(key, declared) {
    this.key = key;
    this.declared = declared;
    this.variables = new Set();
    this.usesThis = false;
    this.callees = new Set();
  }
  capture(variable) {
    if (!this.declared.has(variable)) this.variables.add(variable);
  }
}

const isLocalFunction = symbol => symbol?.kind === SymbolKind.Method && symbol.methodKind === MethodKind.LocalFunction;

export class CaptureAnalysis {
  constructor() {
    /** Variables (local and parameter symbols) that live in cells. */
    this.captured = new Set();
    /** Lambda node or local function symbol -> FunctionCaptures. */
    this.functions = new Map();
  }
  /** The captures of a lambda node or a local function symbol (empty when it captures nothing). */
  of(key) {
    return this.functions.get(key) ?? null;
  }
  isCaptured(variable) {
    return this.captured.has(variable);
  }
}

function scan(node, current, analysis) {
  walk(node, n => {
    switch (n.kind) {
      case 'Lambda': {
        if (!n.body) return false;
        const inner = new FunctionCaptures(n, new Set([...(n.parameters ?? []), ...(n.locals ?? [])]));
        analysis.functions.set(n, inner);
        scan(n.body, inner, analysis);
        inherit(current, inner);
        return false;
      }
      case 'LocalFunction': {
        const method = n.method;
        if (!method?.body) return false;
        const inner = new FunctionCaptures(method, new Set([...method.parameters, ...(method.body.locals ?? [])]));
        analysis.functions.set(method, inner);
        scan(method.body, inner, analysis);
        inherit(current, inner);
        return false;
      }
      case 'Local':
        current?.capture(n.local);
        break;
      case 'Parameter':
        // A primary constructor parameter captured by its type is state of `this`, not a variable of the method.
        if (n.isPrimaryCapture && current) current.usesThis = true;
        else current?.capture(n.parameter);
        break;
      case 'This':
      case 'Base':
        if (current) current.usesThis = true;
        break;
      case 'Call':
        if (current && isLocalFunction(n.method)) current.callees.add(n.method.originalDefinition ?? n.method);
        break;
      case 'MethodGroup':
        if (current) for (const method of n.methods ?? []) if (isLocalFunction(method)) current.callees.add(method);
        break;
      default:
        break;
    }
    return true;
  });
}

/** What a nested function captures from outside the enclosing function is captured by the enclosing function too. */
function inherit(outer, inner) {
  if (!outer) return;
  for (const variable of inner.variables) outer.capture(variable);
  if (inner.usesThis) outer.usesThis = true;
  for (const callee of inner.callees) outer.callees.add(callee);
}

/** Propagates the captures of called local functions to their callers until nothing changes. */
function closeOverCallees(analysis) {
  for (let changed = true; changed; ) {
    changed = false;
    for (const fn of analysis.functions.values()) {
      for (const callee of fn.callees) {
        const target = analysis.functions.get(callee);
        if (!target) continue;
        for (const variable of target.variables) {
          if (fn.declared.has(variable) || fn.variables.has(variable)) continue;
          fn.variables.add(variable);
          changed = true;
        }
        if (target.usesThis && !fn.usesThis) {
          fn.usesThis = true;
          changed = true;
        }
      }
    }
  }
}

/**
 * Analyses the bound body of a method (or of top-level statements).
 * @param {object} body the bound body
 * @param {{byReferenceInCells?: boolean}} [options] `byReferenceInCells` (the default) also moves every variable that
 *   is passed by reference into a cell, for a back end without addresses; the CIL emitter takes the address instead
 * @returns {CaptureAnalysis}
 */
export function analyzeCaptures(body, { byReferenceInCells = true } = {}) {
  const analysis = new CaptureAnalysis();
  if (!body) return analysis;
  scan(body, null, analysis);
  closeOverCallees(analysis);
  for (const fn of analysis.functions.values()) for (const variable of fn.variables) analysis.captured.add(variable);
  if (byReferenceInCells) markVariablesPassedByReference(body, analysis);
  return analysis;
}
