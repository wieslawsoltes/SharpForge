import test from 'node:test';
import assert from 'node:assert/strict';
import {DependencyPropertyRegistry, PropertyStore, Style, Setter, StyleApplication, ValueSource} from '@sharpforge/winui-properties';

function fixture(metadata = {}) {
  const registry = new DependencyPropertyRegistry();
  const property = registry.register({ownerType: 'Button', name: 'Width', propertyType: 'double', metadata});
  const create = owner => {
    const events = [];
    const store = new PropertyStore({registry, ownerType: 'Button', owner, onChange: change => events.push(change)});
    return {store, events, application: new StyleApplication({target: owner, store, registry})};
  };
  return {registry, property, create};
}

test('A15 only an explicit legacy style profile remains mutable and exposes its latest animation base', () => {
  const {property, create} = fixture();
  const {store, application} = create({});
  const setter = new Setter(property, 40), style = new Style('Button', {legacyMutable: true, setters: [setter]});
  application.apply(style);
  store.setSource(property, ValueSource.Animation, 50);
  setter.value = 60;
  assert.equal(style.isSealed, false);
  assert.equal(setter.isSealed, false);
  assert.equal(store.getValue(property), 50);
  assert.equal(store.getBaseValue(property), 60);
  store.clearSource(property, ValueSource.Animation);
  assert.equal(store.getValue(property), 60);
  const typedSetter = new Setter(property, 70), typed = new Style('Button', {setters: [typedSetter]});
  application.apply(typed);
  assert.equal(typed.isSealed, true);
  assert.throws(() => { typedSetter.value = 80; }, {code: 'SFSTYLE016'});
  setter.value = 90;
  assert.equal(store.getValue(property), 70);
  application.dispose();
});

test('A15 legacy mutations roll back every consumer and definition when a later coercion rejects the write', () => {
  const {property, create} = fixture({coerceValueCallback: (owner, value) => {
    if (owner.reject && value === 90) throw new Error('rejected');
    return value;
  }});
  const first = create({}), second = create({reject: true});
  const setter = new Setter(property, 10), style = new Style('Button', {legacyMutable: true, setters: [setter]});
  first.application.apply(style); second.application.apply(style);
  first.events.length = 0; second.events.length = 0;
  assert.throws(() => { setter.value = 90; }, /rejected/);
  assert.equal(setter.value, 10);
  assert.equal(first.store.getValue(property), 10);
  assert.equal(second.store.getValue(property), 10);
  assert.equal(first.events.length + second.events.length, 0);
  setter.value = 30;
  assert.equal(first.store.getValue(property), 30);
  assert.equal(second.store.getValue(property), 30);
  assert.equal(first.events.length, 1);
  assert.equal(second.events.length, 1);
  first.application.dispose(); second.application.dispose();
});

test('A15 legacy BasedOn and setter replacement reindex consumers and rewind without replay', () => {
  const {property, create} = fixture();
  const {store, application, events} = create({});
  const oldSetter = new Setter(property, 10), nextSetter = new Setter(property, 20);
  const base = new Style('Button', {legacyMutable: true, setters: [oldSetter]});
  const derived = new Style('Button', {legacyMutable: true, basedOn: base});
  application.apply(derived);
  const savedStore = store.snapshot(), savedApplication = application.snapshot();
  base.setters = [nextSetter];
  oldSetter.value = 99;
  assert.equal(store.getValue(property), 20);
  const count = events.length;
  store.restore(savedStore); application.restore(savedApplication);
  assert.equal(events.length, count);
  assert.equal(oldSetter.value, 10);
  oldSetter.value = 40;
  assert.equal(store.getValue(property), 40);
  nextSetter.value = 88;
  assert.equal(store.getValue(property), 40);
  application.dispose();
  oldSetter.value = 50;
  assert.equal(store.getValue(property), 0);
});

test('A15 native typed style application seals a shared legacy BasedOn definition transitively', () => {
  const {property, create} = fixture();
  const {application} = create({});
  const setter = new Setter(property, 10), base = new Style('Button', {legacyMutable: true, setters: [setter]});
  const typed = new Style('Button', {basedOn: base});
  application.apply(typed);
  assert.equal(base.isSealed, true);
  assert.throws(() => { setter.value = 20; }, {code: 'SFSTYLE016'});
  application.dispose();
});
