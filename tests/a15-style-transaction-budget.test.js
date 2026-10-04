import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {Style, Setter, getResourceServices} from '@sharpforge/winui-properties';

const controls = 'Microsoft.UI.Xaml.Controls.';
const source = `using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
  Window window = new Window {Content = new StackPanel {Name = "owners"}}; window.Activate();`;

for (const Engine of [VirtualMachine, CilVirtualMachine]) {
  test(`A15 ${Engine.name}: styling 1000 controls never snapshots the managed heap and invalid setters are atomic`, () => {
    const built = compileToIL(source, {includeDebug: false});
    assert.equal(built.success, true, built.diagnostics.map(item => item.message).join('\n'));
    const vm = new Engine(Engine === VirtualMachine ? built.image : built.assembly,
      {initialThreshold: 1024 * 1024, maxBytes: 64 * 1024 * 1024, maxUICommands: 100000});
    const originalSnapshot = vm.heap.snapshot;
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      const context = vm.platform.ui, services = getResourceServices(context);
      const host = context.reference(vm.platform.scene().nodes.find(node => node.properties.Name === 'owners').id);
      const children = context.read(host, 'Children'), owners = [];
      for (let index = 0; index < 1000; index++) {
        const owner = context.make(controls + 'Control');
        vm.heap.withRoots([owner], () => context.addItem(children, owner));
        owners.push(owner);
      }
      const width = context.propertyRegistry.lookup(controls + 'Control', 'Width');
      const height = context.propertyRegistry.lookup(controls + 'Control', 'Height');
      vm.heap.withRoots([], () => {
        const valid = context.wrapModel(new Style(controls + 'Control', {
          setters: [new Setter(width, 10), new Setter(height, 20)]
        }), 'Microsoft.UI.Xaml.Style');
        vm.heap.pins.push(valid);
        const invalid = context.wrapModel(new Style(controls + 'Control', {
          setters: [new Setter(width, 30), new Setter(height, 'invalid')]
        }), 'Microsoft.UI.Xaml.Style');
        vm.heap.pins.push(invalid);
        let snapshots = 0;
        vm.heap.snapshot = function (...args) {
          snapshots++;
          return originalSnapshot.apply(this, args);
        };
        const apply = (owner, style) => context.sceneTransaction(() => {
          context.write(owner, 'Style', style);
          services.applyStyle(owner);
        });
        for (const owner of owners) apply(owner, valid);
        for (const owner of owners) {
          const store = context.storeFor(owner);
          assert.equal(store.getValue(width), 10);
          assert.equal(store.getValue(height), 20);
        }
        assert.throws(() => apply(owners[0], invalid));
        assert.equal(context.storeFor(owners[0]).getValue(width), 10);
        assert.equal(context.storeFor(owners[0]).getValue(height), 20);
        assert.deepEqual(context.read(owners[0], 'Style'), valid);
        assert.equal(snapshots, 0, 'style application or rollback copied the entire managed heap');
      });
    } finally {
      vm.heap.snapshot = originalSnapshot;
      vm.stop();
    }
  });
}
