/**
 * Framework types that synthesized code names and the symbol table may not model (SF-A02-T30), such as
 * `System.Environment` in an iterator's `GetEnumerator`. Such a type is a symbol of its own, good for a TypeRef and
 * for signatures; it is not declared in the framework registry, so binding never sees it.
 */
import { NamedTypeSymbol, TypeKind, Accessibility } from '../../symbols/types.js';
import { NamespaceSymbol } from '../../symbols/namespaces.js';

const byCore = new WeakMap();

function namespaceChain(cache, qualifiedName) {
  let current = cache.get('');
  if (!current) cache.set('', (current = new NamespaceSymbol('', null)));
  let path = '';
  for (const part of qualifiedName.split('.')) {
    path = path ? path + '.' + part : part;
    let next = cache.get(path);
    if (!next) cache.set(path, (next = new NamespaceSymbol(part, current)));
    current = next;
  }
  return current;
}

/**
 * The symbol of a framework type by its namespace and name.
 * @param core the CoreTypes of the compilation (the symbols are cached per compilation core)
 * @param {{arity?: number, typeKind?: string}} [shape] a struct must say so: its signatures are `VALUETYPE`
 * @returns a NamedTypeSymbol; a generic one is constructed with `construct(...)`
 */
export function frameworkType(core, namespace, name, { arity = 0, typeKind = TypeKind.Class } = {}) {
  let cache = byCore.get(core);
  if (!cache) byCore.set(core, (cache = { namespaces: new Map(), types: new Map() }));
  const key = `${namespace}.${name}\`${arity}`;
  let type = cache.types.get(key);
  if (!type) {
    type = new NamedTypeSymbol({
      name,
      arity,
      typeKind,
      containingSymbol: namespaceChain(cache.namespaces, namespace),
      declaredAccessibility: Accessibility.Public,
      baseType: () => (typeKind === TypeKind.Struct ? core.valueType : typeKind === TypeKind.Interface ? null : core.object),
    });
    cache.types.set(key, type);
  }
  return type;
}
