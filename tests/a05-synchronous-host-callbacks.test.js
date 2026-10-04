import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

let program;
function createVM(engine) {
  program ??= compileToIL('class Program { static void Main() {} }');
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  return engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
}

function assertBlocked(vm, saved) {
  const frames = vm.frames;
  const revision = vm.heap.mutationRevision;
  assert.throws(() => vm.snapshot(), /synchronous host callbacks/);
  assert.throws(() => vm.restore(saved), /synchronous host callbacks/);
  assert.equal(vm.frames, frames);
  assert.equal(vm.heap.mutationRevision, revision);
}

for (const engine of ['source', 'cil']) {
  test(`synchronous host callback ${engine}: receiver, nested scopes and result inspection retain the boundary`, () => {
    const vm = createVM(engine);
    const other = createVM(engine);
    const platform = vm.platform;
    const invoke = platform.bclHost.invokeSynchronousHostCallback;
    const saved = vm.snapshot();
    const receiver = {value: 17};
    const returned = {value: 29};
    let inspections = 0;
    function callback() {
      assert.equal(this, receiver);
      assert.equal(arguments.length, 0);
      assertBlocked(vm, saved);
      assert.equal(invoke(platform, function () {
        assert.equal(this, receiver);
        assertBlocked(vm, saved);
        other.restore(other.snapshot());
        return this.value;
      }, receiver), 17);
      assertBlocked(vm, saved);
      return returned;
    }
    callback.call = () => { throw new Error('The callback call property must not be consulted'); };
    try {
      assert(Object.isFrozen(platform.bclHost));
      assert.equal(invoke(platform, callback, receiver, result => {
        inspections++;
        assert.equal(result, returned);
        assertBlocked(vm, saved);
      }), returned);
      assert.equal(inspections, 1);
      assert.equal(platform.synchronousHostCallbackDepth, 0);
      assert.equal(other.platform.synchronousHostCallbackDepth, 0);
      vm.restore(saved);
      assert(vm.snapshot());
    } finally {
      vm.stop();
      other.stop();
    }
  });

  test(`synchronous host callback ${engine}: callback and inspection failures release the scope unchanged`, () => {
    const vm = createVM(engine);
    const platform = vm.platform;
    const invoke = platform.bclHost.invokeSynchronousHostCallback;
    const saved = vm.snapshot();
    const failure = new Error('Host callback failed');
    try {
      for (const phase of ['callback', 'inspection']) {
        assert.throws(() => invoke(platform, () => {
          assertBlocked(vm, saved);
          if (phase === 'callback') throw failure;
          return 7;
        }, null, () => {
          assertBlocked(vm, saved);
          throw failure;
        }), error => error === failure);
        assert.equal(platform.synchronousHostCallbackDepth, 0);
        vm.restore(saved);
        assert(vm.snapshot());
      }
    } finally { vm.stop(); }
  });

  test(`synchronous host callback ${engine}: explicit stop keeps the boundary until callback completion`, () => {
    const vm = createVM(engine);
    const platform = vm.platform;
    const saved = vm.snapshot();
    try {
      assert.equal(platform.bclHost.invokeSynchronousHostCallback(platform, () => {
        vm.stop();
        assertBlocked(vm, saved);
        return 7;
      }, null), 7);
      assert.equal(platform.synchronousHostCallbackDepth, 0);
      assert.equal(platform.bclHost.isExecutionStopped(platform), true);
      vm.restore(saved);
      assert.equal(platform.bclHost.isExecutionStopped(platform), false);
      assert(vm.snapshot());
    } finally { vm.stop(); }
  });
}
