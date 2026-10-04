import test from 'node:test';
import assert from 'node:assert/strict';
import {ObservableObject, CompiledBindings, CompiledBindingGroup, BindingPhaseScheduler} from '@sharpforge/winui-properties';

test('A15 compiled controller/group rewind detaches future observers without evaluating source or converters', () => {
  const source = new ObservableObject({value: 2}), target = {};
  let reads = 0, calls = 0, writes = 0, restoreDepth = 0;
  const services = {
    get: receiver => { reads++; return receiver.get('value'); },
    subscribe: (receiver, token, callback) => receiver.subscribe(callback),
    invoke: (receiver, token, args) => { calls++; return args[0] * 2; },
    targetSet: (receiver, token, value) => { writes++; receiver.value = value; },
    beginRestore: () => restoreDepth++, endRestore: () => restoreDepth--
  };
  const make = () => new CompiledBindings({source: () => source, target: () => target, services, descriptors: [{
    version: 1, kind: 'property', mode: 'OneWay', target: {id: 'target', token: 0x17000002},
    expression: {kind: 'call', token: 0x06000001, arguments: [{kind: 'path', steps: [{token: 0x17000001}]}]}
  }]});
  const first = make(), group = new CompiledBindingGroup();
  group.add(first); first.Initialize();
  const snapshot = group.snapshot();
  const future = make(); group.add(future); future.Initialize();
  const before = [reads, calls, writes];
  group.restore(snapshot);
  assert.deepEqual([reads, calls, writes], before);
  assert.equal(future.disposed, true);
  assert.equal(source.subscriberCount, 1);
  assert.equal(restoreDepth, 0);
  source.set('value', 3);
  assert.equal(target.value, 6);
  group.Dispose();
  assert.equal(source.subscriberCount, 0);
});

test('A15 phase restore reinstalls queued frames without invoking work and rejects invalid identities', () => {
  const frames = [], values = [];
  const scheduler = new BindingPhaseScheduler({requestFrame: callback => frames.push(callback)});
  scheduler.enqueue(2, () => values.push(2));
  scheduler.enqueue(1, () => values.push(1));
  const snapshot = scheduler.snapshot();
  scheduler.cancel(); scheduler.restore(snapshot);
  assert.deepEqual(values, []);
  frames.shift()();
  assert.deepEqual(values, []);
  frames.shift()();
  assert.deepEqual(values, [1]);
  frames.shift()();
  assert.deepEqual(values, [1, 2]);
  const before = scheduler.snapshot();
  assert.throws(() => scheduler.restore({...snapshot, nextId: 1}), TypeError);
  assert.deepEqual(scheduler.snapshot(), before);
  scheduler.dispose();
  const invalid = new BindingPhaseScheduler({requestFrame: callback => callback()});
  assert.throws(() => invalid.enqueue(1, () => values.push(99)), {kind: 'InvalidOperationException'});
  assert.deepEqual(values, [1, 2]);
  assert.equal(invalid.pending, 0);
});

