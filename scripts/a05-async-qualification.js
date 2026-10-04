import assert from 'node:assert/strict';
import {
  CilVirtualMachine,
  serializeSnapshot,
  restoreSerializedSnapshot
} from '../packages/runtime/src/index.js';

const awaiting = vm => [...vm.scheduler.tasks.values()].filter(task => task.asyncState?.phase === 'awaiting');
const sameReference = (left, right) => left?.h === right?.h && left?.g === right?.g;

/** Qualify the same Roslyn DLL at both suspensions, then replay independently in fresh VMs. */
export async function qualifyAsyncAssembly(assembly) {
  const create = () => new CilVirtualMachine(assembly, {
    virtualTime: true
  });
  const vm = create(),
    checkpoints = [];
  let result = vm.run(),
    builder = null,
    previousAwait = null;
  for (let ordinal = 1; ordinal <= 2; ordinal++) {
    assert.equal(result.state, 'waiting', result.fault?.stack ?? 'Expected an async suspension');
    const task = awaiting(vm).find(candidate => !builder || sameReference(candidate.ref, builder));
    assert(task, 'Both checkpoints must suspend the same Roslyn state machine');
    assert(task.asyncState.machine, 'Await must retain the boxed or reference state machine');
    assert(!previousAwait || !sameReference(previousAwait, task.asyncState.awaitedTask), 'Second await must have a distinct dependency');
    builder = task.ref;
    previousAwait = task.asyncState.awaitedTask;
    vm.heap.collect();
    const snapshot = vm.snapshot(), wire = await serializeSnapshot(vm, snapshot, {
      json: true
    });
    checkpoints.push({
      ordinal,
      snapshot,
      wire
    });
    const delay = vm.scheduler.nextDelay();
    assert.notEqual(delay, null, 'Native fixture await needs a deterministic timer');
    vm.scheduler.advance(delay);
    result = ordinal === 1 ? vm.run() : await vm.runAsync();
  }
  assert.equal(result.state, 'terminated', result.fault?.stack);
  vm.stop();
  vm.heap.collect();
  const replays = [];
  for (const checkpoint of checkpoints) {
    vm.restore(checkpoint.snapshot);
    vm.heap.collect();
    const local = await vm.runAsync();
    assert.equal(local.state, 'terminated', local.fault?.stack);
    assert.equal(local.exitCode, result.exitCode, 'Local replay exit code');
    assert.equal(local.output, result.output, 'Local replay must execute finally exactly once');
    replays.push({await: checkpoint.ordinal, kind: 'local', state: local.state, exitCode: local.exitCode,
      output: local.output, instructions: local.stats.instructions});
    const fresh = await restoreSerializedSnapshot(create(), checkpoint.wire);
    fresh.heap.collect();
    const replay = await fresh.runAsync();
    assert.equal(replay.state, 'terminated', replay.fault?.stack);
    assert.equal(replay.exitCode, result.exitCode, 'Portable replay exit code');
    assert.equal(replay.output, result.output, 'Portable replay must execute finally exactly once');
    replays.push({
      await: checkpoint.ordinal,
      kind: 'portable',
      state: replay.state,
      exitCode: replay.exitCode,
      output: replay.output,
      instructions: replay.stats.instructions
    });
  }
  return {
    result,
    replays
  };
}
