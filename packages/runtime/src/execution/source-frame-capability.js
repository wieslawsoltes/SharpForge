const capabilities = new WeakMap();

/** Cold storage authority contains code metadata only; no VM, pool, bucket, frame or managed value escapes. */
export function sourceFrameCapability(image, methodId, capacity) {
  const method = image.methods[methodId];
  const capability = Object.freeze({});
  capabilities.set(capability, Object.freeze({image, methodId, method, locals: method.locals,
    localCount: method.locals.length, capacity}));
  return capability;
}

/** Resolve only tokens issued by source call preparation, never caller-supplied bucket-shaped objects. */
export function sourceFramePreparation(capability) {
  return capabilities.get(capability);
}
