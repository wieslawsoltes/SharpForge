/**
 * Revision stamps for preview (C# 15) features: the csharplang proposal the grammar follows, the revision of the
 * SharpForge grammar pinned against it, and the SDK build whose Roslyn parser the reference trees were dumped from.
 * A preview feature without a stamp fails the catalog tests, so grammar drift is always an explicit change here.
 */
const sdk = '.NET SDK 10.0.201 (Roslyn 5.3.0-2.26153.122+4d3023de605a78ba3e59e50c657eed70f125c68a)';
export const previewRevisions = Object.freeze({
  CollectionExpressionArguments: Object.freeze({ proposal: 'csharplang/proposals/collection-expression-arguments.md', revision: 1, sdk }),
  LabeledBreakContinue: Object.freeze({ proposal: 'csharplang/proposals/labeled-break-continue.md', revision: 1, sdk })
});
