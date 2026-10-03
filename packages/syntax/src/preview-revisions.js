/**
 * Revision stamps for preview (C# 15) features. Preview grammar is provisional: it follows public csharplang
 * proposals that can still change, so every feature is pinned to the proposal file and the csharplang commit its
 * grammar was read from, the revision of the SharpForge grammar written against it, and the SDK build whose Roslyn
 * parser the reference trees come from. `roslyn` is false where that Roslyn build does not parse the feature yet:
 * those node kinds are SharpForge's own and no reference tree exists. A preview feature without a stamp fails the
 * catalog tests, and changing a stamp fails the preview fixture test until the fixtures are reviewed.
 */
const sdk = '.NET SDK 10.0.201 (Roslyn 5.3.0-2.26153.122+4d3023de605a78ba3e59e50c657eed70f125c68a)';
const commit = '412dc3023500b69f684c365762e38db6ee7564ea';
const stamp = (proposal, revision, roslyn) => Object.freeze({ proposal: 'csharplang/proposals/' + proposal, revision, commit, sdk, roslyn });
export const previewRevisions = Object.freeze({
  CollectionExpressionArguments: stamp('csharp-15.0/collection-expression-arguments.md', 1, false),
  LabeledBreakContinue: stamp('csharp-15.0/labeled-break-continue.md', 1, false),
  ExtensionIndexers: stamp('csharp-15.0/extension-indexers.md', 1, true),
  Unions: stamp('csharp-15.0/unions.md', 1, false),
  ClosedClasses: stamp('csharp-15.0/closed-hierarchies.md', 1, false),
  ClosedEnums: stamp('closed-enums.md', 1, false),
  SafeModifier: stamp('unsafe-evolution.md', 1, false),
  UnsafeExpressions: stamp('unsafe-evolution.md', 1, false)
});
/** `proposal revision N` text for diagnostics about feature `id`. */
export function previewStampText(id) {
  const entry = previewRevisions[id];
  return entry ? `${entry.proposal} revision ${entry.revision}` : 'no pinned proposal';
}
/**
 * The explicit diagnostic for preview syntax that the pinned proposal revision does not define: [code, message].
 * SF1098 is SharpForge's; Roslyn has no counterpart because it would report plain syntax errors.
 */
export function unsupportedPreview(id, detail) {
  return ['SF1098', `${detail} in the pinned preview grammar (${previewStampText(id)}); this form is not supported`];
}
