/** Preserve CLI exception identity in handler metadata instead of a local alias. */
export function exceptionTypeName(type) {
  if (!type) return 'System.Exception';
  const name = typeof type === 'string' ? type : type.toDisplayString();
  return name === 'Exception' ? 'System.Exception' : name;
}

/** The legacy execution binder follows existing symbol bases; the semantic binder owns C# catch rules. */
export function isExceptionType(compilation, name) {
  if (name === 'Exception' || name === 'System.Exception' || name === 'error') return true;
  const seen = new Set();
  for (let type = compilation.semantic.typeOf(name); type && !seen.has(type); type = type.baseType) {
    if (type.isErrorType?.()) return true;
    if (exceptionTypeName(type) === 'System.Exception') return true;
    seen.add(type);
  }
  return false;
}

/** Exception upcasts preserve the managed object and its actual runtime type. */
export function isExceptionUpcast(from, to, exception) {
  const derives = (type, target) => {
    const seen = new Set();
    for (; type && !seen.has(type); type = type.baseType) {
      if (type === target) return true;
      seen.add(type);
    }
    return false;
  };
  return !!exception && derives(to, exception) && derives(from, to);
}
