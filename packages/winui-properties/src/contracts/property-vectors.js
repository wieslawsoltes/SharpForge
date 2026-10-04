const prefix = 'Windows.Foundation.Collections.';
export const vectorElementTypes = Object.freeze(['object', 'string', 'int', 'double', 'bool', 'Microsoft.UI.Xaml.UIElement']);

/** WinRT vector interfaces are appended without replacing the released collection contracts. */
export function registerVectorContracts(registry) {
  const {define, prop, delegate, event, types, CONTROLS} = registry;
  define(prefix + 'IVectorChangedEventArgs', {kind: 'interface'});
  prop(prefix + 'IVectorChangedEventArgs', 'CollectionChange', prefix + 'CollectionChange', 0, true);
  prop(prefix + 'IVectorChangedEventArgs', 'Index', 'uint', 0, true);
  types.get(prefix + 'VectorChangedEventArgs').interfaces = [prefix + 'IVectorChangedEventArgs'];
  for (const element of vectorElementTypes) {
    const vector = prefix + `IVector\`1<${element}>`;
    const observable = prefix + `IObservableVector\`1<${element}>`;
    const view = prefix + `IVectorView\`1<${element}>`;
    define(view, {kind: 'interface', elementType: element});
    define(vector, {kind: 'interface', elementType: element});
    define(observable, {kind: 'interface', base: vector, interfaces: [vector], elementType: element});
    readMembers(registry, view, element);
    readMembers(registry, vector, element);
    writeMembers(registry, vector, element, view);
    const handler = prefix + `VectorChangedEventHandler\`1<${element}>`;
    delegate(handler, [observable, prefix + 'IVectorChangedEventArgs']);
    event(observable, 'VectorChanged', handler);
  }
  for (const [name, element] of [['ItemCollection', 'object'], ['UIElementCollection', 'Microsoft.UI.Xaml.UIElement']]) {
    const owner = CONTROLS + name;
    const type = types.get(owner);
    type.elementType = element;
    type.interfaces = [...(type.interfaces ?? []), prefix + `IObservableVector\`1<${element}>`];
    readMembers(registry, owner, element);
    writeMembers(registry, owner, element, prefix + `IVectorView\`1<${element}>`);
    if (!registry.memberIndex.has(owner + '::set_Item')) registry.member(owner, 'set_Item', ['int', element], 'void');
  }
}

function readMembers({prop, member}, owner, element) {
  prop(owner, 'Size', 'uint', 0, true);
  member(owner, 'GetAt', ['uint'], element);
  member(owner, 'IndexOf', [element, 'uint&'], 'bool');
  member(owner, 'GetMany', ['uint', element + '[]'], 'uint');
}

function writeMembers({member}, owner, element, view) {
  for (const [name, parameters, result] of [
    ['GetView', [], view], ['SetAt', ['uint', element], 'void'], ['InsertAt', ['uint', element], 'void'],
    ['RemoveAt', ['uint'], 'void'], ['Append', [element], 'void'], ['RemoveAtEnd', [], 'void'],
    ['ReplaceAll', [element + '[]'], 'void']
  ]) member(owner, name, parameters, result);
  if (owner.startsWith(prefix)) member(owner, 'Clear', [], 'void');
}
