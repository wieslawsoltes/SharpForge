import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';

const waiting = `using System; using System.Threading.Tasks;
class Box { public string Text; }
class Program {
  static async Task Main() {
    var box = new Box() { Text = "retained until cancellation" };
    await Task.Delay(100);
    Console.WriteLine(box.Text);
  }
}`;
const visual = `using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
var button = new Button() { Name = "old-target" };
var window = new Window() { Content = button };
window.Activate();`;

function create(source, engine, VM) {
  const compilation = compileToIL(source);
  assert(compilation.success, JSON.stringify(compilation.diagnostics));
  return new VM(engine === 'source' ? compilation.image : compilation.assembly,
    {gcStress: 'alloc', initialThreshold: 64, virtualTime: true});
}

for (const [engine, VM] of [['source', VirtualMachine], ['cil', CilVirtualMachine]]) {
  test(`${engine}: cancellation retains terminal thread diagnostics without retaining managed contexts`, async () => {
    const vm = create(waiting, engine, VM);
    try {
      assert.equal(vm.run().state, 'waiting');
      const before = vm.scheduler.threads();
      assert(before.length >= 2);
      assert(before.some(thread => thread.status === 'waiting'));
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(vm.runAsync({signal: controller.signal}), /cancel/i);
      const after = vm.scheduler.threads();
      assert.equal(vm.state, 'terminated');
      assert.deepEqual(after.map(thread => thread.id), before.map(thread => thread.id));
      for (const thread of after) {
        const previous = before.find(item => item.id === thread.id);
        assert.equal(thread.status, previous.status === 'completed' ? 'completed' : 'canceled');
        assert.deepEqual(thread.frameIds, []);
        assert.equal(thread.waitingFor, null);
      }
      assert.equal(vm.scheduler.contexts.size, 0);
      assert.equal(vm.scheduler.tasks.size, 0);
      assert.deepEqual(vm.allFrames(), []);
      assert.equal(vm.heap.stats.liveObjects, 0);
      const snapshot = vm.scheduler.snapshot();
      after[0].status = 'running';
      after[0].frameIds.push(123);
      vm.scheduler.restore(snapshot);
      assert.deepEqual(vm.scheduler.threads(), snapshot.finishedThreads);
      snapshot.finishedThreads[0].frameIds.push(456);
      assert.deepEqual(vm.scheduler.threads()[0].frameIds, []);
      vm.stop();
      assert.equal(vm.scheduler.threads()[0].status === 'running', false);
    } finally {vm.stop();}
  });

  test(`${engine}: reclaimed UI event targets retain the inactive visual tree diagnostic`, async () => {
    const vm = create(visual, engine, VM);
    try {
      assert.equal((await vm.runAsync()).state, 'terminated');
      const target = vm.platform.scene().nodes.find(node => node.properties.Name === 'old-target');
      assert(target);
      const [h, g] = target.id.split(':').map(Number);
      vm.stop();
      assert.equal(vm.heap.stats.liveObjects, 0);
      assert.throws(() => vm.heap.get({h, g}), {name: 'InvalidReferenceException'});
      assert.throws(() => vm.platform.dispatchEvent(target.id, 'Click'), /active visual tree/);
      assert.equal(vm.scheduler.contexts.size, 0);
    } finally {vm.stop();}
  });
}
