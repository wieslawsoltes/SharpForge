/**
 * C# 7.2 struct modifiers and accessibility: `readonly struct`, `ref struct`, `readonly ref struct` (also on record
 * structs) and the `private protected` accessibility pair, written in either order.
 */
const structKinds = new Set(['StructDeclaration', 'RecordStructDeclaration']);
export const structModifierMethods = {
  /** `ref` before `struct` (or `partial struct`) is the ref-struct modifier; anywhere else it starts a ref return type. */
  isRefStructModifier(index) {
    const next = this.kindAt(index + 1);
    return next === 'struct' || (next === 'partial' && this.kindAt(index + 2) === 'struct');
  },
  /** The C# 7.2 feature a modifier implies on a type declaration of `kind`, or null. */
  structModifierFeature(modifier, kind) {
    if (modifier.kind === 'RefKeyword') return 'RefStructs';
    return modifier.kind === 'ReadOnlyKeyword' && structKinds.has(kind) ? 'ReadOnlyStructs' : null;
  },
  /**
   * Records the features of the modifier tokens [from, to) that Roslyn reports at the declared name: `private protected`
   * (C# 7.2) and `required` (C# 11). `nameToken` is the name of the member or type, or the accessor keyword.
   */
  modifierNameFeatures(from, to, nameToken) {
    let isPrivate = false,
      isProtected = false;
    for (let i = from; i < to; i++) {
      const token = this.tokens[i];
      if (token.kind === 'private') isPrivate = true;
      else if (token.kind === 'protected') isProtected = true;
      else if (token.kind === 'identifier' && token.value === 'required') this.feature('RequiredMembers', nameToken);
    }
    if (isPrivate && isProtected) this.feature('PrivateProtected', nameToken);
  },
  /** The name token of the type declaration that starts at the cursor (at its keyword), or null. */
  typeNameAhead() {
    const kind = this.current.kind;
    if (kind === 'class' || kind === 'struct' || kind === 'interface' || kind === 'enum') return this.peek();
    if (kind === 'delegate') return this.tokens[Math.max(this.scanType(this.i + 1), 0)];
    if (this.isWord(this.current, 'record')) return this.peek().kind === 'class' || this.peek().kind === 'struct' ? this.peek(2) : this.peek();
    return null;
  }
};
