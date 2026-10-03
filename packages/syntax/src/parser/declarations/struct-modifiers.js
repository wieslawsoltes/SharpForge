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
  /** Records `private protected` when `kind` completes the pair with a modifier already in `seen`; `token` is the second keyword. */
  privateProtectedFeature(seen, kind, token) {
    if ((kind === 'private' && seen.has('protected')) || (kind === 'protected' && seen.has('private'))) this.feature('PrivateProtected', token);
  }
};
