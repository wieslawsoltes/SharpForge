import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {findContracts} from '@sharpforge/framework';
import {defaultOrderingAssembly} from './fixtures/comparers/default-ordering.js';

const referenceURL = new URL('../packages/bcl-core/reference/culture-ordering-net10.json', import.meta.url);
const listType = 'System.Collections.Generic.List`1<string>';
const engines = {source: result => new VirtualMachine(result.image), cil: result => new CilVirtualMachine(result.assembly)};
const decode = units => units === null ? null : String.fromCharCode(...units);

function compile(source) {
  const result = compileToIL('using System;using System.Collections.Generic;' + source);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}

function contract(owner, name, parameters = []) {
  const descriptor = findContracts(owner, name).find(row => JSON.stringify(row.parameters) === JSON.stringify(parameters));
  assert.ok(descriptor, `${owner}.${name}(${parameters})`);
  return descriptor;
}

for (const [engine, create] of Object.entries(engines)) {
  test(`default ordering ${engine}: source program uses linguistic List.Sort and comparator-zero search`, () => {
    const vm = create(compile(`
      var list = new List<string>(new string[] {"b", "A", "a"});
      list.Sort();
      Console.WriteLine(string.Join("|", list.ToArray()));
      string[] array = new string[] {"b", "A", "a"};
      Array.Sort(array);
      Console.WriteLine(string.Join("|", array));
      Console.WriteLine(Array.BinarySearch(new string[] {"a", "A", "b"}, "A"));
      Console.WriteLine(Array.BinarySearch(new string[] {"ab"}, "a\\0b"));
      Console.WriteLine(Array.BinarySearch(new string[] {"ab"}, "a\\u00ADb"));
      int[] numbers = new int[] {3, -1, 2};
      Array.Sort(numbers);
      Console.WriteLine(numbers[0] + "," + numbers[1] + "," + numbers[2]);
    `));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
      assert.equal(result.output, 'a|A|b\na|A|b\n1\n0\n0\n-1,2,3\n');
    } finally {vm.stop();}
  });

  test(`default ordering ${engine}: native corpus sorts preserve all values and culture equivalence`, async () => {
    const reference = JSON.parse(await readFile(referenceURL, 'utf8'));
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    const values = reference.values.map(decode);
    const indices = new Map(values.map((value, index) => [value, index]));
    const sort = contract(listType, 'Sort');
    const sortNull = contract(listType, 'Sort', ['System.Collections.Generic.IComparer`1<string>']);
    try {
      platform.heap.withRoots([], () => {
        const managed = values.map(value => {
          const result = value === null ? null : platform.heap.string(value);
          platform.heap.pins.push(result);
          return result;
        });
        const array = platform.heap.allocate('array', 'string[]', managed);
        platform.heap.pins.push(array);
        for (const descriptor of [sort, sortNull]) {
          const list = platform.invoke(contract(listType, '.ctor', ['string[]']), [array]);
          platform.heap.pins.push(list);
          platform.invoke(descriptor, descriptor === sort ? [list] : [list, null]);
          const output = platform.invoke(contract(listType, 'ToArray'), [list]);
          platform.heap.pins.push(output);
          const sorted = platform.heap.get(output).data.map(value => platform.native(value));
          // .NET's unstable Sort may reorder distinct strings whose culture comparison is zero.
          assert.deepEqual(sorted.map(value => values.indexOf(value)).sort((a, b) => a - b),
            values.map(value => values.indexOf(value)).sort((a, b) => a - b));
          for (let index = 1; index < sorted.length; index++) {
            assert.ok(reference.invariant.signs[indices.get(sorted[index - 1])][indices.get(sorted[index])] <= 0,
              `Out-of-order native corpus slots ${index - 1}/${index}`);
          }
        }
      });
    } finally {vm.stop();}
  });

  test(`default ordering ${engine}: typed and null-comparer searches use native comparator equivalence`, async () => {
    const reference = JSON.parse(await readFile(referenceURL, 'utf8'));
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    const indices = new Map(reference.values.map((value, index) => [decode(value), index]));
    const searches = [contract('System.Array', 'BinarySearch', ['string[]', 'string']),
      contract('System.Array', 'BinarySearch', ['System.Array', 'object', 'System.Collections.IComparer'])];
    try {
      platform.heap.withRoots([], () => {
        const managed = units => {
          const value = units === null ? null : platform.heap.string(decode(units));
          platform.heap.pins.push(value);
          return value;
        };
        const sorted = reference.invariant.sorted.map(managed);
        const array = platform.heap.allocate('array', 'string[]', sorted);
        platform.heap.pins.push(array);
        const keys = reference.values.map(managed);
        const absent = reference.invariant.absent.map(row => managed(row.value));
        const allocations = platform.heap.stats.allocations;
        for (const search of searches) {
          const invoke = key => platform.invoke(search, search.parameters.length === 2 ? [array, key] : [array, key, null]);
          keys.forEach((key, index) => {
            const position = invoke(key);
            assert.ok(position >= 0 && position < sorted.length, `Missing corpus key ${index}`);
            const actualIndex = indices.get(platform.native(sorted[position]));
            assert.equal(reference.invariant.signs[actualIndex][index], 0, `Unequal result for corpus key ${index}`);
          });
          absent.forEach((key, index) => assert.equal(invoke(key), reference.invariant.absent[index].index));
        }
        assert.equal(platform.heap.stats.allocations, allocations);
      });
    } finally {vm.stop();}
  });

  test(`default ordering ${engine}: search exposes the documented host normalization limitation`, async () => {
    const boundaryURL = new URL('../packages/bcl-core/reference/culture-ordering-boundaries-net10.json', import.meta.url);
    const reference = JSON.parse(await readFile(boundaryURL, 'utf8'));
    const row = reference.pairs.find(pair => pair.id === 'reordered-acute-cedilla');
    assert.equal(row.sign, -1, 'The unchanged native capture distinguishes this pair');
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const first = platform.heap.string(decode(row.left));
        platform.heap.pins.push(first);
        const second = platform.heap.string(decode(row.right));
        platform.heap.pins.push(second);
        const array = platform.heap.allocate('array', 'string[]', [first]);
        platform.heap.pins.push(array);
        const typed = contract('System.Array', 'BinarySearch', ['string[]', 'string']);
        const withComparer = contract('System.Array', 'BinarySearch', ['System.Array', 'object', 'System.Collections.IComparer']);
        assert.equal(platform.invoke(typed, [array, second]), 0, 'Host normalization merges the native distinction');
        assert.equal(platform.invoke(withComparer, [array, second, null]), 0);
      });
    } finally {vm.stop();}
  });
}

test('default ordering: independent CIL calls preserve explicit Ordinal behavior', () => {
  const vm = new CilVirtualMachine(defaultOrderingAssembly());
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
    assert.equal(result.output, 'a\nA\nb\na\nA\nb\n0\n0\n-1\n');
  } finally {vm.stop();}
});
