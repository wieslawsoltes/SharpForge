import test from 'node:test';
import assert from 'node:assert/strict';
import {UIExtensionRegistry} from '@sharpforge/winui-properties';

test('UI adapters resolve overload arity, declaring base and receiver context', () => {
  const registry = new UIExtensionRegistry({baseType: type => type === 'Child' ? 'Base' : null});
  registry.register({owner: 'Base', name: 'Read'}, ({context, receiver, args}) => context.read(receiver, args[0]));
  registry.register({owner: 'Base', name: 'Read', arity: 0}, () => 42);
  const context = {read: (receiver, name) => receiver[name]};
  const descriptor = {owner: 'Child', kind: 'method', name: 'Read'};
  assert.deepEqual(registry.invoke(context, descriptor, {Name: 'saved'}, ['Name']), {handled: true, value: 'saved'});
  assert.deepEqual(registry.invoke(context, descriptor, {}, []), {handled: true, value: 42});
  assert.deepEqual(registry.invoke(context, {...descriptor, name: 'Unknown'}, {}, []), {handled: false});
});

test('UI adapter registrations are isolated and disposed once', () => {
  const left = new UIExtensionRegistry();
  const right = new UIExtensionRegistry();
  const member = {owner: 'Owner', kind: 'method', name: 'Run', arity: 0};
  const dispose = left.register(member, () => null);
  assert.throws(() => left.register(member, () => null), /Duplicate/);
  assert.equal(right.invoke({}, member, {}, []).handled, false);
  assert.equal(dispose(), true);
  assert.equal(dispose(), false);
  assert.equal(left.invoke({}, member, {}, []).handled, false);
});

test('UI adapter boundaries reject invalid arity, inherited cycles and promises', () => {
  const registry = new UIExtensionRegistry({baseType: type => type === 'A' ? 'B' : 'A'});
  const member = {owner: 'A', kind: 'method', name: 'Run'};
  assert.throws(() => registry.register({...member, arity: -1}, () => null), /arity/);
  assert.throws(() => registry.invoke({}, member, {}, []), /cycle/);
  registry.register(member, () => Promise.resolve());
  assert.throws(() => registry.invoke({}, member, {}, []), /synchronously/);
});
