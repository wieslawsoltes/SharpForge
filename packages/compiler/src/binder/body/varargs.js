import {
  checkWritable
} from '../ref-kinds.js';

/** Bind runtime intrinsics and optional varargs before ordinary invocation overload resolution. */
export function bindVarargsInvocation(binder, syntax) {
  if (syntax.expression.kind === 'ArgListExpression') {
    binder.report(syntax, 'CS0226');
    return binder.bad(syntax);
  }
  return bindOptionalArguments(binder, syntax, fixed => binder.invocation(fixed));
}

export function bindVarargsCreation(binder, syntax) {
  return bindOptionalArguments(binder, syntax, fixed => binder.objectCreation(fixed));
}

function bindOptionalArguments(binder, syntax, bindFixed) {
  const args = syntax.argumentList?.arguments ?? [];
  const optional = args.at(-1)?.expression;
  if (optional?.kind !== 'InvocationExpression' || optional.expression.kind !== 'ArgListExpression') return undefined;
  // Red syntax nodes expose children through prototype getters, so object spreading drops them.
  const fixedArguments = Object.create(syntax.argumentList);
  Object.defineProperty(fixedArguments, 'arguments', {
    value: args.slice(0, -1)
  });
  const fixedCall = Object.create(syntax);
  Object.defineProperty(fixedCall, 'argumentList', {
    value: fixedArguments
  });
  const call = bindFixed(fixedCall);
  if (call.hasErrors) return call;
  const method = call.method ?? call.constructor;
  if (!method?.isVararg) {
    binder.report(syntax, 'CS1501', [method?.name ?? '', args.length]);
    return binder.bad(syntax);
  }
  const varargs = optional.argumentList.arguments.map(argument => {
    const refKind = argument.refKindKeyword?.valueText;
    if (refKind && refKind !== 'ref') {
      binder.report(argument, 'CS8378');
      return binder.bad(argument);
    }
    const value = binder.value(argument.expression);
    if (value.type?.specialType === 'System_Void') binder.report(argument, 'CS8362');
    if (refKind === 'ref') {
      const error = checkWritable(value, 'ref', binder.variableContext);
      if (error) {
        binder.report(argument.expression, error.code, error.args);
        return binder.bad(argument);
      }
      binder.markAliased?.(value);
      return {
        ...value,
        varargRef: true
      };
    }
    return value;
  });
  for (const value of varargs) {
    if (value.hasErrors) return binder.bad(syntax);
    if (value.type?.specialType === 'System_TypedReference' || value.type?.isRefLikeType) {
      binder.report(value.syntax, 'CS1601', [binder.display(value.type)]);
      return binder.bad(syntax);
    }
  }
  return {
    ...call,
    varargs
  };
}

export function bindArgumentHandle(binder, syntax) {
  if (!binder.c.method?.isVararg) {
    binder.report(syntax, 'CS0190');
    return binder.bad(syntax);
  }
  return binder.node('ArgumentHandle', syntax, binder.core.bridge.coreType('System_RuntimeArgumentHandle'));
}

/** Native typed-reference expressions retain their type syntax instead of pretending it is a value argument. */
export function bindTypedReferenceExpression(binder, syntax) {
  const operand = binder.value(syntax.expression);
  if (operand.hasErrors) return operand;
  if (syntax.kind === 'MakeRefExpression') {
    if (operand.type?.specialType === 'System_TypedReference' || operand.type?.isRefLikeType) {
      binder.report(syntax.expression, 'CS1601', [binder.display(operand.type)]);
      return binder.bad(syntax);
    }
    const error = checkWritable(operand, 'ref', binder.variableContext);
    if (error) {
      binder.report(syntax.expression, error.code, error.args);
      return binder.bad(syntax);
    }
    binder.markAliased?.(operand);
    return binder.node('MakeTypedReference', syntax, binder.core.bridge.coreType('System_TypedReference'), {
      operand
    });
  }
  if (operand.type !== binder.core.bridge.coreType('System_TypedReference')) {
    binder.report(syntax.expression, 'CS1503', [1, binder.display(operand.type), 'System.TypedReference']);
    return binder.bad(syntax);
  }
  const type = syntax.kind === 'RefTypeExpression' ? binder.core.bridge.coreType('System_Type') : binder.bindType(syntax.type).type;
  return binder.node(syntax.kind === 'RefTypeExpression' ? 'TypedReferenceType' : 'TypedReferenceValue', syntax, type, {
    operand
  });
}
