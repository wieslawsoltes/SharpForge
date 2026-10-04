import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine, ManagedFault} from '@sharpforge/runtime';
import {hashSetValues} from '@sharpforge/bcl-collections';
import {createClosedCollection} from './helpers/closed-collection.js';
import {supportedHashSetSource, hashSetNaNAssembly, invalidHashSetCapacityAssembly} from './helpers/hashset-fixture.js';

const fixture = new URL('../packages/bcl-collections/reference/', import.meta.url);
const source = readFileSync(new URL('hashset-removal/Program.cs', fixture), 'utf8');
const expected = readFileSync(new URL('hashset-removal-net10.txt', fixture), 'utf8').replaceAll('\r\n', '\n');
const nativeNaNLines = expected.trimEnd().split('\n').slice(21, 26);
let compiled;
let emptyCompiled;

for (const engine of ['source', 'cil']) {
  test(`SF-A08-B03 ${engine}: explicitly adapted HashSet source matches all native slot-order output`, () => {
    compiled ??= compileToIL(supportedHashSetSource(source));
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, expected);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: empty HashSet array construction, reuse and invalid capacity remain bounded`, () => {
    emptyCompiled ??= compileToIL(`using System; using System.Collections.Generic;
      var values = new HashSet<int>(new int[] {});
      Console.WriteLine(values.Count); Console.WriteLine(values.ToArray().Length);
      values.UnionWith(new int[] {});
      Console.WriteLine(values.Add(0)); Console.WriteLine(values.Add(0));
      values.Clear(); values.Clear(); Console.WriteLine(values.Count);`);
    assert.equal(emptyCompiled.success, true, JSON.stringify(emptyCompiled.diagnostics));
    const vm = engine === 'source' ? new VirtualMachine(emptyCompiled.image) : new CilVirtualMachine(emptyCompiled.assembly);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, '0\n0\nTrue\nFalse\n0\n');
      const constructor = findContracts('System.Collections.Generic.HashSet`1<int>', '.ctor')
        .find(member => member.parameters.length === 1 && member.parameters[0] === 'int');
      assert.throws(() => vm.platform.invoke(constructor, [-1]), {name: 'ArgumentOutOfRangeException'});
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: actual NaN values and signed zero match native equality and free-slot reuse`, () => {
    const {vm, platform, call} = createClosedCollection(engine, 'HashSet', 'double');
    const number = value => platform.managed(value, 'double');
    const booleanText = value => platform.native(value) ? 'True' : 'False';
    try {
      for (const value of [NaN, -0, 0, NaN, 1]) call('Add', number(value));
      const lines = [String(call('get_Count'))];
      lines.push(booleanText(call('Remove', number(NaN))));
      lines.push(booleanText(call('Contains', number(0))));
      lines.push(booleanText(call('Remove', number(-0))));
      call('Add', number(2));
      const values = platform.heap.get(call('ToArray')).data.map(value => platform.native(value));
      lines.push(values.join(','));
      assert.deepEqual(lines, nativeNaNLines);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: HashSet removal retains its backing array and cached index`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'HashSet', 'int');
    try {
      for (let value = 0; value < 512; value++) call('Add', value);
      const record = platform.record(reference);
      const index = platform.bclIndexes.get(record).index;
      const storage = platform.get(reference, '$data');
      const data = platform.heap.get(storage).data;
      const allocations = platform.heap.stats.allocations;
      for (let value = 0; value < 512; value++) {
        assert.equal(Boolean(platform.native(call('Remove', value))), true);
        assert.equal(Boolean(platform.native(call('Contains', value))), false);
        assert.strictEqual(platform.bclIndexes.get(record).index, index, 'Removal must not rebuild the lookup Map');
        assert.strictEqual(platform.heap.get(storage).data, data, 'Removal must not replace the backing array');
      }
      assert.equal(index.size, 0);
      assert.equal(call('get_Count'), 0);
      assert.equal(platform.heap.stats.allocations, allocations);
      call('Add', 1024);
      assert.equal(platform.heap.stats.allocations, allocations, 'A free slot is reused without managed allocation');
      assert.equal(Boolean(platform.native(call('Contains', 1024))), true);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: HashSet enumeration skips holes and retains released version/disposal rules`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'HashSet', 'int');
    try {
      for (const value of [10, 20, 30, 40]) call('Add', value);
      call('Remove', 10); call('Remove', 30);
      let iterator = call('GetEnumerator');
      const invoke = name => platform.invoke(findContracts(platform.record(iterator).type, name)[0], [iterator]);
      assert.throws(() => invoke('get_Current'), {name: 'InvalidOperationException'});
      assert.equal(Boolean(platform.native(invoke('MoveNext'))), true);
      assert.equal(invoke('get_Current'), 20);
      const revision = platform.get(reference, '$version');
      assert.equal(Boolean(platform.native(call('Add', 20))), false);
      assert.equal(Boolean(platform.native(call('Remove', -1))), false);
      assert.equal(platform.get(reference, '$version'), revision);
      assert.equal(Boolean(platform.native(invoke('MoveNext'))), true);
      assert.equal(invoke('get_Current'), 40);
      assert.equal(Boolean(platform.native(invoke('MoveNext'))), false);
      assert.equal(Boolean(platform.native(invoke('MoveNext'))), false);
      assert.throws(() => invoke('get_Current'), {name: 'InvalidOperationException'});
      invoke('Dispose'); invoke('Dispose');
      assert.throws(() => invoke('MoveNext'), {name: 'ObjectDisposedException'});
      iterator = call('GetEnumerator');
      call('UnionWith', platform.heap.allocate('array', 'int[]', []));
      assert.equal(platform.get(reference, '$version'), revision + 1);
      assert.throws(() => invoke('MoveNext'), {name: 'InvalidOperationException'});
      iterator = call('GetEnumerator');
      call('Remove', 20);
      assert.throws(() => invoke('MoveNext'), {name: 'InvalidOperationException'});
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: HashSet removal releases managed values while retaining live null`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'HashSet', 'string');
    try {
      call('Add', null);
      const removed = platform.managed('removed', 'string');
      call('Add', removed);
      const retained = platform.managed('retained', 'string');
      call('Add', retained);
      const weak = platform.heap.createHandle(removed, {weak: true});
      call('Remove', removed);
      platform.heap.collect([reference]);
      assert.equal(platform.heap.getHandle(weak), null);
      assert.deepEqual([...hashSetValues(platform, reference)], [null, retained]);
      assert.equal(Boolean(platform.native(call('Contains', null))), true);
      assert.equal(Boolean(platform.native(call('Contains', retained))), true);
      const serializer = findContracts('System.Text.Json.JsonSerializer', 'Serialize')
        .find(member => member.parameters.length === 1 && member.parameters[0] === 'object');
      assert.equal(platform.native(platform.invoke(serializer, [reference])), '[null,"retained"]');
      platform.heap.releaseHandle(weak);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: HashSet free slots, set algebra and indexes replay after restore`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'HashSet', 'int');
    try {
      for (let value = 0; value < 6; value++) call('Add', value);
      call('Remove', 1); call('Remove', 4);
      const saved = platform.heap.snapshot();
      const finish = () => {
        const array = items => platform.heap.allocate('array', 'int[]', items);
        call('UnionWith', array([9, 8]));
        call('ExceptWith', array([0, 5, 0]));
        call('IntersectWith', array([9, 3, 8]));
        return [...hashSetValues(platform, reference)];
      };
      assert.deepEqual(finish(), [8, 3, 9]);
      platform.heap.restore(saved);
      assert.deepEqual(finish(), [8, 3, 9]);
      assert.equal(Boolean(platform.native(call('Contains', 4))), false);
      assert.equal(Boolean(platform.native(call('Contains', 9))), true);
      call('Clear'); call('Clear');
      call('Add', 7); call('Add', 6);
      assert.deepEqual([...hashSetValues(platform, reference)], [7, 6]);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: HashSet rejected array inputs and failed union growth preserve entries`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'HashSet', 'int');
    const allocate = platform.heap.allocate;
    try {
      for (let value = 0; value < 4; value++) call('Add', value);
      const revision = platform.get(reference, '$version');
      for (const method of ['UnionWith', 'IntersectWith', 'ExceptWith']) {
        assert.throws(() => call(method, null), {name: 'NullReferenceException'});
      }
      const extra = platform.heap.allocate('array', 'int[]', [4, 5, 4]);
      let reject = true;
      platform.heap.allocate = function(kind, type, ...args) {
        if (reject && type === 'int[]') {
          reject = false;
          throw new ManagedFault('OutOfMemoryException', 'Injected slot-storage allocation failure');
        }
        return allocate.call(this, kind, type, ...args);
      };
      assert.throws(() => call('UnionWith', extra), {name: 'OutOfMemoryException'});
      assert.equal(call('get_Count'), 4);
      assert.equal(platform.get(reference, '$version'), revision);
      assert.deepEqual([...hashSetValues(platform, reference)], [0, 1, 2, 3]);
      call('UnionWith', extra);
      assert.deepEqual([...hashSetValues(platform, reference)], [0, 1, 2, 3, 4, 5]);
      assert.equal(platform.get(reference, '$version'), revision + 1);
    } finally {
      platform.heap.allocate = allocate;
      vm.stop();
    }
  });
}

test('SF-A08-B03 independent CIL NaN operands match the native HashSet rows', () => {
  const vm = new CilVirtualMachine(hashSetNaNAssembly());
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    const values = vm.heap.get(vm.returnValue).data.map(value => vm.platform.native(value));
    assert.deepEqual([...result.output.trimEnd().split('\n'), values.join(',')], nativeNaNLines);
  } finally { vm.stop(); }
});

test('SF-A08-B03 independent CIL invalid capacity faults with ArgumentOutOfRangeException', () => {
  const vm = new CilVirtualMachine(invalidHashSetCapacityAssembly());
  try {
    const result = vm.run();
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.name, 'ArgumentOutOfRangeException');
  } finally { vm.stop(); }
});
