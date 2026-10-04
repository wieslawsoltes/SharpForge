import {UnsetValue, PropertyFault} from '../../property/values.js';

/** Evaluate typed metadata tokens through explicit host services, never string-member lookup. */
export function evaluateCompiledExpression(expression, context, depth = 0) {
  if (depth > 32) throw new PropertyFault('InvalidOperationException', 'Compiled expression depth exceeded');
  const {services} = context;
  if (expression.kind === 'constant') return expression.value;
  if (expression.kind === 'context') return context[expression.name] ?? null;
  if (expression.kind === 'path') {
    let value = expression.root ? evaluateCompiledExpression(expression.root, context, depth + 1) : context.source;
    for (const step of expression.steps) {
      if (value === null || value === undefined || value === UnsetValue) {
        if (step.nullConditional) return null;
        return UnsetValue;
      }
      assertCompiledType(value, step.typeToken, services);
      context.observe?.(value, step.token);
      const args = (step.arguments ?? []).map(argument => evaluateCompiledExpression(argument, context, depth + 1));
      if (args.includes(UnsetValue)) return UnsetValue;
      value = services.get(value, step.token, args);
    }
    return value;
  }
  if (expression.kind === 'cast') {
    const value = evaluateCompiledExpression(expression.value, context, depth + 1);
    if (value !== null) assertCompiledType(value, expression.token, services);
    return value;
  }
  if (expression.kind === 'call') {
    const receiver = expression.receiver ? evaluateCompiledExpression(expression.receiver, context, depth + 1) : null;
    if (expression.nullConditional && (receiver === null || receiver === UnsetValue)) return null;
    const args = expression.arguments.map(argument => evaluateCompiledExpression(argument, context, depth + 1));
    if (receiver === UnsetValue || args.includes(UnsetValue)) return UnsetValue;
    return services.invoke(receiver, expression.token, args);
  }
  throw new PropertyFault('InvalidOperationException', 'Unknown compiled expression');
}

/** Write the final path token for a TwoWay expression without BindBack. */
export function writeCompiledPath(expression, value, context) {
  if (expression.kind !== 'path' || !expression.steps.length) {
    throw new PropertyFault('InvalidOperationException', 'TwoWay compiled expression requires a path or BindBack');
  }
  let receiver = expression.root ? evaluateCompiledExpression(expression.root, context) : context.source;
  for (const step of expression.steps.slice(0, -1)) {
    if (receiver === null || receiver === undefined || receiver === UnsetValue) {
      throw new PropertyFault('InvalidOperationException', 'Compiled source path is unavailable');
    }
    assertCompiledType(receiver, step.typeToken, context.services);
    const args = (step.arguments ?? []).map(argument => evaluateCompiledExpression(argument, context));
    receiver = context.services.get(receiver, step.token, args);
  }
  if (receiver === null || receiver === undefined || receiver === UnsetValue) {
    throw new PropertyFault('InvalidOperationException', 'Compiled source receiver is unavailable');
  }
  assertCompiledType(receiver, expression.steps.at(-1).typeToken, context.services);
  const final = expression.steps.at(-1);
  const args = (final.arguments ?? []).map(argument => evaluateCompiledExpression(argument, context));
  return context.services.set(receiver, final.token, value, args);
}

export function assertCompiledType(value, token, services) {
  if (token === undefined) return;
  if (typeof services.isType !== 'function') throw new PropertyFault('NotSupportedException', 'Compiled type tests require a host type service');
  if (!services.isType(value, token)) throw new PropertyFault('InvalidCastException', 'Compiled receiver does not match its metadata type token');
}
