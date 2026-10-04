import test from 'node:test';
import assert from 'node:assert/strict';
import {findContracts} from '@sharpforge/framework';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';
import {stopwatchPlatform} from './fixtures/stopwatch.js';

const milliseconds = findContracts('System.TimeSpan', 'get_TotalMilliseconds')[0];
const seconds = findContracts('System.TimeSpan', 'get_TotalSeconds')[0];

for (const engine of ['source', 'cil']) {
  test(`TimeSpan ${engine}: legacy getters preserve stored wrappers, missing slots and null receivers`, () => {
    const watch = stopwatchPlatform(engine);
    const {platform} = watch;
    try {
      const raw = platform.managed(-0, 'double');
      const reference = platform.make('System.TimeSpan', {TotalMilliseconds: raw});
      assert.equal(platform.invoke(milliseconds, [reference]), raw);
      assert(Object.is(platform.native(platform.invoke(seconds, [reference])), -0));
      for (const values of [{}, {TotalMilliseconds: null}, {TotalMilliseconds: undefined}]) {
        const value = platform.make('System.TimeSpan', values);
        assert.equal(platform.invoke(milliseconds, [value]), null);
        const totalSeconds = platform.native(platform.invoke(seconds, [value]));
        if (Object.hasOwn(values, 'TotalMilliseconds') && values.TotalMilliseconds === undefined) assert(Number.isNaN(totalSeconds));
        else assert.equal(totalSeconds, 0);
      }
      assert.equal(platform.native(platform.invoke(seconds, [null])), 0);
      assert.throws(() => platform.invoke(milliseconds, [null]), {name: 'NullReferenceException'});
    } finally { watch.stop(); }
  });

  test(`TimeSpan ${engine}: exact-slot presence and replaced property storage remain observable`, () => {
    const watch = stopwatchPlatform(engine);
    const {platform} = watch;
    try {
      const reference = platform.make('System.TimeSpan', {'$ticks': null, TotalMilliseconds: platform.managed(1250, 'double')});
      const handle = platform.heap.createHandle(reference);
      assert.equal(watch.span(reference), 1250);
      const snapshot = watch.vm.snapshot();
      platform.set(reference, '$ticks', undefined);
      for (const descriptor of [milliseconds, seconds]) {
        assert.throws(() => platform.invoke(descriptor, [reference]), {name: 'InvalidOperationException'});
      }
      platform.heap.replaceData(reference, ['TotalMilliseconds', platform.managed(99, 'double'), '$ticks', 15_000_000n]);
      assert.equal(watch.span(reference), 1500);
      assert.equal(watch.span(reference, 'TotalSeconds'), 1.5);
      watch.vm.restore(snapshot);
      assert.equal(watch.span(reference), 1250);
      platform.heap.releaseHandle(handle);
    } finally { watch.stop(); }
  });
}

test('TimeSpan CIL: a real managed local address preserves the stored double wrapper and exact ticks', () => {
  const assembly = managedFixture({methods: [{name: 'Main', result: 'void', locals: ['System.TimeSpan'],
    body(writer) { writer.op('ret'); }}]});
  const vm = new CilVirtualMachine(assembly);
  try {
    const raw = vm.platform.managed(-1250, 'double');
    const reference = vm.platform.make('System.TimeSpan', {TotalMilliseconds: raw});
    vm.top.locals[0] = reference;
    const address = vm.address('local', 0);
    assert.equal(vm.platform.invoke(milliseconds, [address]), raw);
    assert.equal(vm.platform.native(vm.platform.invoke(seconds, [address])), -1.25);
    vm.platform.set(reference, '$ticks', 25_000_000n);
    assert.equal(vm.platform.native(vm.platform.invoke(milliseconds, [address])), 2500);
    assert.equal(vm.platform.native(vm.platform.invoke(seconds, [address])), 2.5);
    assert.deepEqual(vm.dereference(address), reference);
  } finally { vm.stop(); }
});
