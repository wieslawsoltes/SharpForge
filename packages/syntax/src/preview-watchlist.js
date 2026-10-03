/**
 * The preview watchlist: every csharplang proposal with new syntax that the parser tracks, and what the parser does
 * with it. It is reviewed whenever the pinned csharplang commit in preview-revisions.js moves (at least quarterly):
 * list the proposals under `proposals/csharp-15.0/` at the new commit, add any new one here, and either implement it
 * with fixtures and a revision stamp or reject it with the explicit unsupported-preview diagnostic (SF1098).
 *
 * `status` is 'implemented' (the entry names the catalog features that gate it; each has matrix fixtures and a
 * revision stamp) or 'unsupported' (the parser recognises the form and reports SF1098; `sample` is source that
 * triggers it).
 */
export const previewWatchlistCommit = '412dc3023500b69f684c365762e38db6ee7564ea';
/** The proposals under `proposals/csharp-15.0/` at the pinned commit; every one must have a watchlist entry. */
export const pinnedPreviewProposals = Object.freeze([
  'csharp-15.0/closed-hierarchies.md',
  'csharp-15.0/collection-expression-arguments.md',
  'csharp-15.0/extension-indexers.md',
  'csharp-15.0/labeled-break-continue.md',
  'csharp-15.0/unions.md'
]);
const implemented = (proposal, ...features) => Object.freeze({ proposal, status: 'implemented', features: Object.freeze(features) });
const unsupported = (proposal, form, sample) => Object.freeze({ proposal, status: 'unsupported', form, sample });
export const previewWatchlist = Object.freeze([
  implemented('csharp-15.0/closed-hierarchies.md', 'ClosedClasses'),
  implemented('csharp-15.0/collection-expression-arguments.md', 'CollectionExpressionArguments'),
  implemented('csharp-15.0/extension-indexers.md', 'ExtensionIndexers'),
  implemented('csharp-15.0/labeled-break-continue.md', 'LabeledBreakContinue'),
  implemented('csharp-15.0/unions.md', 'Unions'),
  implemented('closed-enums.md', 'ClosedEnums'),
  implemented('unsafe-evolution.md', 'SafeModifier', 'UnsafeExpressions'),
  // Not yet under csharp-15.0 at the pinned commit; its grammar adds `expression ':' expression` collection elements.
  unsupported('dictionary-expressions.md', 'key: value collection elements', 'class C { object M() => [1: "one", 2: "two"]; }')
]);
/** The watchlist entry for a proposal path (relative to `csharplang/proposals/`), or undefined. */
export function previewWatchlistEntry(proposal) {
  return previewWatchlist.find(entry => entry.proposal === proposal);
}
