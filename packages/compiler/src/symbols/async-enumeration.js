/**
 * The async-stream interfaces (SF-A02-T09.4): `IAsyncEnumerable<T>`, `IAsyncEnumerator<T>` and `IAsyncDisposable`
 * with the members `await foreach`, `await using` and async iterators use. The framework registry does not list
 * them; the core library of a compilation gets them here, once per bridge.
 */
import { TypeWithAnnotations, Accessibility, Variance } from './types.js';
import { MethodSymbol, PropertySymbol, ParameterSymbol, MethodKind, DeclarationModifiers } from './members.js';

function addMethod(owner, name, returnType, parameters = []) {
  if (owner.getMembers(name).length) return;
  owner.addMember(
    new MethodSymbol({
      name,
      returnType,
      parameters,
      declaredAccessibility: Accessibility.Public,
      modifiers: DeclarationModifiers.Abstract,
      isImplicitlyDeclared: true,
    }),
  );
}

function addCurrent(enumerator, element) {
  if (enumerator.getMembers('Current').length) return;
  const get = new MethodSymbol({
    name: 'get_Current',
    methodKind: MethodKind.PropertyGet,
    returnType: element,
    declaredAccessibility: Accessibility.Public,
    modifiers: DeclarationModifiers.Abstract,
    isImplicitlyDeclared: true,
  });
  enumerator.addMember(get);
  enumerator.addMember(
    new PropertySymbol({ name: 'Current', type: element, getMethod: get, declaredAccessibility: Accessibility.Public, isImplicitlyDeclared: true }),
  );
}

/**
 * Resolves the async-stream types on `core` (`iasyncEnumerableT`, `iasyncEnumeratorT`, `iasyncDisposable`) and gives
 * them their members.
 * @param core the CoreTypes being built (`bridge`, `bool`, `valueTask`, `valueTaskT`)
 */
export function declareAsyncEnumeration(core) {
  const bridge = core.bridge,
    enumerable = bridge.coreType('System_Collections_Generic_IAsyncEnumerable_T'),
    enumerator = bridge.coreType('System_Collections_Generic_IAsyncEnumerator_T'),
    disposable = bridge.coreType('System_IAsyncDisposable');
  core.iasyncEnumerableT = enumerable;
  core.iasyncEnumeratorT = enumerator;
  core.iasyncDisposable = disposable;
  if (bridge.asyncEnumerationDeclared) return;
  bridge.asyncEnumerationDeclared = true;
  for (const type of [enumerable, enumerator]) for (const parameter of type.typeParameters) parameter.variance = Variance.Out;
  const element = new TypeWithAnnotations(enumerable.typeParameters[0]),
    token = bridge.typeFromName?.('System.Threading.CancellationToken') ?? null;
  // `GetAsyncEnumerator(CancellationToken cancellationToken = default)`.
  const cancellation = token
    ? [new ParameterSymbol({ name: 'cancellationToken', type: token, isOptional: true, explicitDefaultValue: { value: null } })]
    : [];
  addMethod(enumerable, 'GetAsyncEnumerator', enumerator.construct(element), cancellation);
  addMethod(enumerator, 'MoveNextAsync', core.valueTaskT.construct(core.bool));
  addCurrent(enumerator, enumerator.typeParameters[0]);
  addMethod(disposable, 'DisposeAsync', core.valueTask);
  addMethod(enumerator, 'DisposeAsync', core.valueTask);
  if (!enumerator.interfaces.length) enumerator._interfaces = [disposable];
}
