import {fail, string} from '../host.js';

const comparerType = 'System.StringComparer';
const stringInterface = 'System.Collections.Generic.IComparer`1<string>';

/** Compare nullable native strings by UTF-16 code units; only the sign is specified. */
function compareOrdinal(first, second) {
  if (first === second) return 0;
  if (first === null) return -1;
  if (second === null) return 1;
  return first < second ? -1 : 1;
}

/** Resolve a managed built-in comparer once per operation, rejecting unsupported implementations. */
export function resolveStringComparer(platform, reference) {
  if (reference === null) fail(platform, 'NullReferenceException', 'A comparer instance is required');
  const record = platform.heap.get(reference);
  if (record.type === comparerType && platform.get(reference, '$comparison') === 'ordinal') return compareOrdinal;
  fail(platform, 'NotSupportedException', 'This profile supports StringComparer.Ordinal; custom comparers are tracked by #2655');
}

/** Invoke Compare through either StringComparer or its IComparer<string> contract. */
function invokeStringCompare(platform, args) {
  const compare = resolveStringComparer(platform, args[0]);
  return {handled: true, value: compare(string(platform, args[1], true), string(platform, args[2], true))};
}

function registerStringComparer(registry) {
  // Two closed signatures seed the bridge's existing open generic projection.
  for (const element of ['string', 'object']) {
    const name = `System.Collections.Generic.IComparer\`1<${element}>`;
    registry.define(name, {
      kind: 'bcl', typeKind: 'interface', family: 'orderingComparer', base: null, variance: ['in']
    });
    registry.member(name, 'Compare', [element, element], 'int', {isAbstract: true});
  }
  registry.define(comparerType, {
    kind: 'bcl', family: 'stringComparer', isAbstract: true, interfaces: [stringInterface]
  });
  registry.prop(comparerType, 'Ordinal', comparerType, null, true, true);
  registry.member(comparerType, 'Compare', ['string', 'string'], 'int', {isAbstract: true});
}

function invokeStringComparer(platform, descriptor, args) {
  if (descriptor.name === 'get_Ordinal') {
    const value = platform.singleton(comparerType + '.Ordinal', () => platform.make(comparerType, {'$comparison': 'ordinal'}));
    return {handled: true, value};
  }
  if (descriptor.name === 'Compare') return invokeStringCompare(platform, args);
  fail(platform, 'MissingMethodException', descriptor.owner + '.' + descriptor.name);
}

export const stringComparerModule = Object.freeze({
  name: 'stringComparer', families: ['stringComparer', 'orderingComparer'], contracts: registerStringComparer, invoke: invokeStringComparer
});
