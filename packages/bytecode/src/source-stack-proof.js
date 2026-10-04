const proofs = new WeakMap();
const handlerFields = ['start', 'end', 'target', 'kind', 'slot', 'handlerEnd', 'type'];

/** Publish bounds only after the existing verifier accepted every method in this image. */
export function recordSourceStacks(image, bounds) {
  const methods = new WeakMap();
  for (let index = 0; index < bounds.length; index++) {
    const [method, peak] = bounds[index];
    methods.set(method, {index, code: method.code, handlers: method.handlers,
      words: method.code.slice(), regions: method.handlers.map(handler => handlerFields.map(field => handler[field])),
      bound: Object.freeze({peak})});
  }
  proofs.set(image, {methods: image.methods, entries: methods});
}

export function discardSourceStacks(image) {
  proofs.delete(image);
}

/** Exact image/method-body proof, or null. Cold admission costs O(code + handlers). */
export function verifiedSourceStackBound(image, method) {
  const proof = proofs.get(image);
  if (!proof || proof.methods !== image.methods) return null;
  const entry = proof.entries.get(method);
  if (!entry || image.methods[entry.index] !== method || method.code !== entry.code || method.handlers !== entry.handlers ||
      method.code.length !== entry.words.length || method.handlers.length !== entry.regions.length) return null;
  for (let index = 0; index < entry.words.length; index++) {
    if (method.code[index] !== entry.words[index]) return null;
  }
  for (let index = 0; index < entry.regions.length; index++) {
    const handler = method.handlers[index];
    if (!handler) return null;
    for (let field = 0; field < handlerFields.length; field++) {
      if (handler[handlerFields[field]] !== entry.regions[index][field]) return null;
    }
  }
  return entry.bound;
}
