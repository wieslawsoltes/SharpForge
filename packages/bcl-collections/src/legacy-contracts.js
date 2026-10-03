const scalar = Object.freeze(['int', 'double', 'bool', 'string', 'object']);

function registerSequence(registry, family, element, enumerator) {
  const {define, member, ctor, prop} = registry;
  const name = `System.Collections.Generic.${family}\`1<${element}>`;
  define(name, {kind: 'bcl', family, element});
  for (const parameters of [[], ['int'], [element + '[]']]) ctor(name, parameters);
  prop(name, 'Count', 'int', 0, true);
  if (family === 'List') prop(name, 'Capacity', 'int', 0);
  const common = [
    ['Clear', [], 'void'], ['Contains', [element], 'bool'],
    ['ToArray', [], element + '[]'], ['GetEnumerator', [], enumerator]
  ];
  for (const [method, parameters, result] of common) member(name, method, parameters, result);
  const members = {
    List: [
      ['Add', [element], 'void'], ['AddRange', [element + '[]'], 'void'],
      ['Insert', ['int', element], 'void'], ['Remove', [element], 'bool'],
      ['RemoveAt', ['int'], 'void'], ['RemoveRange', ['int', 'int'], 'void'],
      ['IndexOf', [element], 'int'], ['get_Item', ['int'], element],
      ['set_Item', ['int', element], 'void'], ['Reverse', [], 'void'], ['Sort', [], 'void']
    ],
    HashSet: [
      ['Add', [element], 'bool'], ['Remove', [element], 'bool'],
      ['UnionWith', [element + '[]'], 'void'], ['IntersectWith', [element + '[]'], 'void'],
      ['ExceptWith', [element + '[]'], 'void']
    ],
    Queue: [['Enqueue', [element], 'void'], ['Dequeue', [], element], ['Peek', [], element]],
    Stack: [['Push', [element], 'void'], ['Pop', [], element], ['Peek', [], element]]
  };
  for (const [method, parameters, result] of members[family]) member(name, method, parameters, result);
}

function registerDictionary(registry, key, element) {
  const {define, member, ctor, prop} = registry;
  const name = `System.Collections.Generic.Dictionary\`2<${key}, ${element}>`;
  define(name, {kind: 'bcl', family: 'Dictionary', key, element});
  ctor(name);
  ctor(name, ['int']);
  prop(name, 'Count', 'int', 0, true);
  prop(name, 'Keys', key + '[]', null, true);
  prop(name, 'Values', element + '[]', null, true);
  const members = [
    ['Add', [key, element], 'void'], ['TryAdd', [key, element], 'bool'],
    ['ContainsKey', [key], 'bool'], ['ContainsValue', [element], 'bool'],
    ['Remove', [key], 'bool'], ['Clear', [], 'void'],
    ['get_Item', [key], element], ['set_Item', [key, element], 'void']
  ];
  for (const [method, parameters, result] of members) member(name, method, parameters, result);
}

/** Preserve released scalar, family and member order so existing ABI identities retain their meaning. */
export function registerClosedCollections(registry) {
  const {define, member, prop} = registry;
  for (const element of scalar) {
    const enumerator = `SharpForge.Runtime.Enumerator\`1<${element}>`;
    define(enumerator, {kind: 'bcl', family: 'enumerator', element});
    member(enumerator, 'MoveNext', [], 'bool');
    prop(enumerator, 'Current', element, null, true);
    member(enumerator, 'Dispose', [], 'void');
    for (const family of ['List', 'HashSet', 'Queue', 'Stack']) {
      registerSequence(registry, family, element, enumerator);
    }
    for (const key of ['string', 'int']) registerDictionary(registry, key, element);
  }
}
