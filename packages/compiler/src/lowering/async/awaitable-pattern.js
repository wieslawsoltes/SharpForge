/**
 * `await e` through the awaitable pattern (SF-A02-T58): what Roslyn emits is
 *
 *   var awaiter = e.GetAwaiter();
 *   if (!awaiter.IsCompleted) { suspend; awaiter.OnCompleted(continuation); return; }   // resumed by the continuation
 *   awaiter.GetResult()
 *
 * The suspended branch needs a continuation the awaiter can invoke later to resume the waiting context. The runtime's
 * continuation ABI (`SharpForge.Runtime.Async`) resumes a context when a *task* completes; it has no delegate that
 * resumes one, and no task a program can complete by hand (a `TaskCompletionSource`). So only an awaiter that is
 * provably complete is generated: its `IsCompleted` is a non-virtual source property whose getter is the literal
 * `true`. For that awaiter .NET never calls `OnCompleted`, and `e.GetAwaiter().GetResult()` is the whole await.
 * Every other pattern-based await is SF2200 naming the missing capability.
 */
import { DeclarationModifiers } from '../../symbols/members.js';

const polymorphic = DeclarationModifiers.Virtual | DeclarationModifiers.Abstract | DeclarationModifiers.Override;

/** The expression a getter returns when its body is a single expression (`=> e`, `get => e`, `get { return e; }`), or null. */
function getterExpression(syntax) {
  if (!syntax) return null;
  if (syntax.expressionBody) return syntax.expressionBody.expression;
  const statements = syntax.body ? [...syntax.body.statements] : [];
  return statements.length === 1 && statements[0].kind === 'ReturnStatement' ? statements[0].expression : null;
}

/** True when `IsCompleted` is known at compile time to return `true` whatever the awaiter object is. */
export function isAlwaysCompleted(property) {
  const getter = property?.getMethod;
  if (!getter || getter.modifiers & polymorphic) return false;
  let expression = getterExpression(getter.syntax);
  while (expression?.kind === 'ParenthesizedExpression') expression = expression.expression;
  return expression?.kind === 'TrueLiteralExpression';
}

const call = (syntax, method, receiver, args = []) => ({ kind: 'Call', syntax, type: method.returnType, method, receiver, args, constantValue: null });

/**
 * Lowers a pattern-based await for the body translator.
 * @param translator the body translator  @param node the bound `Await` with its `awaitable` pattern (binder/await.js)
 */
export function lowerAwaitable(translator, node) {
  const pattern = node.awaitable;
  if (!pattern?.getResult || !isAlwaysCompleted(pattern.isCompleted)) {
    const awaiter = pattern?.getAwaiter?.returnType?.toDisplayString() ?? 'a user-defined awaiter';
    return translator.unsupported(
      `await of '${awaiter}', whose IsCompleted is not the constant true (the runtime has no continuation that resumes a suspended context)`,
      node.syntax,
    );
  }
  const operand = { expression: node.operand, refKind: null },
    awaiter = pattern.isExtension
      ? call(node.syntax, pattern.getAwaiter, null, [operand])
      : call(node.syntax, pattern.getAwaiter, node.operand);
  return translator.expression(call(node.syntax, pattern.getResult, awaiter));
}
