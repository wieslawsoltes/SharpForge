import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';
import {internString, isInternedString} from '../packages/runtime/src/execution/strings.js';

const compiled = compileToIL('System.Console.WriteLine("run");');
assert(compiled.success, JSON.stringify(compiled.diagnostics));
const create = (engine, weak = true) => engine === 'cil'
  ? new CilVirtualMachine(compiled.assembly, {weakStringInterning: weak})
  : new VirtualMachine(compiled.image, {weakStringInterning: weak});

for (const engine of ['source', 'cil']) {
  test(`${engine}: weak intern snapshot drops collected generations without mutating the live cache`, async () => {
    const vm = create(engine), fresh = create(engine);
    try {
      const expired = vm.heap.string('ephemeral');
      internString(vm, expired);
      vm.heap.collect();
      assert.throws(() => vm.heap.get(expired), {name: 'InvalidReferenceException'});
      const replacement = vm.heap.string('replacement');
      assert.equal(replacement.h, expired.h, 'the captured heap reuses the same slot');
      assert.notEqual(replacement.g, expired.g);
      internString(vm, replacement);
      vm.heap.createHandle(replacement);
      const saved = vm.snapshot();
      assert.equal(vm.strings.get('ephemeral'), expired, 'capture does not prune the live VM cache');
      assert.equal(saved.strings.has('ephemeral'), false);
      assert.equal(saved.strings.get('replacement'), replacement);
      const wire = await serializeSnapshot(vm, saved, {json: true});
      vm.stop();
      vm.heap.collect();
      vm.restore(saved);
      await restoreSerializedSnapshot(fresh, wire);
      for (const replay of [vm, fresh]) {
        replay.heap.collect();
        const reference = replay.strings.get('replacement');
        assert.equal(replay.heap.get(reference).data, 'replacement');
        assert.equal(isInternedString(replay, reference), reference);
        if (replay.state === 'paused') replay.state = 'running';
        assert.equal(replay.run().output, 'run\n');
      }
    } finally { vm.stop(); fresh.stop(); }
  });

  test(`${engine}: weak capture never launders foreign or forged handle ownership`, () => {
    const vm = create(engine), foreign = create(engine);
    try {
      const owned = vm.heap.string('same'), other = foreign.heap.string('same');
      vm.heap.createHandle(owned);
      assert.deepEqual(owned, other);
      for (const reference of [other, Object.freeze({...owned})]) {
        vm.strings.set('same', reference);
        const saved = vm.snapshot(), frame = vm.top;
        assert.equal(saved.strings.get('same'), reference);
        assert.throws(() => vm.restore(saved), /managed reference ownership or generation/);
        assert.equal(vm.top, frame, 'rejected restore is atomic');
      }
    } finally { vm.stop(); foreign.stop(); }
  });

  test(`${engine}: invalid expired strong intern entries remain subject to strict validation`, () => {
    const vm = create(engine, false);
    try {
      const expired = vm.heap.string('expired');
      vm.heap.collect();
      vm.strings.set('expired', expired);
      const saved = vm.snapshot(), frame = vm.top;
      assert.equal(saved.strings.get('expired'), expired);
      assert.throws(() => vm.restore(saved), /managed reference ownership or generation/);
      assert.equal(vm.top, frame);
    } finally { vm.stop(); }
  });
}
