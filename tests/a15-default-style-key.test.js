import test from 'node:test';
import assert from 'node:assert/strict';
import {DefaultTemplateCatalog, Style, Setter, StyleApplication, ValueSource} from '@sharpforge/winui-properties';
import {propertyFixture} from './helpers/a15-resource-fixtures.js';

function fixture() {
  const fixture = propertyFixture();
  const target = fixture.create();
  const store = fixture.storeFor(target);
  const application = new StyleApplication({target, store, registry: fixture.registry, resources: fixture.resources});
  const style = width => new Style('Button', {setters: [new Setter(fixture.width, width)]});
  return {...fixture, target, store, application, style};
}

test('A15 DefaultStyleKey tracks its key and preserves explicit and local precedence', () => {
  const {resources, width, store, application, style} = fixture();
  const fallback = style(5);
  application.setDefaultStyleResource('compact', fallback);
  assert.equal(store.getValue(width), 5);
  resources.resources.add('compact', style(10));
  assert.equal(store.getValue(width), 10);
  application.setStyle(style(20));
  store.setValue(width, 30);
  resources.resources.set('compact', style(11));
  assert.equal(store.getValue(width), 30);
  store.clearValue(width);
  assert.equal(store.getValue(width), 20);
  application.setStyle(null);
  assert.equal(store.getValue(width), 11);
  assert.equal(store.getValueSource(width), ValueSource.DefaultStyle);
  resources.resources.remove('compact');
  assert.equal(store.getValue(width), 5);
  application.setDefaultStyleResource(null);
  assert.equal(store.getValue(width), 0);
  assert.equal(resources.observers.size, 0);
  application.dispose();
  resources.dispose();
});

test('A15 invalid default-key replacements preserve the previous dictionary, selection and subscription', () => {
  const {resources, width, store, application, style} = fixture();
  const original = style(10);
  resources.resources.add('selected', original);
  resources.resources.add('invalid', new Style('Text'));
  application.setDefaultStyleResource('selected');
  const subscription = application.defaultResource.subscription;
  assert.throws(() => resources.resources.set('selected', new Style('Text')), {code: 'SFSTYLE014'});
  assert.equal(resources.find('selected'), original);
  assert.throws(() => application.setDefaultStyleResource('invalid'), {code: 'SFSTYLE014'});
  assert.equal(application.defaultResource.key, 'selected');
  assert.equal(application.defaultResource.subscription, subscription);
  assert.equal(resources.observers.size, 1);
  assert.equal(store.getValue(width), 10);
  resources.resources.set('selected', style(12));
  assert.equal(store.getValue(width), 12);
  application.dispose();
  assert.equal(resources.resources.listeners.size, 0);
  assert.equal(resources.observers.size, 0);
  assert.throws(() => application.setDefaultStyleResource('selected'), {code: 'SFSTYLE015'});
  resources.dispose();
});

test('A15 default-key rewind restores subscriptions without applying factories or replaying property changes', () => {
  const {resources, width, store, application, style} = fixture();
  resources.resources.add('first', style(10));
  resources.resources.add('second', style(20));
  application.setDefaultStyleResource('first');
  const snapshot = {resources: resources.snapshot(), store: store.snapshot(), application: application.snapshot()};
  let changes = 0;
  const off = store.subscribe(width, () => changes++);
  application.setDefaultStyleResource('second');
  assert.equal(store.getValue(width), 20);
  application.dispose({preserveValues: true});
  resources.restore(snapshot.resources);
  store.restore(snapshot.store);
  const before = changes;
  application.restore(snapshot.application);
  assert.equal(changes, before);
  assert.equal(store.getValue(width), 10);
  assert.equal(resources.observers.size, 1);
  resources.resources.set('second', style(21));
  assert.equal(store.getValue(width), 10);
  resources.resources.set('first', style(11));
  assert.equal(store.getValue(width), 11);
  off();
  application.dispose();
  assert.equal(resources.resources.listeners.size, 0);
  resources.dispose();
});

test('A15 registered recipe selection honors typed keys, custom keys, explicit null and ClearValue', () => {
  const {registry, target, store, application, resources} = fixture();
  const key = registry.register({ownerType: 'Element', name: 'DefaultStyleKey', propertyType: 'object'});
  const buttonStyle = new Style('Button'), textStyle = new Style('Text');
  const built = [];
  const context = {propertyRegistry: registry, storeFor: () => store, typeOf: value => value?.type,
    native: value => value, typeName: value => value.$type ?? value.name, id: value => value,
    baseType: value => value === 'Button' || value === 'Text' ? 'Element' : null,
    frameworkRegistry: {types: new Map()}};
  const catalog = new DefaultTemplateCatalog(context, type => {
    built.push(type);
    return type === 'Button' ? buttonStyle : type === 'Text' ? textStyle : null;
  });
  assert.equal(catalog.get(target), buttonStyle);
  store.setValue(key, {type: 'System.Type', name: 'Text'});
  assert.equal(catalog.get(target), textStyle);
  store.setValue(key, 'custom');
  assert.equal(catalog.get(target), null);
  store.setValue(key, null);
  assert.equal(catalog.get(target), null);
  store.clearValue(key);
  assert.equal(catalog.get(target), buttonStyle);
  function Button() {}
  Button.$type = 'Button';
  store.setValue(key, Button);
  assert.equal(catalog.get(target), buttonStyle);
  assert.deepEqual(built, ['Button', 'Text']);
  catalog.dispose();
  application.dispose();
  resources.dispose();
});
