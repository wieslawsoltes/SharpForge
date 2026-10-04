/**
 * Source types visible only within one file, indexed by their source namespace, simple name and arity.
 * Namespace identity keeps an extern alias from accidentally finding a type from the current source file.
 */
export class FileLocalTypes {
  constructor(uri) {
    this.uri = uri;
    this.namespaces = new Map();
  }

  add(type) {
    const namespace = type.containingNamespace;
    let names = this.namespaces.get(namespace);
    if (!names) {
      names = new Map();
      this.namespaces.set(namespace, names);
    }
    let arities = names.get(type.name);
    if (!arities) {
      arities = new Map();
      names.set(type.name, arities);
    }
    arities.set(type.arity, type);
  }

  /** Matching file-local declarations, or null when ordinary namespace lookup should continue. */
  getTypeMembers(namespace, name, arity) {
    if (!this.namespaces.size) return null;
    for (const constituent of namespace.constituentNamespaces) {
      const arities = this.namespaces.get(constituent)?.get(name);
      if (!arities) continue;
      if (arity === undefined) return [...arities.values()];
      const type = arities.get(arity);
      if (type) return [type];
    }
    return null;
  }
}
