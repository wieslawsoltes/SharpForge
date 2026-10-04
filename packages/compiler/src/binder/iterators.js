/**
 * Rules for iterator blocks (SF-A02-T09.1). `yield` inside a lambda or anonymous method (CS1621) is reported when
 * the statement is bound, because a lambda body with other errors never reaches a bound method body. The rest is
 * checked over the bound body of the method:
 *
 *   CS1623  an iterator with a ref, in or out parameter
 *   CS1624  an iterator whose return type is not an iterator interface
 *   CS1625  `yield` inside a finally block
 *   CS1626  `yield return` inside a try block that has a catch clause
 *   CS1631  `yield return` inside a catch block
 *
 * Roslyn reports the placement errors at the `yield` keyword and checks them in this order: finally, try with a
 * catch clause, catch. A local function is its own iterator and is checked when its own body is bound.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { RefKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { forEachChild, isBoundNode } from '../bound/semantic-walker.js';

const iteratorInterfaces = new Set(['IEnumerable', 'IEnumerator', 'IAsyncEnumerable', 'IAsyncEnumerator']);

/** True for `IEnumerable`, `IEnumerator` and their generic and asynchronous forms. */
export function isIteratorInterface(type) {
  if (!type || type.isErrorType?.()) return false;
  const arity = type.typeArguments?.length ?? 0;
  if (!iteratorInterfaces.has(type.name)) return false;
  return type.name.startsWith('IAsync') ? arity === 1 : arity <= 1;
}

const outside = Object.freeze({ inFinally: false, inCatch: false, inTryWithCatch: false });

/**
 * Reports CS1621 for a yield statement bound inside a lambda. A lambda body is bound once per candidate delegate
 * type, quietly, so the error goes straight to the analysis and is reported once per statement.
 * @param binder the body binder of the lambda (`{d, c, rootBinder}`)  @param syntax the yield statement
 */
export function reportYieldInLambda(binder, syntax) {
  const reported = (binder.rootBinder.yieldsInLambdas ??= new Set());
  if (reported.has(syntax)) return;
  reported.add(syntax);
  binder.d.report(binder.c.uri, syntax.yieldKeyword ?? syntax, DiagnosticId.CS1621, []);
}

function placementError(node, where) {
  if (where.inFinally) return DiagnosticId.CS1625;
  if (node.kind !== 'YieldReturn') return null;
  if (where.inTryWithCatch) return DiagnosticId.CS1626;
  return where.inCatch ? DiagnosticId.CS1631 : null;
}

/** Walks a bound body; `found(node, where)` is called for every yield statement with the regions enclosing it. */
function forEachYield(node, where, found) {
  if (!isBoundNode(node)) return;
  switch (node.kind) {
    case 'YieldReturn':
    case 'YieldBreak':
      found(node, where);
      break;
    case 'Lambda':
      return;
    case 'Try':
      forEachYield(node.body, node.catches.length ? { ...where, inTryWithCatch: true } : where, found);
      for (const clause of node.catches) {
        if (clause.filter) forEachYield(clause.filter, where, found);
        forEachYield(clause.block, { ...where, inCatch: true }, found);
      }
      if (node.finallyBlock) forEachYield(node.finallyBlock, { ...where, inFinally: true }, found);
      return;
    default:
      break;
  }
  forEachChild(node, child => forEachYield(child, where, found));
}

function displayOf(method) {
  const isAccessor = method.methodKind === MethodKind.PropertyGet && method.associatedSymbol;
  return isAccessor ? method.associatedSymbol.toDisplayString() + '.get' : method.toDisplayString();
}

/**
 * Checks the iterator rules of one bound method body.
 * @param method the method symbol  @param body its bound body
 * @param report `(node, code, args)` reports a diagnostic in the method's file
 */
export function checkIteratorBody(method, body, report) {
  let yields = 0;
  forEachYield(body, outside, (node, where) => {
    yields++;
    const code = placementError(node, where);
    if (code) report(node.syntax.yieldKeyword ?? node.syntax, code, []);
  });
  if (!yields) return;
  if (method.isVararg) report(method.locations?.[0] ?? method.syntax, 'CS1636', []);
  const returnType = method.returnType;
  const location = method.locations?.[0] ?? method.syntax;
  if (isIteratorInterface(returnType) && returnType.name.startsWith('IAsync') && !method.isAsync) {
    report(location, DiagnosticId.CS8403, [displayOf(method), returnType.toDisplayString()]);
  }
  if (returnType && !returnType.isErrorType?.() && !isIteratorInterface(returnType)) {
    const location = method.methodKind === MethodKind.PropertyGet && method.syntax?.keyword ? method.syntax.keyword : method.locations?.[0];
    report(location ?? method.syntax, DiagnosticId.CS1624, [displayOf(method), returnType.toDisplayString()]);
  }
  for (const parameter of method.parameters ?? []) {
    if (parameter.refKind && parameter.refKind !== RefKind.None) {
      report(parameter.syntax?.identifier ?? parameter.locations?.[0] ?? parameter.syntax, DiagnosticId.CS1623, []);
    }
  }
}
