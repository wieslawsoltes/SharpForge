/**
 * C# 15 preview collection expression arguments: `[with(capacity: 10), a, b]`. The `with(...)` element passes
 * arguments to the constructor or factory of the collection and must be the first element. The grammar follows the
 * csharplang proposal pinned in preview-revisions.js. The pinned Roslyn build does not parse it yet (it sees a call
 * to a method named `with`), so there is no reference tree for the WithElement node.
 * As the proposal specifies, an element that starts with the tokens `with` `(` is always this element.
 * `with` is a keyword here only at preview: at C# 14 and below `[with(x)]` keeps its old meaning, a collection whose
 * first element is a call to a method named `with`, exactly as that Roslyn build reads it.
 */
export const collectionArgumentMethods = {
  /** True when the first element of a collection expression is the `with(...)` argument element. */
  isCollectionArguments() {
    return this.languageVersion >= 15 && this.atWord('with') && this.peek().kind === '(';
  },
  /** `with(arguments)`. The proposal makes it an error anywhere but in first position; the element is parsed all the same. */
  collectionArguments(first) {
    const keyword = this.current;
    this.feature('CollectionExpressionArguments', keyword);
    if (!first) this.error(keyword, 'SF1097', "A 'with(...)' element must be the first element of a collection expression");
    return this.n('WithElement', this.takeWord('with'), this.argumentList());
  },
  /**
   * `key: value` in a collection expression is the dictionary-expressions proposal, which is not part of the pinned
   * preview grammar (see preview-watchlist.js). The form is reported with the explicit unsupported-preview diagnostic
   * and `: value` is kept in the tree as skipped text. The cursor is at the `:`.
   */
  unsupportedKeyValueElement() {
    this.error(this.current, 'SF1098', "Dictionary expression elements ('key: value') are not in the pinned preview grammar; this form is not supported");
    const mark = this.mark();
    this.take();
    this.expression();
    const end = this.i;
    this.reset(mark);
    while (this.i < end) this.skip();
  }
};
