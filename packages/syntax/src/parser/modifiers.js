/** Declaration and parameter modifiers: the full C# 1 set plus the contextual `partial` and `async`. */
export const declarationModifiers = Object.freeze(
  new Set([
    'public',
    'private',
    'protected',
    'internal',
    'static',
    'readonly',
    'const',
    'sealed',
    'new',
    'virtual',
    'override',
    'abstract',
    'extern',
    'volatile',
    'unsafe',
    'partial',
    'async',
    'ref',
    'fixed'
  ])
);
export const accessibilityModifiers = Object.freeze(new Set(['public', 'private', 'protected', 'internal']));
export const parameterModifiers = Object.freeze(new Set(['this', 'ref', 'out', 'in', 'params', 'readonly']));
const typeKeywords = ['class', 'struct', 'interface', 'enum', 'delegate', 'event', 'namespace'];
export const modifierMethods = {
  /** True when the token at `index` is used as a modifier (contextual words only when a declaration follows). */
  isModifier(index = this.i, member = true) {
    const token = this.tokens[index],
      kind = token.kind,
      next = this.tokens[Math.min(index + 1, this.tokens.length - 1)];
    if (kind === 'identifier') return !token.flags && (this.isRequiredModifier(index) || this.isClosedModifier(index) || this.isSafeModifier(index));
    if (!declarationModifiers.has(kind)) return false;
    if (kind === 'async') return this.isAsyncModifier(index);
    if (kind === 'partial') return !token.flags && this.canFollowContextualModifier(next);
    if (kind === 'ref') return this.isRefStructModifier(index);
    if (kind === 'fixed') return false;
    if (kind === 'new')
      return member && (declarationModifiers.has(next.kind) || typeKeywords.includes(next.kind) || this.isPredefined(next) || this.isId(next));
    if (kind === 'unsafe') return next.kind !== '{';
    return true;
  },
  /**
   * True when a declaration can continue at `next` after a contextual modifier: another modifier, a type keyword or a type
   * name. With `index` (the position of `next`) a plain identifier must be a type followed by a member name, so a word
   * that is itself used as a type name (`safe x;`, `safe M()`) is not taken for a modifier, except before a constructor.
   */
  canFollowContextualModifier(next, index) {
    if ((declarationModifiers.has(next.kind) && next.kind !== 'new') || typeKeywords.includes(next.kind) || this.isPredefined(next)) return true;
    if (!this.isId(next)) return false;
    if (index === undefined) return true;
    if (this.isRequiredModifier(index) || this.isClosedModifier(index) || this.isWord(next, 'record')) return true;
    const end = this.scanType(index);
    if (end === index + 1 && this.kindAt(end) === '(') return next.value === this.owner;
    return end > index && (this.isId(this.tokens[end]) || this.kindAt(end) === 'this' || this.kindAt(end) === 'operator');
  },
  /** Parses a modifier list; duplicates report CS1004 and `protected internal` / `private protected` are kept as two tokens. */
  modifiers(member = true) {
    const list = [],
      seen = new Set();
    while (this.isModifier(this.i, member)) {
      const token = this.current,
        kind = token.kind === 'identifier' ? token.value : token.kind;
      if (seen.has(kind)) this.error(token, 'CS1004', `Duplicate '${kind}' modifier`);
      seen.add(kind);
      if (token.kind === 'identifier') {
        if (kind === 'required') this.feature('RequiredMembers', token);
        else if (kind === 'closed') this.closedAt = token;
        else this.safeModifier(token);
        list.push(this.takeWord(kind));
        continue;
      }
      this.privateProtectedFeature(seen, kind, token);
      list.push(kind === 'partial' || kind === 'async' ? this.takeWord(kind) : this.take());
    }
    return list;
  },
  /** Parameter modifiers: this, ref, out, in, params, readonly and the contextual `scoped`. */
  parameterModifiers() {
    const list = [],
      seen = new Set();
    for (;;) {
      const token = this.current,
        kind = token.kind;
      if (
        this.atWord('scoped') &&
        (parameterModifiers.has(this.peek().kind) || (this.scanType(this.i + 1) >= 0 && this.isId(this.tokens[this.scanType(this.i + 1)])))
      ) {
        list.push(this.takeWord('scoped'));
        continue;
      }
      if (!parameterModifiers.has(kind)) break;
      if (seen.has(kind)) this.error(token, 'CS1107', `A parameter can only have one '${kind}' modifier`);
      seen.add(kind);
      if (kind === 'this') this.feature('ExtensionMethod', token);
      else if (kind === 'in') this.feature('ReadOnlyReferences', token);
      else if (kind === 'readonly') this.feature('RefReadonlyParameters', token);
      list.push(this.take());
    }
    return list;
  }
};
