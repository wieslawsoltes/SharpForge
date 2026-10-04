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
  iasyncEnumeratorT: { DisposeAsync: { type: 'iasyncDisposable' } },
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
 * The generic method a framework method really is. The symbol table lists `Task.FromResult` and `Task.Run` once per
 * result type; .NET declares `FromResult<TResult>(TResult)` and `Run<TResult>(Func<TResult>)`.
 * @param core the CoreTypes  @param method a method symbol  @param {(ordinal: number) => object} typeParameter the
 *   symbol of the method type parameter `!!ordinal`
 * @returns {{name: string, shape: object, typeArguments: object[]}|null} null for a method that is what it seems
 *   (every other method, and the generic methods of a reference assembly)
 */
export function genericFrameworkMethod(core, method, typeParameter) {
  const owner = method.containingType?.originalDefinition ?? method.containingType,
    parameter = method.parameters?.length === 1 ? method.parameters[0].type : null;
  if (owner !== core.task || !method.isStatic || !parameter) return null;
  // A method imported from a reference assembly is declared as it is in .NET: generic, and named by its own signature.
  if ((method.originalDefinition ?? method).arity) return null;
  const result = typeParameter(0),
    shapeOver = parameterType => ({ isStatic: true, arity: 1, returnType: core.taskT.construct(result), parameters: [{ type: parameterType }] });
  if (method.name === 'FromResult') return { name: 'FromResult', shape: shapeOver(result), typeArguments: [parameter] };
  const isFunction = parameter.originalDefinition?.name === 'Func' && parameter.typeArguments?.length === 1;
  if (method.name !== 'Run' || !isFunction) return null;
  return { name: 'Run', shape: shapeOver(parameter.originalDefinition.construct(result)), typeArguments: [parameter.typeArguments[0].type] };
}

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
