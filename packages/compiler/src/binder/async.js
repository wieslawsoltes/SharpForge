/**
 * Rules for async methods (SF-A02-T09.2), checked over a bound method body:
 *
 *   CS1988  an async method with a ref, in or out parameter
 *   CS1996  `await` inside the body of a lock statement
 *
 * `await` outside an async function (CS4032, CS4033, CS4034) and the return type of an async method (CS1983) are
 * reported where the expression and the method are bound.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { RefKind } from '../symbols/types.js';
import { forEachChild, isBoundNode } from '../bound/semantic-walker.js';

/** Calls `found(awaitNode)` for every await that executes while a lock of the same function is held. */
function forEachAwaitInLock(node, inLock, found) {
  if (!isBoundNode(node)) return;
  if (node.kind === 'Await' && inLock) found(node);
  if (node.kind === 'Lambda') {
    // A lambda is a function of its own: the lock of the enclosing function is not held when it runs.
    if (node.body) forEachAwaitInLock(node.body, false, found);
    return;
  }
  if (node.kind === 'Lock') {
    forEachAwaitInLock(node.expression, inLock, found);
    forEachAwaitInLock(node.body, true, found);
    return;
  }
  forEachChild(node, child => forEachAwaitInLock(child, inLock, found));
}

/**
 * Checks the async rules of one bound method body.
 * @param method the method symbol  @param body its bound body
 * @param report `(node, code, args)` reports a diagnostic in the method's file
 */
export function checkAsyncBody(method, body, report) {
  forEachAwaitInLock(body, false, node => report(node.syntax, DiagnosticId.CS1996, []));
  if (!method.isAsync) return;
  for (const parameter of method.parameters ?? []) {
    if (parameter.refKind && parameter.refKind !== RefKind.None) {
      report(parameter.syntax?.identifier ?? parameter.locations?.[0] ?? parameter.syntax, DiagnosticId.CS1988, []);
    }
  }
}

/** True for `ValueTask` and `ValueTask<T>`. */
export function isValueTask(type, core) {
  return !!type && (type === core.valueTask || type.originalDefinition === core.valueTaskT);
}

/**
 * Reports an `await` (expression, `await foreach` or `await using`) that is not inside an async function.
 * @param binder the body binder  @param node where to report (the expression, or the `await` keyword of a statement)
 * @returns true when the await is misplaced
 */
export function reportAwaitOutsideAsync(binder, node) {
  const context = binder.c;
  if (context.isAsync || context.isTopLevel) return false;
  if (context.isLambda) {
    binder.report(node, DiagnosticId.CS4034, ['lambda expression']);
    return true;
  }
  const method = context.method,
    returnsVoid = method?.returnsVoid !== false && method?.returnType?.specialType === 'System_Void';
  binder.report(node, returnsVoid ? DiagnosticId.CS4033 : DiagnosticId.CS4032, method?.returnsVoid ? [] : [binder.display(method?.returnType)]);
  return true;
}
