/**
 * The generic scope of each lambda, local function and captured variable of a body (SF-A02-T30).
 *
 * The type parameters in scope at a place are those of the method the body belongs to, followed by those of every
 * generic local function around the place. What closure conversion synthesizes for a place - the method of a
 * function, its closure class, the cell of a variable - is generic over exactly those, so a lambda inside
 * `void Apply<T>(T item)` can name `T`.
 */
import { walk } from '../../bound/semantic-walker.js';

/** The key closure conversion knows a function node by, and its body. */
function functionOf(node) {
  if (node.kind === 'Lambda') return node.body ? { key: node, body: node.body, own: [] } : null;
  if (node.kind !== 'LocalFunction') return null;
  const method = node.method;
  return method?.body ? { key: method, body: method.body, own: method.typeParameters ?? [] } : null;
}

/**
 * @param root a bound body  @param {{typeParameters: object[]}} context the planning context of the body
 * @param captures the CaptureAnalysis of the body
 * @returns {{ofFunction: Map<object, object>, ofVariable: Map<object, object>}} function key -> the context it is
 *   declared in; captured variable -> the context of the function that declares it. A context is `context` itself,
 *   or a copy with a longer `typeParameters` list (one object per generic local function).
 */
export function closureScopes(root, context, captures) {
  const ofFunction = new Map(),
    ofVariable = new Map();
  const visit = (body, scope) => {
    walk(body, node => {
      const found = node === body ? null : functionOf(node);
      if (!found) return true;
      const inner = found.own.length ? { ...scope, typeParameters: [...scope.typeParameters, ...found.own] } : scope;
      ofFunction.set(found.key, scope);
      for (const variable of captures.of(found.key)?.declared ?? []) ofVariable.set(variable, inner);
      visit(found.body, inner);
      return false;
    });
  };
  visit(root, context);
  return { ofFunction, ofVariable };
}
