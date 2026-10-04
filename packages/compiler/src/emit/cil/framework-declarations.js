/**
 * Where a framework interface member is really declared (SF-A02-T30). The symbol table gives a generic collection
 * interface the members of the interfaces it inherits (`IEnumerator<T>.MoveNext`), which is all binding needs. A
 * MemberRef must name the declaring interface, or .NET reports `MissingMethodException`.
 */

const COLLECTION_MEMBERS = ['get_Count', 'get_IsReadOnly', 'Add', 'Clear', 'Contains', 'CopyTo', 'Remove'];

/** Interface definition (core type name) -> member name -> `{type, isGeneric}`: the core type that declares it. */
const declaredElsewhere = Object.freeze({
  ienumeratorT: {
    MoveNext: { type: 'ienumerator' },
    Reset: { type: 'ienumerator' },
    Dispose: { type: 'idisposable' },
  },
  icollectionT: { GetEnumerator: { type: 'ienumerableT', isGeneric: true } },
  ilistT: {
    GetEnumerator: { type: 'ienumerableT', isGeneric: true },
    ...Object.fromEntries(COLLECTION_MEMBERS.map(name => [name, { type: 'icollectionT', isGeneric: true }])),
  },
  ireadOnlyCollectionT: { GetEnumerator: { type: 'ienumerableT', isGeneric: true } },
  ireadOnlyListT: {
    GetEnumerator: { type: 'ienumerableT', isGeneric: true },
    get_Count: { type: 'ireadOnlyCollectionT', isGeneric: true },
  },
});

/**
 * The interface that declares member `name` of the framework interface `owner`.
 * @param core the CoreTypes of the compilation  @param owner a type symbol, possibly constructed
 * @returns the declaring type, constructed over the type arguments of `owner`; `owner` itself when it declares the member
 */
export function declaringInterfaceOf(core, owner, name) {
  const definition = owner.originalDefinition ?? owner;
  for (const [coreName, members] of Object.entries(declaredElsewhere)) {
    if (core[coreName] !== definition) continue;
    const target = members[name];
    if (!target) return owner;
    return target.isGeneric ? core[target.type].construct(owner.typeArguments.map(argument => argument.type)) : core[target.type];
  }
  return owner;
}
