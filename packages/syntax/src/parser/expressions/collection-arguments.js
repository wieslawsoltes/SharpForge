/**
 * C# 15 preview collection expression arguments: `[with(capacity: 10), a, b]`. The `with(...)` element passes
 * arguments to the constructor or factory of the collection and must be the first element. The grammar follows the
 * csharplang proposal pinned in preview-revisions.js. The pinned Roslyn build does not parse it yet (it sees a call
 * to a method named `with`), so there is no reference tree for the WithElement node.
 * `with` is a keyword here only at preview: at C# 14 and below `[with(x)]` keeps its old meaning, a collection whose
 * first element is a call to a method named `with`, exactly as that Roslyn build reads it.
 */
export const collectionArgumentMethods = {
  /** True when the first element of a collection expression is the `with(...)` argument element. */
  isCollectionArguments() {
    return this.languageVersion >= 15 && this.atWord('with') && this.peek().kind === '(';
  },
  collectionArguments() {
    this.feature('CollectionExpressionArguments', this.current);
    return this.n('WithElement', this.takeWord('with'), this.argumentList());
  }
};
