import test from 'node:test';
import assert from 'node:assert/strict';
import {applyControlStateFeedback} from '@sharpforge/winui-controls';
import {compilePropertyFixture, propertyEngines, rootedPropertySource} from './helpers/a15-property-managed-fixture.js';

test('Project 14: pointer and focus feedback reaches properties and real template states on all managed engines', () => {
  const built = compilePropertyFixture(`using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
    Button source = new Button { Name = "source", Content = "Action" };
    new Window { Content = source }.Activate();`);
  for (const [engine, vm] of propertyEngines(built)) {
    const owner = rootedPropertySource(vm), context = vm.platform.ui, id = context.id(owner);
    const definitions = context.propertiesFor(context.typeOf(owner));
    const read = name => context.properties.toNative(context.read(owner, name), definitions[name].type);
    try {
      applyControlStateFeedback(context, [{id, properties: {IsPointerOver: true, IsPressed: true, FocusState: 2}}]);
      assert.equal(read('IsPointerOver'), true, engine);
      assert.equal(read('IsPressed'), true, engine);
      assert.equal(read('FocusState'), 2, engine);
      const scene = vm.platform.scene();
      const border = scene.nodes.find(node => node.properties.Name === 'RootBorder');
      const focus = scene.nodes.find(node => node.properties.Name === 'FocusVisual');
      assert.equal(border.properties.Opacity, 0.85, engine);
      assert.equal(focus.properties.Opacity, 1, engine);
      const snapshot = vm.snapshot();
      applyControlStateFeedback(context, [{id, properties: {IsPointerOver: false, IsPressed: false, FocusState: 0}}]);
      assert.equal(read('IsPressed'), false, engine);
      vm.restore(snapshot);
      assert.equal(read('IsPressed'), true, engine);
      assert.throws(() => applyControlStateFeedback(context, [{id, properties: {IsPressed: false}},
        {id: 'missing', properties: {IsPressed: false}}]), undefined, engine);
      assert.equal(read('IsPressed'), true, engine + ': resolve the complete batch before mutation');
      assert.throws(() => applyControlStateFeedback(context, [{id, properties: {Content: 'unauthorized'}}]), /Invalid control state field/);
      context.write(owner, 'IsEnabled', false);
      applyControlStateFeedback(context, [{id, properties: {IsPointerOver: false, IsPressed: false, FocusState: 0}}]);
      const disabledBorder = vm.platform.scene().nodes.find(node => node.properties.Name === 'RootBorder');
      assert.equal(disabledBorder.properties.Opacity, 0.45, engine + ': declared Boolean state selects the disabled visual');
    } finally { vm.stop(); }
  }
});
