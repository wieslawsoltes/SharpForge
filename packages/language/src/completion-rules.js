/** C# method names accept an invocation opener; other item kinds keep their own provider rules. */
export function withCSharpCommitCharacters(item) {
  if (item.kind !== 'method' || item.commitCharacters !== undefined) return item;
  return {...item, commitCharacters: ['(']};
}
