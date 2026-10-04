import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {ControlTemplate, Style, Setter, getResourceServices} from '@sharpforge/winui-properties';

const xaml = 'Microsoft.UI.Xaml.', controls = xaml + 'Controls.';
const source = `using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
  Window window = new Window { Content = new StackPanel { Name = "host" } }; window.Activate();`;

function collect(vm) {
  vm.heap.collect();
  // The next root enumeration prunes owner models whose weak managed identity was just collected.
  vm.heap.collect();
}

function hostRecords(vm) {
  return vm.heap.records.filter(record => record?.kind === 'host').length;
}

function definition(context, label, width) {
  const property = context.propertyRegistry.lookup(controls + 'Control', 'Width');
  const templateProperty = context.propertyRegistry.lookup(controls + 'Control', 'Template');
  const template = new ControlTemplate(templateContext => {
    const root = context.make(controls + 'Border');
    return context.platform.heap.withRoots([root], () => {
      context.write(root, 'Name', 'part');
      const child = context.make(controls + 'TextBlock');
      context.platform.heap.withRoots([child], () => {
        context.write(child, 'Text', label);
        context.write(root, 'Child', child);
      });
      templateContext.bind(root, property, property);
      return root;
    });
  }, {targetType: controls + 'Control'});
  const reference = context.wrapModel(template, controls + 'ControlTemplate');
  return context.platform.heap.withRoots([reference], () => context.wrapModel(new Style(controls + 'Control', {
    setters: [new Setter(property, width), new Setter(templateProperty, reference)]
  }), xaml + 'Style'));
}

for (const Engine of [VirtualMachine, CilVirtualMachine]) {
  test(`A15 ${Engine.name}: template/style replacement on 500 controls returns host records and pins to baseline`, () => {
    const built = compileToIL(source, {includeDebug: false});
    assert.equal(built.success, true, built.diagnostics.map(item => item.message).join('\n'));
    const vm = new Engine(Engine === VirtualMachine ? built.image : built.assembly,
      {maxBytes: 64 * 1024 * 1024, initialThreshold: 1024 * 1024});
    const weak = [];
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      const context = vm.platform.ui, services = getResourceServices(context);
      const host = context.reference(vm.platform.scene().nodes.find(node => node.properties.Name === 'host').id);
      const children = context.read(host, 'Children'), owners = [];
      for (let index = 0; index < 500; index++) {
        const owner = context.make(controls + 'Control');
        vm.heap.withRoots([owner], () => context.addItem(children, owner));
        owners.push(owner);
      }
      const pinsBefore = vm.heap.pins.length;
      vm.heap.withRoots([], () => {
        const first = definition(context, 'first', 40); vm.heap.pins.push(first);
        const second = definition(context, 'second', 80); vm.heap.pins.push(second);
        const apply = style => {
          for (const owner of owners) {
            context.write(owner, 'Style', style);
            services.applyStyle(owner); services.applyTemplate(owner); context.syncOwner(owner);
          }
          context.flushContentPresenters?.();
        };
        apply(first); apply(null); collect(vm);
        const baseline = hostRecords(vm), activePins = vm.heap.pins.length;
        for (let round = 0; round < 8; round++) {
          for (const owner of owners) {
            for (const node of services.templateHost(owner).instance?.nodes ?? []) weak.push(vm.heap.createHandle(node, {weak: true}));
          }
          apply(round % 2 ? second : first);
          collect(vm);
          for (const handle of weak) {
            const retained = vm.heap.getHandle(handle);
            assert.equal(retained, null, retained
              ? 'Replaced template node is retained; $templateOwner=' + String(context.read(retained, '$templateOwner')) : undefined);
            vm.heap.releaseHandle(handle);
          }
          weak.length = 0;
          assert.equal(vm.heap.pins.length, activePins, 'a template application leaked a temporary managed root');
        }
        for (const owner of owners) {
          for (const node of services.templateHost(owner).instance.nodes) weak.push(vm.heap.createHandle(node, {weak: true}));
        }
        apply(null); collect(vm);
        assert.equal(hostRecords(vm), baseline, 'reachable host records grew after removing every dynamic template/style');
        for (const handle of weak) assert.equal(vm.heap.getHandle(handle), null, 'an old $templateOwner tree survived cleanup');
      });
      assert.equal(vm.heap.pins.length, pinsBefore);
      for (const handle of weak) vm.heap.releaseHandle(handle);
      weak.length = 0;
      assert.equal(vm.heap.stats.hostWeakHandles, 0);
    } finally {
      for (const handle of weak) vm.heap.releaseHandle(handle);
      vm.stop();
    }
  });
}
