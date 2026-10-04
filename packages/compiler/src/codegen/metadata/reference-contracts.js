/**
 * The .NET contract assembly a framework type is referenced through (SF-A02-T29).
 *
 * The framework registry models types without their assemblies, and a TypeRef needs a resolution scope the runtime
 * can follow. Most of the base class library is reached through `System.Runtime`; the types below live in other
 * contracts (same public key token). A type that is in neither is referenced through `System.Runtime`, which is
 * stated as a limit of reference-assembly emission: it resolves only if that contract forwards the type.
 */

/** Contract by full metadata name, for namespaces that are split over several contracts. */
const byType = new Map(
  Object.entries({
    'System.Collections': [
      'List`1', 'Dictionary`2', 'HashSet`1', 'Queue`1', 'Stack`1', 'LinkedList`1', 'LinkedListNode`1', 'SortedDictionary`2', 'SortedList`2',
      'SortedSet`1', 'PriorityQueue`2', 'Comparer`1', 'EqualityComparer`1',
    ].map(name => 'System.Collections.Generic.' + name),
    'System.Console': ['System.Console', 'System.ConsoleColor', 'System.ConsoleKey', 'System.ConsoleKeyInfo'],
  }).flatMap(([assembly, names]) => names.map(name => [name, assembly])),
);

/** Contracts that own a whole namespace (and the namespaces nested in it). */
const byNamespace = Object.freeze([
  ['System.Linq.Expressions', 'System.Linq.Expressions'],
  ['System.Linq', 'System.Linq'],
  ['System.Collections.Concurrent', 'System.Collections.Concurrent'],
  ['System.Text.Json', 'System.Text.Json'],
  ['System.Net.Http', 'System.Net.Http'],
]);

/**
 * @param {string} namespace  @param {string} metadataName the type name with its arity suffix
 * @returns {string|undefined} the contract assembly, or undefined for the metadata builder's default
 */
export function contractAssemblyOf(namespace, metadataName) {
  const exact = byType.get(namespace ? namespace + '.' + metadataName : metadataName);
  if (exact) return exact;
  for (const [prefix, assembly] of byNamespace) if (namespace === prefix || namespace.startsWith(prefix + '.')) return assembly;
  return undefined;
}
