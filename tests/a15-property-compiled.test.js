import test from 'node:test';
import assert from 'node:assert/strict';
import {ObservableObject, createCompiledBindings, validateCompiledBindingDescriptor} from '@sharpforge/winui-properties';

const member = 0x17000001;
const other = 0x17000002;
const path = (...tokens) => ({kind: 'path', steps: tokens.map(token => ({token}))});
const descriptor = expression => ({version: 1, kind: 'property', mode: 'OneWay', target: {id: 'target', token: member}, expression});

function services(target) {
  return {
    get: (receiver, token) => receiver.get(String(token)),
    set: (receiver, token, value) => receiver.set(String(token), value),
    subscribe: (receiver, token, changed) => receiver.subscribe(event => {
      if (!event.propertyName || event.propertyName === String(token)) changed();
    }),
    targetSet: (receiver, token, value) => receiver.set(String(token), value),
    targetSubscribe: (receiver, token, changed) => receiver.subscribe(event => {
      if (event.propertyName === String(token)) changed(event.newValue);
    }),
    invoke: (receiver, token, args) => token === 0x06000001 ? args[0] * 2 : receiver.set(String(member), args[0]),
    target: () => target
  };
}

test('A15 compiled descriptor rejects executable data, accessors and invalid token paths', () => {
  const valid = descriptor(path(member));
  assert(Object.isFrozen(validateCompiledBindingDescriptor(valid)));
  for (const invalid of [
    {...valid, version: 2}, {...valid, expression: path(0)}, {...valid, execute: () => 1},
    {...valid, expression: {kind: 'path', steps: [{name: 'Property'}]}}
  ]) assert.throws(() => validateCompiledBindingDescriptor(invalid), {kind: 'ArgumentException'});
  let calls = 0;
  const getter = {...valid};
  Object.defineProperty(getter, 'expression', {get() { calls++; return path(member); }, enumerable: true});
  assert.throws(() => validateCompiledBindingDescriptor(getter), {kind: 'ArgumentException'});
  assert.equal(calls, 0);
});

test('A15 compiled token paths retarget intermediates and StopTracking releases every subscription', () => {
  const first = new ObservableObject({[member]: 3});
  const next = new ObservableObject({[member]: 7});
  const source = new ObservableObject({[other]: first});
  const target = new ObservableObject({[member]: 0});
  const bindings = createCompiledBindings({
    descriptors: [descriptor(path(other, member))], source: () => source, target: () => target, services: services(target)
  });
  bindings.Initialize();
  assert.equal(target.get(String(member)), 3);
  source.set(String(other), next);
  assert.equal(target.get(String(member)), 7);
  assert.equal(first.subscriberCount, 0);
  bindings.StopTracking();
  assert.equal(source.subscriberCount + next.subscriberCount, 0);
  next.set(String(member), 9);
  assert.equal(target.get(String(member)), 7);
  bindings.Update();
  assert.equal(target.get(String(member)), 9);
  assert.equal(source.subscriberCount + next.subscriberCount, 0);
  bindings.Initialize();
  bindings.Dispose();
  assert.equal(source.subscriberCount + next.subscriberCount, 0);
});

test('A15 compiled function arguments retrigger and BindBack receives the target value', () => {
  const source = new ObservableObject({[member]: 3});
  const target = new ObservableObject({[member]: 0});
  const item = {
    ...descriptor({kind: 'call', token: 0x06000001, arguments: [path(member)]}),
    mode: 'TwoWay',
    bindBack: {kind: 'call', token: 0x06000002, receiver: path(), arguments: [{kind: 'context', name: 'value'}]}
  };
  const bindings = createCompiledBindings({descriptors: [item], source: () => source, target: () => target, services: services(target)});
  bindings.Initialize();
  assert.equal(target.get(String(member)), 6);
  source.set(String(member), 4);
  assert.equal(target.get(String(member)), 8);
  target.set(String(member), 5);
  assert.equal(source.get(String(member)), 5);
  assert.equal(target.get(String(member)), 10);
  bindings.Dispose();
  assert.equal(source.subscriberCount + target.subscriberCount, 0);
});

test('A15 compiled event bindings invoke token methods with sender and event arguments', () => {
  const events = new Set();
  const calls = [];
  const source = new ObservableObject();
  const target = {};
  const item = {version: 1, kind: 'event', target: {id: 'target', token: 0x14000001}, expression: {
    kind: 'call', token: 0x06000003, receiver: path(),
    arguments: [{kind: 'context', name: 'sender'}, {kind: 'context', name: 'eventArgs'}]
  }};
  const bindings = createCompiledBindings({descriptors: [item], source: () => source, target: () => target, services: {
    get: () => null,
    invoke: (receiver, token, args) => calls.push([receiver, token, args]),
    subscribeEvent: (receiver, token, handler) => { events.add(handler); return () => events.delete(handler); }
  }});
  bindings.Initialize();
  const args = {Handled: false};
  for (const handler of events) handler(target, args);
  assert.deepEqual(calls, [[source, 0x06000003, [target, args]]]);
  bindings.StopTracking();
  assert.equal(events.size, 0);
});

