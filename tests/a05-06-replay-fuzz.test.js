import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';
import {SnapshotVersionError} from '../packages/runtime/src/execution/snapshot-version.js';

const program = `class P {
  static int Visit(int depth, int value) {
    try {
      if (depth == 0) { if (value == 7) throw new Exception("leaf"); return value; }
      return Visit(depth - 1, value) + depth;
    } catch (Exception error) { Console.WriteLine(error.Message); return value; }
    finally { Console.WriteLine(depth); }
  }
  static void Main() { Console.WriteLine(Visit(4, 7)); }
}`;
const expected = 'leaf\n0\n1\n2\n3\n4\n17\n';
function random(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
}
function factory(engine, artifact) {
  return () => engine === 'cil' ? new CilVirtualMachine(artifact.assembly)
    : new VirtualMachine(engine === 'source' ? artifact.image : loadAssembly(artifact.assembly));
}

for (const engine of ['source', 'reload', 'cil']) {
  test(`T06 ${engine}: seeded random instruction boundaries replay nested calls, faults and finally`, async () => {
    const artifact = compileToIL(program);
    assert(artifact.success, JSON.stringify(artifact.diagnostics));
    const create = factory(engine, artifact);
    let captured = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const vm = create();
      const next = random(seed);
      const saved = [];
      while (['ready', 'running'].includes(vm.state)) {
        vm.runSlice({instructionBudget: 1 + next() % 7, timeBudgetMs: 1000});
        if (vm.frames.length && next() % 3 === 0) saved.push(vm.snapshot());
      }
      assert.equal(vm.state, 'terminated', vm.fault?.stack);
      assert.equal(vm.output.join(''), expected);
      assert(saved.length > 0, 'Seed ' + seed + ' captured no boundaries');
      for (const snapshot of saved) {
        const wire = await serializeSnapshot(vm, snapshot, {json: seed % 2 === 0});
        vm.restore(snapshot);
        vm.heap.collect();
        assert.equal(vm.run().output, expected, `same VM seed ${seed}, instruction ${snapshot.instructions}`);
        const fresh = create();
        await restoreSerializedSnapshot(fresh, typeof wire === 'string' ? wire : structuredClone(wire));
        fresh.heap.collect();
        assert.equal(fresh.run().output, expected, `fresh VM seed ${seed}, instruction ${snapshot.instructions}`);
        captured++;
      }
    }
    assert(captured >= 16);
  });

  test(`T06 ${engine}: schema errors are typed and leave identities unchanged`, () => {
    const artifact = compileToIL('Console.WriteLine(1);');
    assert(artifact.success);
    const vm = factory(engine, artifact)();
    const saved = vm.snapshot();
    const frames = vm.frames;
    const heap = vm.heap.records;
    for (const schemaVersion of [0, saved.schemaVersion - 1, saved.schemaVersion + 1, '4', null]) {
      assert.throws(() => vm.restore({...saved, schemaVersion}), error =>
        error instanceof SnapshotVersionError && error.code === 'SNAPSHOT_SCHEMA_VERSION');
      assert.equal(vm.frames, frames);
      assert.equal(vm.heap.records, heap);
    }
  });
}
