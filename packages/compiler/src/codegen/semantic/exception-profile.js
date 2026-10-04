/** Resolve a closed registered exception name; user-defined exception storage stays outside this profile. */
export function registeredCatchType(generator, type, syntax) {
  const name = generator.bridge.registryName(type);
  const seen = new Set();
  for (let current = type; current && seen.size < 256 && !seen.has(current); current = current.baseType) {
    if (current.equals(generator.analysis.core.exception) && name) return name;
    seen.add(current);
  }
  return generator.unsupported('a catch type outside the registered exception hierarchy', syntax);
}
