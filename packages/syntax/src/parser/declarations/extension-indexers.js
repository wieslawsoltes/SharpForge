/**
 * C# 15 preview (provisional): extension indexers - `this[...]` members inside an extension block, per the pinned
 * csharplang proposal (see preview-revisions.js). The member is an ordinary IndexerDeclaration; this module only
 * gates it, so LangVersion 14 and lower report the preview-feature diagnostic CS8652.
 */
export const extensionIndexerMethods = {
  /** Called for every indexer declaration; `token` is the `this` keyword. */
  extensionIndexer(token) { if (this.inExtension) this.feature('ExtensionIndexers', token); }
};
