import {checkWritable} from '../ref-kinds.js';

/** Bind runtime intrinsics and optional varargs before ordinary invocation overload resolution. */
export function bindVarargsInvocation(binder, syntax) {
  const name = syntax.expression.identifier?.valueText;
  const args = syntax.argumentList.arguments;
  if (['__makeref', '__reftype', '__refvalue'].includes(name)) {
    const count = name === '__refvalue' ? 2 : 1;
    if (args.length !== count) { binder.report(syntax, 'CS1501', [name, args.length]); return binder.bad(syntax); }
    const operand = binder.value(args[0].expression);
    if (operand.hasErrors) return operand;
    if (name === '__makeref') {
      if (operand.type?.specialType === 'System_TypedReference' || operand.type?.isRefLikeType) {
        binder.report(args[0], 'CS1601', [binder.display(operand.type)]);
        return binder.bad(syntax);
      }
      const error = checkWritable(operand, 'ref', binder.variableContext);
      if (error) { binder.report(args[0], error.code, error.args); return binder.bad(syntax); }
      return binder.node('MakeTypedReference', syntax, binder.core.bridge.coreType('System_TypedReference'), {operand});
    }
    if (operand.type !== binder.core.bridge.coreType('System_TypedReference')) {
      binder.report(args[0], 'CS1503', [1, binder.display(operand.type), 'System.TypedReference']);
      return binder.bad(syntax);
    }
    const type = name === '__reftype' ? binder.core.bridge.coreType('System_Type') : binder.bindType(args[1].expression).type;
    return binder.node(name === '__reftype' ? 'TypedReferenceType' : 'TypedReferenceValue', syntax, type, {operand});
  }
  if (syntax.expression.kind === 'ArgListExpression') {
    binder.report(syntax, 'CS0226');
    return binder.bad(syntax);
  }
  const optional = args.at(-1)?.expression;
  if (optional?.kind !== 'InvocationExpression' || optional.expression.kind !== 'ArgListExpression') return undefined;
  // Red syntax nodes expose children through prototype getters, so object spreading drops them.
  const fixedArguments = Object.create(syntax.argumentList);
  Object.defineProperty(fixedArguments, 'arguments', {value: args.slice(0, -1)});
  const fixedCall = Object.create(syntax);
  Object.defineProperty(fixedCall, 'argumentList', {value: fixedArguments});
  const call = binder.invocation(fixedCall);
  if (call.hasErrors) return call;
  if (!call.method?.isVararg) { binder.report(syntax, 'CS1501', [call.method?.name ?? '', args.length]); return binder.bad(syntax); }
  const varargs = optional.argumentList.arguments.map(argument => binder.value(argument.expression));
  for (const value of varargs) {
    if (value.hasErrors) return binder.bad(syntax);
    if (value.type?.specialType === 'System_TypedReference' || value.type?.isRefLikeType) {
      binder.report(value.syntax, 'CS1601', [binder.display(value.type)]);
      return binder.bad(syntax);
    }
  }
  return {...call, varargs};
}

export function bindArgumentHandle(binder, syntax) {
  if (!binder.c.method?.isVararg) { binder.report(syntax, 'CS0190'); return binder.bad(syntax); }
  return binder.node('ArgumentHandle', syntax, binder.core.bridge.coreType('System_RuntimeArgumentHandle'));
}
