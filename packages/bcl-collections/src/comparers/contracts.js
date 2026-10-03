/** Append the released .NET comparer signature in A08, without renumbering legacy contracts. */
export function registerOrderingExtensions(registry) {
  registry.member('System.Collections.Generic.List`1<string>', 'Sort', ['System.Collections.Generic.IComparer`1<string>'], 'void');
}
