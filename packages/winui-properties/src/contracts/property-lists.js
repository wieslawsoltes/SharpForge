const generic = 'System.Collections.Generic.';
const elements = Object.freeze(['object', 'string', 'int', 'double', 'bool', 'Microsoft.UI.Xaml.UIElement']);

/** The indexed list bridge declares its actual interface ancestry instead of relying on runtime-only intrinsic names. */
export function registerListContracts(registry) {
  const {define, types, member, prop} = registry;
  const declare = (name, interfaces = [], extra = {}) => {
    if (!types.has(name)) define(name, {kind: 'interface', interfaces, ...extra});
    else if (!types.get(name).typeKind) types.get(name).typeKind = 'interface';
  };
  const method = (owner, name, parameters, result) => {
    const existing = registry.memberIndex.get(owner + '::' + name) ?? [];
    if (!existing.some(item => item.parameters.join(',') === parameters.join(','))) member(owner, name, parameters, result);
  };
  const property = (owner, name, type, value) => {
    if (!types.get(owner).properties[name]) prop(owner, name, type, value, true);
  };
  declare('System.IDisposable');
  method('System.IDisposable', 'Dispose', [], 'void');
  declare('System.Collections.IEnumerator');
  property('System.Collections.IEnumerator', 'Current', 'object', null);
  method('System.Collections.IEnumerator', 'MoveNext', [], 'bool');
  method('System.Collections.IEnumerator', 'Reset', [], 'void');
  declare('System.Collections.IEnumerable');
  method('System.Collections.IEnumerable', 'GetEnumerator', [], 'System.Collections.IEnumerator');
  for (const element of elements) {
    const enumerator = generic + `IEnumerator\`1<${element}>`;
    const enumerable = generic + `IEnumerable<${element}>`;
    const collection = generic + `ICollection\`1<${element}>`;
    const list = generic + `IList\`1<${element}>`;
    declare(enumerator, ['System.Collections.IEnumerator', 'System.IDisposable'], {variance: ['out']});
    property(enumerator, 'Current', element, null);
    declare(enumerable, ['System.Collections.IEnumerable'], {variance: ['out'], element});
    method(enumerable, 'GetEnumerator', [], enumerator);
    declare(collection, [enumerable], {element});
    property(collection, 'Count', 'int', 0);
    property(collection, 'IsReadOnly', 'bool', false);
    for (const [name, parameters, result] of [
      ['Add', [element], 'void'], ['Clear', [], 'void'], ['Contains', [element], 'bool'],
      ['Remove', [element], 'bool'], ['CopyTo', [element + '[]', 'int'], 'void']
    ]) method(collection, name, parameters, result);
    declare(list, [collection], {element});
    for (const [name, parameters, result] of [
      ['get_Item', ['int'], element], ['set_Item', ['int', element], 'void'], ['IndexOf', [element], 'int'],
      ['Insert', ['int', element], 'void'], ['RemoveAt', ['int'], 'void']
    ]) method(list, name, parameters, result);
  }
}

export const listElementTypes = elements;
