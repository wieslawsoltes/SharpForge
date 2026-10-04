import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DependencyPropertyRegistry, PropertyStore, EffectiveValueEmitter, ValueSource, UnsetValue, defaultPropertyValue
} from '@sharpforge/winui-properties';

test('A15 portable registration validates defaults and capacity before publishing an identity', () => {
  const registry = new DependencyPropertyRegistry({maxProperties: 1});
  const options = {ownerType: 'Owner', name: 'Flag', propertyType: 'bool'};
  assert.throws(() => registry.register({...options, metadata: {defaultValue: 1}}), {kind: 'ArgumentException'});
  const property = registry.register(options);
  assert.equal(property.id, 1);
  assert.equal(property.metadata.defaultValue, false);
  assert.throws(() => registry.register({...options, name: 'Other'}), {kind: 'InvalidOperationException'});
  for (const maxProperties of [0, -1, 0.5, Infinity, 1000001]) assert.throws(() => new DependencyPropertyRegistry({maxProperties}));
  for (const ownerType of ['', 1, {}, 'a'.repeat(4097)]) {
    assert.throws(() => new DependencyPropertyRegistry().register({...options, ownerType}), {kind: 'ArgumentException'});
  }
});

test('A15 registry snapshot preflight preserves live state when counters or identities are malformed', () => {
  const registry = new DependencyPropertyRegistry();
  const empty = registry.snapshot();
  assert.throws(() => registry.restore({...empty, nextId: 0}), {kind: 'ArgumentException'});
  const property = registry.register({ownerType: 'Owner', name: 'Value', propertyType: 'int'});
  const before = registry.snapshot();
  for (const corrupt of [{...before, nextId: 1}, {...before, properties: [property, property]}, {...before, properties: [{...property}]}]) {
    assert.throws(() => registry.restore(corrupt), {kind: 'ArgumentException'});
    assert.equal(registry.resolve(property), property);
  }
});

test('A15 the default assignability service follows the supplied bounded declaring-owner ancestry', () => {
  const registry = new DependencyPropertyRegistry({baseType: type => ({Button: 'Control', Control: 'Element'})[type] ?? null});
  const width = registry.register({ownerType: 'Element', name: 'Width', propertyType: 'double'});
  const store = new PropertyStore({registry, ownerType: 'Button'});
  store.setValue(width, 25);
  assert.equal(store.getValue(width), 25);
  assert.equal(registry.applicable(width, 'Unrelated'), false);
  const cyclic = new DependencyPropertyRegistry({baseType: type => type === 'A' ? 'B' : 'A'});
  assert.equal(cyclic.isAssignable('Other', 'A'), false);
  const deep = new DependencyPropertyRegistry({baseType: type => String(Number(type) + 1)});
  assert.throws(() => deep.isAssignable('Never', '0'), {kind: 'InvalidOperationException'});
});

test('A15 nullable value properties preserve null and require the exact approved underlying type', () => {
  const typeDefinition = type => ({
    'System.DateTimeOffset': {kind: 'value', slots: ['Ticks', 'Offset']},
    'System.TimeSpan': {kind: 'value', slots: ['Ticks']},
    Mode: {kind: 'enum', values: {First: 0, Second: 1}}
  })[type];
  const registry = new DependencyPropertyRegistry({typeDefinition});
  const date = registry.register({ownerType: 'Owner', name: 'Date', propertyType: 'System.Nullable`1<System.DateTimeOffset>'});
  const number = registry.register({ownerType: 'Owner', name: 'Number', propertyType: 'System.Nullable`1<System.Int32>'});
  const mode = registry.register({ownerType: 'Owner', name: 'Mode', propertyType: 'System.Nullable`1<Mode>'});
  const events = [];
  const store = new PropertyStore({registry, ownerType: 'Owner', onChange: change => events.push(change)});
  assert.equal(store.getValue(date), null);
  assert.equal(store.readLocalValue(date), UnsetValue);
  store.setValue(date, null);
  assert.equal(store.readLocalValue(date), null);
  assert.equal(events.length, 0);
  const value = Object.freeze({valueType: 'System.DateTimeOffset', Ticks: 123n, Offset: 0});
  store.setValue(date, value);
  store.setValue(date, Object.freeze({...value}));
  assert.equal(events.length, 1);
  store.setValue(date, null);
  assert.equal(events.length, 2);
  assert.throws(() => store.setValue(date, {valueType: 'System.TimeSpan', Ticks: 123n}), {kind: 'ArgumentException'});
  assert.equal(store.getValue(date), null);
  store.setValue(number, 12);
  assert.throws(() => store.setValue(number, 12.5), {kind: 'ArgumentException'});
  store.setValue(number, null);
  store.setValue(mode, 1);
  assert.throws(() => store.setValue(mode, 2), {kind: 'ArgumentOutOfRangeException'});
  assert.throws(() => registry.register({ownerType: 'Owner', name: 'Bad', propertyType: 'System.Nullable`1<string>'}), {kind: 'ArgumentException'});
  assert.equal(defaultPropertyValue('System.Nullable`1<System.TimeSpan>', {kind: 'value'}), null);
});

test('A15 shared mutable brush fanout emits at most one set per effective consumer and never resets the scene', () => {
  const commands = [];
  const registry = new DependencyPropertyRegistry();
  const property = registry.register({ownerType: 'Owner', name: 'Background'});
  const brush = {kind: 'brush', values: {color: '#FF000000'}};
  const emitter = new EffectiveValueEmitter({
    isMutableValue: value => value.kind === 'brush', valuesOf: value => value.values,
    emit: (owner, changed) => commands.push({op: 'set', id: owner.id, property: changed.name})
  });
  const owners = Array.from({length: 100}, (_, id) => ({id}));
  for (const owner of owners) emitter.track(owner, property, brush);
  brush.values.color = '#FFFFFFFF';
  emitter.mutated(brush);
  assert.equal(commands.length, 100);
  assert.equal(new Set(commands.map(command => command.id)).size, 100);
  assert(commands.every(command => command.op === 'set'));
  for (const owner of owners.slice(0, 50)) emitter.remove(owner);
  commands.length = 0;
  emitter.mutated(brush);
  assert.equal(commands.length, 50);
  const store = new PropertyStore({registry, ownerType: 'Owner', onChange: change => emitter.track(owners[0], property, change.newValue)});
  store.setSource(property, ValueSource.StyleSetter, brush);
  store.setValue(property, null);
  commands.length = 0;
  emitter.mutated(brush);
  assert.equal(commands.length, 50);
});
