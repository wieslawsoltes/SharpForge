import {BoundFieldAccess} from '../bound/nodes.js';
import {DiagnosticId} from '../diagnostics/codes.js';
import {registeredField} from '../symbols/registry-fields.js';

function fieldAccess(binder, node) {
  if (node.kind !== 'Member') return null;
  const receiver = binder.frameworkReceiver(node);
  const descriptor = receiver?.isStatic && registeredField(receiver.type, node.name);
  return descriptor ? {receiver, descriptor} : null;
}

/** Bind profile fields as locations; the later local rewriter substitutes their immutable execution values. */
export const RegisteredFieldBinder = Base => class extends Base {
  frameworkInfer(node) {
    return fieldAccess(this, node)?.descriptor.type ?? super.frameworkInfer(node);
  }

  bindFrameworkExpression(node) {
    const access = fieldAccess(this, node);
    if (access) {
      const field = this.type(access.receiver.type).getMembers(node.name).find(member => member.registryField);
      return this.node(BoundFieldAccess, node, {receiver: null, field}, access.descriptor.type);
    }
    return super.bindFrameworkExpression(node);
  }

  bindFrameworkLValue(node) {
    const access = fieldAccess(this, node);
    if (!access) return super.bindFrameworkLValue(node);
    this.c.report(node, DiagnosticId.CS0198);
    return this.bad(node, [], access.descriptor.type);
  }
};
