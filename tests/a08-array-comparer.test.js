import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {findContracts} from '@sharpforge/framework';
import {arrayComparerAssembly} from './fixtures/comparers/array.js';

const oracleURL = new URL('../packages/bcl-core/reference/array-comparer-net10.json', import.meta.url);
const orderingURL = new URL('../packages/bcl-core/reference/culture-ordering-net10.json', import.meta.url);
const captureURL = new URL('../packages/bcl-core/reference/array-comparer/Program.cs', import.meta.url);
const engines = {source: result => new VirtualMachine(result.image), cil: result => new CilVirtualMachine(result.assembly)};
const comparerType = 'System.Collections.IComparer';
const sourceCases = new Set([
  'both-null', 'null-first', 'null-second', 'ordinal', 'ints', 'doubles', 'bools',
  'different-boxes', 'number-string', 'string-number', 'signed-zero'
]);

function contract(owner, name, parameters = []) {
  const found = findContracts(owner, name).find(candidate =>
    JSON.stringify(candidate.parameters) === JSON.stringify(parameters));
  assert.ok(found, `${owner}.${name}(${parameters})`);
  return found;
}

function compile(source) {
  const result = compileToIL('using System;using System.Collections;' + source);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}

function nativeCase(row) {
  const prefix = JSON.stringify(row.id + ':');
  const value = row.sign ? '(value < 0 ? -1 : value > 0 ? 1 : 0)' : 'value';
  return `try { int value = ${row.expression}; Console.WriteLine(${prefix} + ${value}); }
    catch (Exception error) {
      Console.WriteLine(${prefix} + error.GetType().Name);
    }`;
}

for (const [engine, create] of Object.entries(engines)) {
  test(`array comparer ${engine}: compiled direct StringComparer calls match the supported native subset`, async () => {
    const reference = JSON.parse(await readFile(oracleURL, 'utf8'));
    const cases = reference.cases.filter(row => sourceCases.has(row.id));
    assert.equal(cases.length, sourceCases.size);
    const program = 'var cmp = StringComparer.Ordinal;' + cases.map(nativeCase).join('\n');
    const vm = create(compile(program));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
      const expected = cases.map(row => `${row.id}:${row.error ?? row.value}`).join('\n');
      assert.equal(result.output, expected + '\n');
    } finally { vm.stop(); }
  });

  test(`array comparer ${engine}: all captured ordinal search positions and complements`, async () => {
    const reference = JSON.parse(await readFile(orderingURL, 'utf8'));
    const platform = create(compile('Console.WriteLine(0);')).platform;
    const search = contract('System.Array', 'BinarySearch', ['System.Array', 'object', comparerType]);
    const ordinal = contract('System.StringComparer', 'get_Ordinal');
    platform.heap.withRoots([], () => {
      const comparer = platform.invoke(ordinal, []);
      platform.heap.pins.push(comparer);
      const managed = units => {
        const value = units === null ? null : platform.heap.string(String.fromCharCode(...units));
        platform.heap.pins.push(value);
        return value;
      };
      const values = reference.ordinal.sorted.map(managed);
      const array = platform.heap.allocate('array', 'string[]', values);
      platform.heap.pins.push(array);
      const keys = reference.values.map(managed);
      const missing = reference.ordinal.absent.map(row => managed(row.value));
      const allocations = platform.heap.stats.allocations;
      for (let index = 0; index < keys.length; index++) {
        assert.equal(platform.invoke(search, [array, keys[index], comparer]), reference.ordinal.searches[index]);
      }
      for (let index = 0; index < missing.length; index++) {
        assert.equal(platform.invoke(search, [array, missing[index], comparer]), reference.ordinal.absent[index].index);
      }
      assert.equal(platform.heap.stats.allocations, allocations, 'Search must not allocate managed boxes per comparison');
      assert.deepEqual(platform.heap.get(array).data, values, 'Search must not mutate the array');
    });
  });

  test(`array comparer ${engine}: NaN and wrapped faults retain managed identity and roots`, async () => {
    const reference = JSON.parse(await readFile(oracleURL, 'utf8'));
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    const compare = contract(comparerType, 'Compare', ['object', 'object']);
    const search = contract('System.Array', 'BinarySearch', ['System.Array', 'object', comparerType]);
    const comparer = platform.invoke(contract('System.StringComparer', 'get_Ordinal'), []);
    platform.heap.withRoots([comparer], () => {
      const box = (type, value) => {
        const result = platform.heap.allocate('box', type, [platform.managed(value, type)]);
        platform.heap.pins.push(result);
        return result;
      };
      const nan = box('double', NaN);
      for (const [id, right] of [['nan-equal', box('double', NaN)], ['nan-first', box('double', 0)]]) {
        const expected = reference.cases.find(row => row.id === id);
        assert.equal(Math.sign(platform.invoke(compare, [comparer, nan, right])), expected.value);
      }
      const allocate = (kind, type, data) => {
        const result = platform.heap.allocate(kind, type, data);
        platform.heap.pins.push(result);
        return result;
      };
      const text = platform.heap.string('a');
      platform.heap.pins.push(text);
      const cases = [
        ['mixed-search', allocate('array', 'int[]', [1, 2, 3]), box('double', 2)],
        ['string-search-number', allocate('array', 'string[]', [text]), box('int', 2)],
        ['opaque-search', allocate('array', 'object[]', [allocate('object', 'object', [])]), allocate('object', 'object', [])]
      ];
      for (const [id, array, value] of cases) {
        const expected = reference.cases.find(row => row.id === id);
        let fault;
        try { platform.invoke(search, [array, value, comparer]); } catch (error) { fault = error; }
        assert.equal(fault?.name, expected.error, id);
        assert.ok(fault.reference, 'Wrapped managed fault owns an exception reference');
        platform.heap.withRoots([fault.reference], () => {
          platform.heap.collect();
          const inner = platform.heap.get(fault.reference).data[1];
          assert.equal(platform.heap.get(inner).methodTable.name, 'System.' + expected.inner, id);
          if (engine === 'cil') {
            const getter = {kind: 'method', owner: 'System.Exception', name: 'get_InnerException',
              signature: {isStatic: false, parameters: [], returnType: 'System.Exception'}};
            assert.equal(vm.intrinsic(getter, [fault.reference]), inner, id);
          }
        });
      }
    });
  });

  test(`array comparer ${engine}: rank and null array validation precede comparison`, async () => {
    const reference = JSON.parse(await readFile(oracleURL, 'utf8'));
    const platform = create(compile('Console.WriteLine(0);')).platform;
    const search = contract('System.Array', 'BinarySearch', ['System.Array', 'object', comparerType]);
    const rank = reference.cases.find(row => row.id === 'rank-two');
    platform.heap.withRoots([], () => {
      const array = platform.heap.allocate('array', 'int[,]', [1]);
      platform.heap.pins.push(array);
      assert.throws(() => platform.invoke(search, [array, null, null]), {name: rank.error});
      assert.throws(() => platform.invoke(search, [null, null, null]), {name: 'ArgumentNullException'});
      const unbounded = platform.heap.allocate('array', 'int[*]', [1]);
      platform.heap.pins.push(unbounded);
      assert.throws(() => platform.invoke(search, [unbounded, null, null]), {name: 'NotSupportedException'});
    });
  });

  test(`array comparer ${engine}: unsupported callbacks are explicit and empty search needs none`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const custom = platform.make('Tests.CustomComparer');
        platform.heap.pins.push(custom);
        const empty = platform.heap.allocate('array', 'string[]', []);
        platform.heap.pins.push(empty);
        const search = contract('System.Array', 'BinarySearch', ['System.Array', 'object', comparerType]);
        assert.equal(platform.invoke(search, [empty, null, custom]), -1);
        const populated = platform.heap.allocate('array', 'string[]', [null]);
        platform.heap.pins.push(populated);
        assert.throws(() => platform.invoke(search, [populated, null, custom]), {name: 'NotSupportedException'});
      });
    } finally { vm.stop(); }
  });
}

test('array comparer CIL: every captured vector operation executes through its real interface signature', async () => {
  const reference = JSON.parse(await readFile(oracleURL, 'utf8'));
  for (const row of reference.cases.filter(candidate => !candidate.nativeOnly)) {
    const vm = new CilVirtualMachine(arrayComparerAssembly(row.id));
    try {
      const result = vm.run();
      if (row.error) {
        assert.equal(result.state, 'faulted', row.id);
        assert.equal(result.fault?.name, row.error, row.id);
      } else {
        assert.equal(result.state, 'terminated', row.id + ': ' + result.fault?.stack);
        assert.equal(row.sign ? Math.sign(result.returnValue) : result.returnValue, row.value, row.id);
      }
    } finally { vm.stop(); }
  }
});

test('array comparer CIL: typed catch and InnerException getter preserve all captured wrapped failures', async () => {
  const reference = JSON.parse(await readFile(oracleURL, 'utf8'));
  for (const row of reference.cases.filter(candidate => candidate.inner)) {
    const vm = new CilVirtualMachine(arrayComparerAssembly(row.id, {innerException: true}));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', row.id + ': ' + result.fault?.stack);
      assert.ok(result.returnValue, row.id);
      vm.heap.collect([result.returnValue]);
      assert.equal(vm.heap.get(result.returnValue).methodTable.name, 'System.' + row.inner, row.id);
    } finally { vm.stop(); }
  }
});

test('array comparer source: custom interface implementations remain explicitly unsupported', () => {
  const result = compileToIL(`using System;using System.Collections; Console.WriteLine(0);
    class Custom : IComparer { public int Compare(object first, object second) { return 0; } }`);
  assert.equal(result.success, false);
  const codes = new Set(result.diagnostics.map(diagnostic => diagnostic.code));
  assert(codes.has('SF1014'), JSON.stringify(result.diagnostics));
  assert(codes.has('SF2200'), JSON.stringify(result.diagnostics));
});

test('array comparer: reference pins capture source and exact released non-generic signature', async () => {
  const reference = JSON.parse(await readFile(oracleURL, 'utf8'));
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.runtime, '10.0.5');
  const source = await readFile(captureURL);
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
  const descriptor = contract('System.Array', 'BinarySearch', ['System.Array', 'object', comparerType]);
  assert.equal(contract(comparerType, 'Compare', ['object', 'object']).id, 524294);
  assert.equal(contract('System.StringComparer', 'Compare', ['object', 'object']).id, 524295);
  assert.equal(descriptor.id, 524296);
  assert.equal(descriptor.result, 'int');
  assert.equal(descriptor.isStatic, true);
  assert.equal(contract('System.StringComparer', 'get_Ordinal').id, 524292);
  assert.equal(contract('System.Collections.Generic.List`1<string>', 'Sort',
    ['System.Collections.Generic.IComparer`1<string>']).id, 589824);
});
