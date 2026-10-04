import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileToIL} from '@sharpforge/compiler';
import {RegistryBridge} from '../packages/compiler/src/symbols/registry-bridge.js';
import {TypeKind} from '../packages/compiler/src/symbols/types.js';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {findContracts, frameworkAssignable, frameworkType, contracts} from '@sharpforge/framework';
import {ordinalInterfaceAssembly} from './fixtures/comparers/ordinal.js';

const interfaceName = 'System.Collections.Generic.IComparer`1<string>';
const comparerName = 'System.StringComparer';
const listName = 'System.Collections.Generic.List`1<string>';
const engines = {source: result => new VirtualMachine(result.image), cil: result => new CilVirtualMachine(result.assembly)};
const referenceURL = new URL('../packages/bcl-core/reference/culture-ordering-net10.json', import.meta.url);

function contract(owner, name, parameters = []) {
  const result = findContracts(owner, name).find(candidate =>
    JSON.stringify(candidate.parameters) === JSON.stringify(parameters));
  assert.ok(result, `${owner}.${name}(${parameters})`);
  return result;
}

function compile(source) {
  const result = compileToIL('using System;using System.Collections.Generic;' + source);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}

function units(value) {
  return value === null ? null : Array.from({length: value.length}, (_, index) => value.charCodeAt(index));
}

for (const [engine, create] of Object.entries(engines)) {
  test(`ordinal ${engine}: compiled StringComparer calls retain null ordering and singleton identity`, () => {
    const vm = create(compile(`
      var comparer = StringComparer.Ordinal;
      Console.WriteLine(comparer.Compare("a", "A") > 0);
      Console.WriteLine(Object.ReferenceEquals(StringComparer.Ordinal, StringComparer.Ordinal));
      Console.WriteLine(comparer.Compare(null, "") < 0);
    `));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
      assert.equal(result.output, 'True\nTrue\nTrue\n');
    } finally { vm.stop(); }
  });

  test(`ordinal ${engine}: direct comparer and sort agree with all pinned native pairs`, async () => {
    const reference = JSON.parse(await readFile(referenceURL, 'utf8'));
    assert.equal(reference.runtime, '10.0.5');
    assert.deepEqual(reference.defaultSort, [[97], [65], [98]]);
    assert.deepEqual(reference.ordinalSort, [[65], [97], [98]]);
    const platform = create(compile('Console.WriteLine(0);')).platform;
    const getOrdinal = contract(comparerName, 'get_Ordinal');
    const compare = contract(comparerName, 'Compare', ['string', 'string']);
    const sort = contract(listName, 'Sort', [interfaceName]);
    platform.heap.withRoots([], () => {
      const comparer = platform.invoke(getOrdinal, []);
      platform.heap.pins.push(comparer);
      const values = reference.values.map(value => {
        const managed = value === null ? null : platform.heap.string(String.fromCharCode(...value));
        platform.heap.pins.push(managed);
        return managed;
      });
      for (let first = 0; first < values.length; first++) {
        for (let second = 0; second < values.length; second++) {
          const actual = platform.invoke(compare, [comparer, values[first], values[second]]);
          assert.equal(Math.sign(platform.native(actual)), reference.ordinal.signs[first][second], `${first}/${second}`);
        }
      }
      const array = platform.heap.allocate('array', 'string[]', values);
      platform.heap.pins.push(array);
      const list = platform.invoke(contract(listName, '.ctor', ['string[]']), [array]);
      platform.heap.pins.push(list);
      platform.invoke(sort, [list, comparer]);
      const sorted = platform.invoke(contract(listName, 'ToArray'), [list]);
      assert.deepEqual(platform.heap.get(sorted).data.map(value => units(platform.native(value))), reference.ordinal.sorted);
    });
  });

  test(`ordinal ${engine}: singleton survives collection and platform snapshot restoration`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    const getter = contract(comparerName, 'get_Ordinal');
    const first = platform.invoke(getter, []);
    const savedHeap = platform.heap.snapshot();
    const savedPlatform = platform.snapshot();
    platform.heap.collect();
    assert.deepEqual(platform.invoke(getter, []), first);
    platform.heap.restore(savedHeap);
    platform.restore(savedPlatform);
    assert.deepEqual(platform.invoke(getter, []), first);
    const other = create(compile('Console.WriteLine(0);')).platform;
    other.invoke(getter, []);
    assert.notEqual(platform.singletons, other.singletons);
  });

  test(`ordinal ${engine}: unimplemented custom comparer fails explicitly even for an empty list`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const custom = platform.make('Tests.CustomComparer');
        platform.heap.pins.push(custom);
        for (const populated of [false, true]) {
          const list = platform.invoke(contract(listName, '.ctor'), []);
          platform.heap.pins.push(list);
          if (populated) platform.invoke(contract(listName, 'Add', ['string']), [list, platform.heap.string('value')]);
          const revision = platform.get(list, '$version');
          assert.throws(() => platform.invoke(contract(listName, 'Sort', [interfaceName]), [list, custom]),
            {name: 'NotSupportedException'});
          assert.equal(platform.get(list, '$version'), revision);
        }
      });
    } finally { vm.stop(); }
  });
}

test('ordinal CIL: interface Compare, List.Sort, castclass and isinst use the registered runtime contract', () => {
  const vm = new CilVirtualMachine(ordinalInterfaceAssembly());
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, '<null>\n\nA\nA\na\nb\nTrue\nTrue\nTrue\nTrue\n');
  } finally { vm.stop(); }
});

test('ordinal source: interface type tests and custom implementations retain explicit profile diagnostics', () => {
  const cases = [
    ['object comparer = StringComparer.Ordinal; Console.WriteLine(comparer is IComparer<string>);', ['SF2098']],
    ['Console.WriteLine(0); class Custom : IComparer<string> { public int Compare(string a, string b) { return 0; } }', ['SF1014', 'SF2200']]
  ];
  for (const [source, expected] of cases) {
    const result = compileToIL('using System;using System.Collections.Generic;' + source);
    assert.equal(result.success, false);
    const codes = new Set(result.diagnostics.map(diagnostic => diagnostic.code));
    for (const code of expected) assert(codes.has(code), JSON.stringify(result.diagnostics));
  }
});

test('ordinal: interface metadata and reserved contracts retain the released ABI', () => {
  const bridge = new RegistryBridge();
  const comparer = bridge.typeFromName(comparerName);
  const interfaceType = bridge.typeFromName(interfaceName);
  assert.equal(interfaceType.typeKind, TypeKind.Interface);
  assert.equal(interfaceType.originalDefinition.typeParameters[0].variance, 'in');
  assert.ok(comparer.allInterfaces.some(type => type.equals(interfaceType)));
  assert.equal(frameworkType(interfaceName).typeKind, 'interface');
  assert.equal(frameworkAssignable(interfaceName, comparerName), true);
  assert.equal(frameworkAssignable(comparerName, interfaceName), false);
  assert.equal(contract('System.Text.StringBuilder', 'AppendFormat', ['string', 'object[]']).id, 524288);
  assert.equal(contract('System.Environment', 'GetEnvironmentVariable', ['string']).id, 524289);
  assert.equal(contract(interfaceName, 'Compare', ['string', 'string']).id, 524290);
  assert.equal(contract('System.Collections.Generic.IComparer`1<object>', 'Compare', ['object', 'object']).id, 524291);
  assert.equal(contract(comparerName, 'get_Ordinal').id, 524292);
  assert.equal(contract(comparerName, 'Compare', ['string', 'string']).id, 524293);
  assert.equal(contract(listName, 'Sort', [interfaceName]).id, 589824);
  assert.equal(contracts.filter(member => member.id < 65536).length, 1744);
});
