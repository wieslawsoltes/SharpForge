const capabilities = new WeakMap();

/** Prepared storage authority contains metadata only; reusable frames remain private to each pool. */
export function cilFrameCapability(inspector, method, argumentCount) {
  const capability = Object.freeze({});
  capabilities.set(capability, Object.freeze({inspector, method, argumentCount, signature: method.signature,
    parameters: method.signature.parameters, parameterCount: method.signature.parameters.length,
    locals: method.locals, localCount: method.locals.length, maxStack: method.maxStack}));
  return capability;
}

/** Caller-created objects cannot stand in for issued preparation tokens. */
export function cilFramePreparation(capability) {
  return capabilities.get(capability);
}

export function cilFramePreparationCurrent(inspector, plan) {
  const method = plan?.method;
  return plan?.inspector === inspector && inspector.getMethod(method.token) === method &&
    method.signature === plan.signature && method.signature.parameters === plan.parameters &&
    method.signature.parameters.length === plan.parameterCount && method.locals === plan.locals &&
    method.locals.length === plan.localCount && method.maxStack === plan.maxStack;
}
