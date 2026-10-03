import {n} from '../codegen/semantic/node-factory.js';

const operation = (name, type, operand = null, referent = null) => ({kind: 'VarargsOperation',
  legacyType: type, isExpression: true, operation: name, operand, referent});

export const VarargsTranslation = Base => class extends Base {
  exprArgumentHandle() { return operation('ARGLIST', 'System.RuntimeArgumentHandle'); }
  exprMakeTypedReference(node) {
    return operation('MKREFANY', 'typedref', this.addressExpression(node.operand), this.imageType(node.operand.type, node.syntax));
  }
  exprTypedReferenceType(node) { return operation('REFANYTYPE', 'System.Type', this.expression(node.operand)); }
  exprTypedReferenceValue(node) {
    const type = this.imageType(node.type, node.syntax);
    return {kind: 'ManagedIndirect', legacyType: type, isExpression: true,
      pointer: operation('REFANYVAL', type + '&', this.expression(node.operand), type)};
  }
  target(node) { return node.kind === 'TypedReferenceValue' ? this.exprTypedReferenceValue(node) : super.target(node); }
  arguments(node, method) {
    const fixed = super.arguments(node, method);
    if (!node.varargs) return fixed;
    // The temporary fixes each optional slot's declared type, including boxed and null values.
    return [...fixed, ...node.varargs.map(value => {
      const type = this.imageType(value.type, value.syntax), temp = this.temp(type, 'vararg');
      return n.sequence([temp], [n.assign(n.local(temp), this.expression(value))], n.local(temp));
    })];
  }
  frameworkInvocation(node, method) {
    if (!method.builtin?.varargsRuntime) return super.frameworkInvocation(node, method);
    const receiver = method.isStatic ? null : this.addressExpression(node.receiver);
    return n.frameworkCall(method, receiver, this.arguments(node, method), this.imageType(node.type, node.syntax));
  }
};
