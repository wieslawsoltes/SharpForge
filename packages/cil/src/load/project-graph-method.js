/** Reserve adapters before building their bodies so nested adapter creation cannot reuse a method ID. */
export function appendProjectMethod(image, binding, {name, parameters, returnType}, build) {
  const id = image.methods.length;
  const owner = binding.module.mapType(binding.type.source.name);
  const locals = parameters.map((type, slot) => ({slot, name: 'argument' + slot, type}));
  const method = {id, name, qualifiedName: owner + '.' + name, owner, isStatic: true,
    returnType, parameters: parameters.map((type, index) => ({name: 'argument' + index, type})),
    locals, handlers: [], assemblyKey: binding.module.key, synthetic: 'project-reference', code: new Int32Array()};
  image.methods.push(method);
  const code = [];
  build(code, method);
  method.code = Int32Array.from(code);
  return id;
}

export function emitProjectCode(code, operation, argument = 0, count = 0) {
  code.push(operation, argument, count);
}
