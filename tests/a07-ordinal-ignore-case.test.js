import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {fromUnits, ordinalIgnoreCaseAssembly} from './fixtures/comparers/ordinal-ignore-case.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('ordinal-ignore-case-net10.json', directory), 'utf8'));
const comparerType = 'System.StringComparer';
const stringInterface = 'System.Collections.Generic.IComparer`1<string>';
const objectInterface = 'System.Collections.IComparer';
const listType = 'System.Collections.Generic.List`1<string>';
const engines = {source: program => new VirtualMachine(program.image), cil: program => new CilVirtualMachine(program.assembly)};

function contract(owner, name, parameters = []) {
  const descriptor = findContracts(owner, name).find(member => JSON.stringify(member.parameters) === JSON.stringify(parameters));
  assert(descriptor, `${owner}.${name}(${parameters})`);
  return descriptor;
}

function compile(source) {
  const program = compileToIL('using System;using System.Collections.Generic;' + source);
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  return program;
}

function pin(platform, value, type = 'string') {
  const reference = platform.managed(value, type);
  platform.heap.pins.push(reference);
  return reference;
}

for (const [engine, create] of Object.entries(engines)) {
  test(`OrdinalIgnoreCase ${engine}: compiled direct and interface calls include difficult Unicode pairs`, () => {
    const lines = ['var comparer = StringComparer.OrdinalIgnoreCase; IComparer<string> view = comparer;'];
    const expected = [];
    for (let index = 0; index + 1 < reference.values.length; index += 2) {
      const args = [reference.values[index], reference.values[index + 1]].map(value => JSON.stringify(fromUnits(value))).join(',');
      for (const receiver of ['comparer', 'view']) {
        lines.push(`{ int value = ${receiver}.Compare(${args}); Console.WriteLine(value < 0 ? -1 : value > 0 ? 1 : 0); }`);
        expected.push(reference.signs[index][index + 1]);
      }
    }
    const input = reference.input.map(value => JSON.stringify(fromUnits(value))).join(',');
    lines.push(`var values = new List<string>(new string[] {${input}}); values.Sort(comparer);`);
    for (let index = 0; index < reference.sorted.length; index++) {
      lines.push(`Console.WriteLine(values[${index}] == ${JSON.stringify(fromUnits(reference.sorted[index]))});`);
      expected.push('True');
    }
    const vm = create(compile(lines.join('\n')));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, expected.join('\n') + '\n');
    } finally { vm.stop(); }
  });

  test(`OrdinalIgnoreCase ${engine}: every pinned string pair uses existing string/object comparer routes`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const comparer = platform.invoke(contract(comparerType, 'get_OrdinalIgnoreCase'), []);
        const values = reference.values.map(value => pin(platform, fromUnits(value)));
        const routes = [contract(comparerType, 'Compare', ['string', 'string']), contract(stringInterface, 'Compare', ['string', 'string']),
          contract(comparerType, 'Compare', ['object', 'object']), contract(objectInterface, 'Compare', ['object', 'object'])];
        const allocations = platform.heap.stats.allocations;
        for (const descriptor of routes) {
          for (let left = 0; left < values.length; left++) {
            for (let right = 0; right < values.length; right++) {
              assert.equal(Math.sign(platform.invoke(descriptor, [comparer, values[left], values[right]])), reference.signs[left][right],
                `${descriptor.owner} ${left}/${right}`);
            }
          }
        }
        assert.equal(platform.heap.stats.allocations, allocations);
      });
    } finally { vm.stop(); }
  });

  test(`OrdinalIgnoreCase ${engine}: all scalar upper relations retain native prefix and suffix behavior`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    const comparer = platform.invoke(contract(comparerType, 'get_OrdinalIgnoreCase'), []);
    const compare = contract(comparerType, 'Compare', ['string', 'string']);
    try {
      for (const row of reference.upperRelations) {
        platform.heap.withRoots([], () => {
          const input = String.fromCodePoint(row.point);
          const upper = String.fromCodePoint(row.upper);
          const pairs = [[input, upper, row.sign], ['a' + input, 'A' + upper, row.prefixedSign], [input + 'a', upper + 'A', row.suffixedSign]];
          for (const [first, second, expected] of pairs) {
            const args = [comparer, pin(platform, first), pin(platform, second)];
            assert.equal(Math.sign(platform.invoke(compare, args)), expected, 'U+' + row.point.toString(16));
          }
        });
      }
    } finally { vm.stop(); }
  });

  test(`OrdinalIgnoreCase ${engine}: List.Sort and Array.BinarySearch reuse the same comparer`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const comparer = platform.invoke(contract(comparerType, 'get_OrdinalIgnoreCase'), []);
        const values = reference.input.map(value => pin(platform, fromUnits(value)));
        const array = platform.heap.allocate('array', 'string[]', values);
        platform.heap.pins.push(array);
        const list = platform.invoke(contract(listType, '.ctor', ['string[]']), [array]);
        platform.heap.pins.push(list);
        platform.invoke(contract(listType, 'Sort', [stringInterface]), [list, comparer]);
        const sorted = platform.invoke(contract(listType, 'ToArray'), [list]);
        platform.heap.pins.push(sorted);
        assert.deepEqual(platform.heap.get(sorted).data.map(value => platform.native(value)), reference.sorted.map(fromUnits));
        const search = contract('System.Array', 'BinarySearch', ['System.Array', 'object', objectInterface]);
        for (const row of reference.searches) {
          assert.equal(platform.invoke(search, [sorted, pin(platform, fromUnits(row.key)), comparer]), row.index);
        }
      });
    } finally { vm.stop(); }
  });

  test(`OrdinalIgnoreCase ${engine}: singleton identity, GC and snapshots retain the comparison mode`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    const getter = contract(comparerType, 'get_OrdinalIgnoreCase');
    try {
      const first = platform.invoke(getter, []);
      assert.equal(first, platform.invoke(getter, []));
      assert.notDeepEqual(first, platform.invoke(contract(comparerType, 'get_Ordinal'), []));
      const heap = platform.heap.snapshot();
      const state = platform.snapshot();
      platform.heap.collect();
      platform.heap.restore(heap);
      platform.restore(state);
      assert.deepEqual(first, platform.invoke(getter, []));
      platform.heap.withRoots([], () => {
        assert.equal(platform.invoke(contract(comparerType, 'Compare', ['string', 'string']),
          [first, pin(platform, 'a'), pin(platform, 'A')]), 0);
      });
      assert(reference.sameSingleton && reference.distinctOrdinal);
    } finally { vm.stop(); }
  });

  test(`OrdinalIgnoreCase ${engine}: object comparison and wrapped search faults retain existing semantics`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const comparer = platform.invoke(contract(comparerType, 'get_OrdinalIgnoreCase'), []);
        const compare = contract(objectInterface, 'Compare', ['object', 'object']);
        const box = (type, value) => {
          const reference = platform.heap.allocate('box', type, [platform.managed(value, type)]);
          platform.heap.pins.push(reference);
          return reference;
        };
        const opaque = () => {
          const reference = platform.heap.allocate('object', 'object', []);
          platform.heap.pins.push(reference);
          return reference;
        };
        const shared = opaque();
        const text = pin(platform, 'a');
        const number = box('int', 1);
        const pairs = [[null, pin(platform, 'A')], [text, pin(platform, 'A')], [number, box('int', 2)],
          [number, box('double', 1)], [text, number], [shared, shared], [shared, opaque()]];
        for (const [index, pair] of pairs.entries()) {
          const expected = reference.objectRows[index];
          if (expected.error) assert.throws(() => platform.invoke(compare, [comparer, ...pair]), {name: expected.error});
          else assert.equal(Math.sign(platform.invoke(compare, [comparer, ...pair])), expected.sign);
        }
        assert.throws(() => platform.invoke(compare, [null, null, null]), {name: 'NullReferenceException'});
        const array = platform.heap.allocate('array', 'string[]', [text]);
        platform.heap.pins.push(array);
        const search = contract('System.Array', 'BinarySearch', ['System.Array', 'object', objectInterface]);
        assert.throws(() => platform.invoke(search, [array, number, comparer]), error => {
          assert.equal(error.name, reference.searchFault.error);
          platform.heap.withRoots([error.reference], () => {
            platform.heap.collect();
            const inner = platform.heap.get(error.reference).data[1];
            assert.equal(platform.heap.get(inner).methodTable.name, 'System.' + reference.searchFault.inner);
          });
          return true;
        });
      });
    } finally { vm.stop(); }
  });
}

test('OrdinalIgnoreCase ordinary CIL executes true interface dispatch, sorting, searching and casts', () => {
  const expected = [];
  for (let route = 0; route < 4; route++) {
    for (let index = 0; index + 1 < reference.values.length; index += 2) expected.push(reference.signs[index][index + 1]);
  }
  expected.push(...reference.searches.map(row => row.index), 'True');
  const vm = new CilVirtualMachine(ordinalIgnoreCaseAssembly(reference));
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, expected.join('\n') + '\n');
  } finally { vm.stop(); }
});

test('OrdinalIgnoreCase appends one A07 getter and retains every existing comparer ID', () => {
  assert.equal(contract(objectInterface, 'Compare', ['object', 'object']).id, 524294);
  assert.equal(contract(comparerType, 'Compare', ['object', 'object']).id, 524295);
  assert.equal(contract('System.Array', 'BinarySearch', ['System.Array', 'object', objectInterface]).id, 524296);
  assert.equal(contract(comparerType, 'get_OrdinalIgnoreCase').id, 524297);
});

test('OrdinalIgnoreCase native evidence pins source and enumerates the same uppercase mappings as the existing scalar oracle', () => {
  const source = readFileSync(new URL('ordinal-ignore-case/Program.cs', directory));
  const casing = JSON.parse(readFileSync(new URL('unicode-dotnet-10.0.5.json', directory), 'utf8'));
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.scalarCount, 0x110000);
  assert.deepEqual(reference.upperRelations.map(row => [row.point, row.upper]), casing.upper);
});
