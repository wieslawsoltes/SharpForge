import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {findContracts} from '@sharpforge/framework';

const oracleURL = new URL('../packages/bcl-core/reference/array-comparer-net10.json', import.meta.url);
const orderingURL = new URL('../packages/bcl-core/reference/culture-ordering-net10.json', import.meta.url);
const captureURL = new URL('../packages/bcl-core/reference/array-comparer/Program.cs', import.meta.url);
const engines = {source: result => new VirtualMachine(result.image), cil: result => new CilVirtualMachine(result.assembly)};
const comparerType = 'System.Collections.IComparer';
const platformOnly = new Set(['nan-equal', 'nan-first']);

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
      Console.WriteLine(${prefix} + error.GetType().Name + "/" +
        (error.InnerException == null ? "none" : error.InnerException.GetType().Name));
    }`;
}

for (const [engine, create] of Object.entries(engines)) {
  test(`array comparer ${engine}: non-generic calls and inner exceptions match native capture`, async () => {
    const reference = JSON.parse(await readFile(oracleURL, 'utf8'));
    const cases = reference.cases.filter(row => !row.nativeOnly && !platformOnly.has(row.id));
    const program = 'IComparer cmp = StringComparer.Ordinal;object shared = new object();' + cases.map(nativeCase).join('\n');
    const result = create(compile(program)).run();
    assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
    const expected = cases.map(row => `${row.id}:${row.error ? row.error + '/' + (row.inner ?? 'none') : row.value}`).join('\n');
    assert.equal(result.output, expected + '\n');
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
    const platform = create(compile('Console.WriteLine(0);')).platform;
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
      for (const [id, right] of [['nan-equal', nan], ['nan-first', box('double', 0)]]) {
        const expected = reference.cases.find(row => row.id === id);
        assert.equal(Math.sign(platform.invoke(compare, [comparer, nan, right])), expected.value);
      }
      const array = platform.heap.allocate('array', 'int[]', [1, 2, 3]);
      platform.heap.pins.push(array);
      const value = box('double', 2);
      let fault;
      try { platform.invoke(search, [array, value, comparer]); } catch (error) { fault = error; }
      assert.equal(fault?.name, 'InvalidOperationException');
      assert.ok(fault.reference, 'Wrapped managed fault owns an exception reference');
      platform.heap.withRoots([fault.reference], () => {
        platform.heap.collect();
        const inner = platform.heap.get(fault.reference).data[1];
        assert.equal(platform.heap.get(inner).methodTable.name, 'System.ArgumentException');
      });
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
    const result = create(compile(`
      IComparer comparer = new Reverse();
      Console.WriteLine(Array.BinarySearch((Array)new string[] {}, "a", comparer));
      try { Array.BinarySearch((Array)new string[] {"a"}, "a", comparer); }
      catch (Exception error) { Console.WriteLine(error.GetType().Name); }
      class Reverse : IComparer { public int Compare(object first, object second) { return 0; } }
    `)).run();
    assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
    assert.equal(result.output, '-1\nNotSupportedException\n');
  });
}

test('array comparer: reference pins capture source and exact released non-generic signature', async () => {
  const reference = JSON.parse(await readFile(oracleURL, 'utf8'));
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.runtime, '10.0.5');
  const source = await readFile(captureURL);
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
  const descriptor = contract('System.Array', 'BinarySearch', ['System.Array', 'object', comparerType]);
  assert.equal(descriptor.result, 'int');
  assert.equal(descriptor.isStatic, true);
  assert.equal(contract('System.StringComparer', 'get_Ordinal').id, 524291);
  assert.equal(contract('System.Collections.Generic.List`1<string>', 'Sort',
    ['System.Collections.Generic.IComparer`1<string>']).id, 589824);
});
