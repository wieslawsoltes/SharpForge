import test from 'node:test';
import assert from 'node:assert/strict';
import {Binding, bindingsFor} from '@sharpforge/winui-properties';
import {compilePropertyFixture, propertyEngines, rootedPropertySource} from './helpers/a15-property-managed-fixture.js';

const source = `using System; using System.ComponentModel; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
class Source : StackPanel, INotifyPropertyChanged {
  string title = "first"; public event PropertyChangedEventHandler PropertyChanged;
  public string Title { get { return title; } set { title = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs("Title")); } }
}
class P { static void Main() { Source source = new Source { Name = "source" }; new Window { Content = source }.Activate(); } }`;

test('A15 managed subscription rewind validates the whole snapshot and restores listener identities without user calls', () => {
  const built = compilePropertyFixture(source);
  for (const [name, vm] of propertyEngines(built)) {
    const receiver = rootedPropertySource(vm);
    const services = vm.platform.ui.bindingServices;
    const events = services.events;
    const received = [];
    const old = () => received.push('old');
    events.subscribe(receiver, 'PropertyChanged', old, {propertyName: 'Title'});
    const before = events.snapshot();
    events.subscribe(receiver, 'PropertyChanged', () => received.push('future'), {propertyName: 'Title'});
    const live = events.snapshot();
    for (const malformed of [
      {...before, nextId: 0}, {...before, owner: {}}, {...before, nextListener: 0},
      {...before, entries: [before.entries[0], before.entries[0]]},
      {...before, entries: [{...before.entries[0], listeners: [[1, {callback: null, propertyName: 'Title'}]]}]}
    ]) {
      assert.throws(() => events.restore(malformed), {name: 'ArgumentException'}, name);
      assert.equal(events.nextListener, live.nextListener, name);
    }
    events.restore(before);
    assert.equal(events.nextListener, before.nextListener, name);
    assert.deepEqual(received, [], name);
    services.members.write(receiver, services.members.named(receiver, 'Title'), 'changed');
    assert.deepEqual(received, ['old'], name);
    events.dispose();
    assert.equal(events.listenerCount, 0, name);
    assert.equal(events.entries.size, 0, name);
  }
});

test('A15 managed notification listener capacity faults before mutating the live subscription table', () => {
  const built = compilePropertyFixture(source);
  for (const [name, vm] of propertyEngines(built)) {
    const receiver = rootedPropertySource(vm);
    const events = vm.platform.ui.bindingServices.events;
    events.maxSubscriptions = 1;
    const dispose = events.subscribe(receiver, 'PropertyChanged', () => {}, {propertyName: 'Title'});
    const snapshot = events.snapshot();
    assert.throws(() => events.subscribe(receiver, 'PropertyChanged', () => {}, {propertyName: 'Title'}),
      {name: 'ExecutionLimitException'}, name);
    assert.equal(events.listenerCount, 1, name);
    assert.equal(events.nextListener, snapshot.nextListener, name);
    dispose();
    assert.equal(events.listenerCount, 0, name);
    assert.equal(events.entries.size, 0, name);
  }
});

test('A15 removing a bound subtree releases source handlers and returns managed records to the warmed baseline', () => {
  const built = compilePropertyFixture(source);
  for (const [name, vm] of propertyEngines(built)) {
    const receiver = rootedPropertySource(vm);
    const context = vm.platform.ui;
    const children = context.read(receiver, 'Children');
    const property = context.propertyRegistry.lookup('Microsoft.UI.Xaml.Controls.TextBlock', 'Text');
    const collect = () => { vm.heap.collect(); vm.heap.collect(); };
    const cycle = () => {
      let weak;
      vm.heap.withRoots([receiver, children], () => {
        const target = context.make('Microsoft.UI.Xaml.Controls.TextBlock');
        vm.heap.pins.push(target);
        context.addItem(children, target);
        const state = bindingsFor(context, target);
        state.operations.SetBinding(state.store, property, new Binding({Source: receiver, Path: 'Title'}));
        assert.equal(state.store.getValue(property), 'first', name);
        context.removeItem(children, 0);
        weak = vm.heap.createHandle(target, {weak: true});
      });
      collect();
      assert.equal(vm.heap.getHandle(weak), null, name + ': removed binding target must be collected');
      vm.heap.releaseHandle(weak);
      const event = context.bindingServices.events.event(receiver, 'PropertyChanged');
      assert.equal(context.bindingServices.members.readField(receiver, event.field), null, name + ': source handler must be detached');
      assert.equal(context.bindingServices.events.listenerCount, 0, name);
    };
    cycle();
    const baseline = vm.heap.records.filter(Boolean).length;
    const pins = vm.heap.pins.length;
    for (let index = 0; index < 8; index++) cycle();
    assert.equal(vm.heap.records.filter(Boolean).length, baseline, name);
    assert.equal(vm.heap.pins.length, pins, name);
  }
});
