import {canonicalType, frameworkType} from '@sharpforge/framework';
import {BoundLiteral, BoundDelegateCreationExpression} from '../bound/nodes.js';
import {DiagnosticId} from '../diagnostics/codes.js';

/** Legacy event accessors accept null and existing delegates as well as method groups. */
export function bindFrameworkDelegate(binder, node, type) {
  if (node.kind === 'Literal' && node.value === null)
    return binder.node(BoundLiteral, node, {value: null}, canonicalType(type), {constantValue: {value: null}});
  const value = node.kind === 'New' && node.args.length === 1 ? node.args[0] : node;
  const actual = binder.infer(value);
  if (frameworkType(actual)?.kind === 'delegate') {
    const bound = binder.bindExpression(value);
    binder.checkAssign(type, bound.legacyType, node);
    return bound;
  }
  const binding = binder.delegateMethod(node, type, true);
  if (!binding) return binder.bad(node, [], type);
  let receiver = null;
  if (!binding.method.isStatic) {
    if (binding.receiver) receiver = binder.bindExpression(binding.receiver);
    else {
      if (!binder.thisParameter) binder.c.report(node, DiagnosticId.CS0120, [binding.method.name]);
      receiver = binder.implicitThis(node);
    }
  }
  if (binding.method.symbol) binder.c.reference(binding.node, binding.method.symbol);
  return binder.node(BoundDelegateCreationExpression, node,
    {receiver, method: binder.sym.method(binding.method)}, canonicalType(type));
}
