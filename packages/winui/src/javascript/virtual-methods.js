/** Resolve a user override without executing accessors or rebuilding framework prototype metadata per invocation. */
export function resolveJavaScriptOverride(context, receiver, name) {
  if (!context.frameworkPrototypes || context.frameworkPrototypeCount !== context.classes.size) {
    context.frameworkPrototypes = new Set([...context.classes.values()].map(Type => Type.prototype));
    context.frameworkPrototypeCount = context.classes.size;
  }
  const method = name.split('(')[0];
  for (let prototype = receiver; prototype && !context.frameworkPrototypes.has(prototype); prototype = Object.getPrototypeOf(prototype)) {
    const callback = Object.getOwnPropertyDescriptor(prototype, method)?.value;
    if (typeof callback === 'function') return callback;
  }
  return null;
}
