/**
 * C# 13 forms that hook into older grammar: `params` on a parameter whose type is not an array (params collections)
 * and the `allows ref struct` anti-constraint. Each is recorded where Roslyn reports it.
 * An index-from-end key in an object initializer (`new T { [^1] = v }`) needs no syntax of its own: it is an index
 * initializer whose argument is an index expression, and whether it uses an implicit indexer is decided when the
 * indexer is bound.
 */
export const csharp13Methods = {
  /**
   * Called for a parameter whose modifier tokens are [from, to) and whose type node is `type`: `params` before
   * anything but an array type is a params collection, reported over the whole parameter.
   */
  paramsCollection(from, to, type) {
    if (type.kind === 'ArrayType') return;
    for (let i = from; i < to; i++)
      if (this.tokens[i].kind === 'params') {
        this.feature('ParamsCollections', this.tokens[i], this.tokens[this.i - 1]);
        return;
      }
  },
  /** `allows ref struct` (and further `, ref struct` entries) in a constraint clause; the cursor is at `allows`. */
  allowsConstraint() {
    const allows = this.takeWord('allows'),
      list = [];
    for (;;) {
      const start = this.current,
        ref = this.expect('ref'),
        struct = this.expect('struct');
      this.feature('AllowsRefStructConstraint', start, this.tokens[this.i - 1]);
      list.push(this.n('RefStructConstraint', ref, struct));
      if (this.at(',') && this.peek().kind === 'ref') list.push(this.take());
      else break;
    }
    return this.n('AllowsConstraintClause', allows, list);
  }
};
