import {compareObjects} from './object-comparison.js';
import {compareOrdinalIgnoreCase} from './string-compare.js';
import {validateStringComparisonMode} from './string-comparison-mode.js';
import {bclScalar, fail, string} from '../host.js';

const comparerType = 'System.StringComparer';
const stringInterface = 'System.Collections.Generic.IComparer`1<string>';
const comparisons = Object.freeze({ordinal: compareOrdinal, ordinalIgnoreCase: compareOrdinalIgnoreCase});
const getters = Object.freeze({get_Ordinal: 'ordinal', get_OrdinalIgnoreCase: 'ordinalIgnoreCase'});

/** Compare nullable native strings by UTF-16 code units; only the sign is specified. */
export function compareOrdinal(first, second) {
  if (first === second) return 0;
  if (first === null) return -1;
  if (second === null) return 1;
  return first < second ? -1 : 1;
}

/** Resolve a managed built-in comparer once per operation, rejecting unsupported implementations. */
export function resolveStringComparer(platform, reference) {
  if (reference === null) fail(platform, 'NullReferenceException', 'A comparer instance is required');
  const record = platform.heap.get(reference);
  const mode = record.type === comparerType ? platform.get(reference, '$comparison') : null;
  if (Object.hasOwn(comparisons, mode)) return comparisons[mode];
  fail(platform, 'NotSupportedException', 'This profile supports ordinal StringComparers; custom comparers are tracked by #2655');
}

/** Register the new getter only at the current A07 tail; released comparer IDs must not move. */
export function registerStringComparerExtensions(registry) {
  registry.prop(comparerType, 'OrdinalIgnoreCase', comparerType, null, true, true);
}

/** Append the factory after existing A07 members without changing getter or comparison IDs. */
export function registerStringComparerFactoryExtensions(registry) {
  registry.member(comparerType, 'FromComparison', ['System.StringComparison'], comparerType, {isStatic: true});
}

/** Append only the nullable two-string equality signature after existing A07 members. */
export function registerStringComparerEqualityExtensions(registry) {
  registry.member(comparerType, 'Equals', ['string', 'string'], 'bool', {isAbstract: true});
}

function comparerSingleton(platform, getter) {
  const key = comparerType + '.' + getter.slice(4);
  return platform.singleton(key, () => platform.make(comparerType, {'$comparison': getters[getter]}));
}

function fromComparison(platform, value) {
  const mode = bclScalar(platform, value);
  validateStringComparisonMode(platform, mode);
  if (mode < 4) {
    fail(platform, 'NotSupportedException',
      'StringComparer.FromComparison supports only StringComparison.Ordinal and OrdinalIgnoreCase; culture modes are not implemented');
  }
  return comparerSingleton(platform, mode === 4 ? 'get_Ordinal' : 'get_OrdinalIgnoreCase');
}

/** Invoke Compare through either StringComparer or its IComparer<string> contract. */
function invokeStringCompare(platform, args) {
  const compare = resolveStringComparer(platform, args[0]);
  return {handled: true, value: compare(string(platform, args[1], true), string(platform, args[2], true))};
}

function invokeStringEquals(platform, args) {
  const compare = resolveStringComparer(platform, args[0]);
  const first = string(platform, args[1], true);
  const second = string(platform, args[2], true);
  const value = first === second || first !== null && second !== null && first.length === second.length && compare(first, second) === 0;
  return {handled: true, value};
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
    kind: 'bcl', family: 'stringComparer', isAbstract: true, interfaces: [stringInterface, 'System.Collections.IComparer']
  });
  registry.prop(comparerType, 'Ordinal', comparerType, null, true, true);
  registry.member(comparerType, 'Compare', ['string', 'string'], 'int', {isAbstract: true});
}

function invokeStringComparer(platform, descriptor, args) {
  if (Object.hasOwn(getters, descriptor.name)) {
    return {handled: true, value: comparerSingleton(platform, descriptor.name)};
  }
  if (descriptor.name === 'FromComparison') {
    return {handled: true, value: fromComparison(platform, args[0])};
  }
  if (descriptor.name === 'Compare') {
    if (descriptor.parameters[0] === 'object') {
      const compare = resolveStringComparer(platform, args[0]);
      return {handled: true, value: compareObjects(platform, args[1], args[2], compare)};
    }
    return invokeStringCompare(platform, args);
  }
  if (descriptor.name === 'Equals') return invokeStringEquals(platform, args);
  fail(platform, 'MissingMethodException', descriptor.owner + '.' + descriptor.name);
}

export const stringComparerModule = Object.freeze({
  name: 'stringComparer', families: ['stringComparer', 'orderingComparer'], contracts: registerStringComparer, invoke: invokeStringComparer
});
