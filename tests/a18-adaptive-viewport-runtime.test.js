import test from 'node:test';
import assert from 'node:assert/strict';
import {contracts, eventsFor, frameworkType, findContracts, XAML} from '@sharpforge/framework';
import {applyResponsivePreview} from '@sharpforge/designer';
import {viewportDesign, viewportSources, viewportCompilation, viewportMachines, viewportMachine,
  viewportNode} from './fixtures/a18-adaptive-viewport.js';

test('native window resize contracts append A18 IDs without modifying the attached-property reservation', () => {
  const added = contracts.filter(contract => contract.id >= 1245193 && contract.id <= 1245201);
  assert.deepEqual(added.map(contract => [contract.id, contract.name]), [
    [1245193, 'get_Width'], [1245194, 'get_Height'], [1245195, 'get_Size'], [1245196, 'get_Handled'],
    [1245197, 'set_Handled'], [1245198, '.ctor'], [1245199, 'Invoke'], [1245200, 'add_SizeChanged'], [1245201, 'remove_SizeChanged']
  ]);
  const handler = eventsFor(XAML + 'Window').SizeChanged;
  assert.equal(handler, 'Windows.Foundation.TypedEventHandler`2<object, Microsoft.UI.Xaml.WindowSizeChangedEventArgs>');
  assert.deepEqual(frameworkType(handler).parameters, ['object', XAML + 'WindowSizeChangedEventArgs']);
  assert.equal(findContracts(XAML + 'Window', 'add_SizeChanged')[0].id, 1245200);
  assert.equal(findContracts(XAML + 'WindowSizeChangedEventArgs', 'get_Size')[0].result, 'Windows.Foundation.Size');
});

for (const Machine of viewportMachines) {
  test(`${Machine.name}: native typed event removal matches method-group identity without suppressing other handlers`, () => {
    const source = viewportSources().map(file => ({...file, text: file.text.replace('v_window.SizeChanged += OnAdaptiveSizeChanged;',
      'v_window.SizeChanged += OnAdaptiveSizeChanged; v_window.SizeChanged -= OnAdaptiveSizeChanged;')}));
    const machine = viewportMachine(Machine, viewportCompilation(source));
    const id = machine.platform.scene().windows[0];
    machine.platform.updateLayout([{id, width: 300, height: 600}]);
    assert.equal(machine.run().output.replace(/\r/g, ''), '300\n600\n');
    assert.equal(viewportNode(machine).properties.Width, 240);
    machine.stop();
  });

  test(`${Machine.name}: real window measurements wake idle managed code and match two-breakpoint preview geometry`, () => {
    const machine = viewportMachine(Machine, viewportCompilation());
    const id = machine.platform.scene().windows[0];
    const design = viewportDesign();
    assert.equal(viewportNode(machine).properties.Width, 240, 'Authored initial width applies before the first host measurement');
    let output = '';
    for (const width of [0, 599.99, 600, 999.99, 1000, 100000, 320]) {
      machine.platform.updateLayout([{id, width, height: 640}]);
      assert.equal(machine.state, 'running', 'Terminated entry point must wake for its window event');
      machine.heap.collect();
      const result = machine.run();
      assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
      output += `${width}\n640\n`;
      assert.equal(result.output.replace(/\r/g, ''), output);
      const expected = applyResponsivePreview(design, width).nodes.find(node => node.id === 'action').properties;
      const actual = viewportNode(machine).properties;
      assert.deepEqual([actual.Width, actual.Left, actual.Top, actual.RowSpan],
        [expected.Width, expected.Left, expected.Top, expected.RowSpan ?? 1]);
      machine.platform.updateLayout([{id, width, height: 640}]);
      assert.equal(machine.state, 'terminated', 'Identical layout feedback must not enqueue another event');
      const canvas = machine.platform.scene().nodes.find(node => node.type.endsWith('.Canvas'));
      assert.equal(canvas.properties.Width, 960, 'Trigger follows the window even when the Canvas keeps an authored width');
    }
    machine.stop();
  });

  test(`${Machine.name}: layout validation is atomic; coalescing, height changes, snapshots and stop retain event lifetime`, () => {
    const machine = viewportMachine(Machine, viewportCompilation());
    const id = machine.platform.scene().windows[0];
    const before = machine.platform.scene();
    for (const invalid of [null, {id: 'missing', width: 1, height: 2}, {id, width: NaN, height: 2},
      {id, width: 1, height: -1}, {id, width: 100001, height: 2}]) {
      assert.throws(() => machine.platform.updateLayout([{id, width: 300, height: 640}, invalid]), /measurement/);
      assert.deepEqual(machine.platform.scene(), before);
      assert.equal(machine.state, 'terminated');
    }
    assert.throws(() => machine.platform.updateLayout(Array(10001).fill({id, width: 1, height: 1})), /limit/);
    assert.throws(() => machine.platform.dispatchEvent(id, 'SizeChanged'), /validated visual layout/);
    machine.platform.updateLayout([{id, width: 300, height: 640}, {id, width: 700, height: 600}]);
    assert.equal(machine.run().output.replace(/\r/g, ''), '700\n600\n');
    const snapshot = machine.snapshot();
    machine.platform.updateLayout([{id, width: 700, height: 601}]);
    assert.equal(machine.run().output.replace(/\r/g, ''), '700\n600\n700\n601\n');
    machine.restore(snapshot);
    machine.state = 'terminated';
    machine.platform.updateLayout([{id, width: 700, height: 600}]);
    assert.equal(machine.state, 'terminated');
    machine.platform.updateLayout([{id, width: 300, height: 640}]);
    machine.stop();
    assert.equal(machine.platform.scene().windows.length, 0);
    const stopped = machine.run();
    assert.equal(stopped.state, 'terminated');
    assert.equal(stopped.output.replace(/\r/g, ''), '700\n600\n');
    assert.throws(() => machine.platform.updateLayout([{id, width: 300, height: 640}]), /measurement/);
  });
}
