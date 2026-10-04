/** Preserve local CLI method tokens and CIL offsets with explicit assembly identity for linked source frames. */
export function projectGraphDebug(image, modules) {
  const byKey = new Map(modules.map(module => [module.key, module]));
  const methodTokens = [];
  const offsets = [];
  const methodAssemblyKeys = [];
  for (const method of image.methods) {
    const module = byKey.get(method.assemblyKey);
    const local = method.id - module.offsets.methods;
    methodTokens.push(method.synthetic ? null : module.image.il.methodTokens[local]);
    offsets.push(method.synthetic ? [] : [...module.image.il.offsets[local]]);
    methodAssemblyKeys.push(module.key);
  }
  return {methodTokens, offsets, methodAssemblyKeys};
}
