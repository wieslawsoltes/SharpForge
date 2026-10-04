import test from 'node:test';
import assert from 'node:assert/strict';
import {Style, Setter, StyleApplication, ValueSource, NameScope, themeResource, staticResource} from '@sharpforge/winui-properties';
import {propertyFixture} from './helpers/a15-resource-fixtures.js';

function application(fixture, target, options = {}) {
  return new StyleApplication({target, store: fixture.storeFor(target), registry: fixture.registry,
    resources: fixture.resources, storeFor: fixture.storeFor, ...options});
}

test('styles: BasedOn styles seal transitively and remain reusable after their base has already been applied', () => {
  const fixture = propertyFixture();
  const base = new Style('Element', {setters: [new Setter(fixture.width, 10)]});
  const derived = new Style('Button', {basedOn: base, setters: [new Setter(fixture.text, 'derived')]});
  const first = fixture.create();
  application(fixture, first).apply(base);
  const second = fixture.create();
  application(fixture, second).apply(derived);
  assert.equal(fixture.storeFor(second).getValue(fixture.width), 10);
  assert.equal(fixture.storeFor(second).getValue(fixture.text), 'derived');
  assert.equal(base.isSealed, true);
  assert.equal(derived.isSealed, true);
  assert.throws(() => { base.targetType = 'Text'; }, {code: 'SFSTYLE016'});
  assert.throws(() => { base.setters[0].value = 11; }, {code: 'SFSTYLE016'});
  assert.throws(() => derived.setters.push(new Setter(fixture.width, 2)), TypeError);
});

test('styles: local values survive default/explicit restyling and clearing reveals the previous source', () => {
  const fixture = propertyFixture();
  const target = fixture.create();
  const store = fixture.storeFor(target);
  const styles = application(fixture, target);
  styles.setDefaultStyle(new Style('Button', {setters: [new Setter(fixture.width, 5)]}));
  styles.apply(new Style('Button', {setters: [new Setter(fixture.width, 10)]}));
  store.setValue(fixture.width, 30);
  styles.apply(new Style('Button', {setters: [new Setter(fixture.width, 20)]}));
  assert.equal(store.getValue(fixture.width), 30);
  store.clearValue(fixture.width);
  assert.equal(store.getValue(fixture.width), 20);
  styles.clear();
  assert.equal(store.getValue(fixture.width), 5);
  assert.equal(store.getValueSource(fixture.width), ValueSource.DefaultStyle);
  styles.dispose();
  assert.equal(store.getValue(fixture.width), 0);
});

test('styles: implicit keys invalidate exactly their consumers and explicit null opts out', () => {
  const fixture = propertyFixture();
  const target = fixture.create();
  const styles = application(fixture, target);
  styles.setStyle(undefined);
  fixture.resources.resources.add('Button', new Style('Button', {setters: [new Setter(fixture.width, 11)]}));
  assert.equal(fixture.storeFor(target).getValue(fixture.width), 11);
  fixture.resources.resources.set('Button', new Style('Button', {setters: [new Setter(fixture.width, 12)]}));
  assert.equal(fixture.storeFor(target).getValue(fixture.width), 12);
  assert.throws(() => fixture.resources.resources.set('Button', 42), {code: 'SFSTYLE013'});
  assert.equal(fixture.storeFor(target).getValue(fixture.width), 12);
  styles.setStyle(null);
  fixture.resources.resources.set('Button', new Style('Button', {setters: [new Setter(fixture.width, 13)]}));
  assert.equal(fixture.storeFor(target).getValue(fixture.width), 0);
  styles.dispose();
  assert.equal(fixture.resources.resources.listeners.size, 0);
});

test('styles: all setters and dynamic resource candidates validate before committing values', () => {
  const fixture = propertyFixture();
  const target = fixture.create();
  const styles = application(fixture, target);
  fixture.resources.resources.set('width', 25);
  styles.apply(new Style('Button', {setters: [new Setter(fixture.width, themeResource('width'))]}));
  const invalid = new Style('Button', {setters: [new Setter(fixture.width, 40), new Setter(fixture.text, 100)]});
  assert.throws(() => styles.apply(invalid));
  assert.equal(fixture.storeFor(target).getValue(fixture.width), 25);
  assert.equal(invalid.isSealed, false);
  assert.throws(() => fixture.resources.resources.set('width', 'bad'));
  assert.equal(fixture.resources.find('width'), 25);
  fixture.resources.resources.set('width', 26);
  assert.equal(fixture.storeFor(target).getValue(fixture.width), 26);
  styles.dispose();
  assert.equal(fixture.resources.resources.listeners.size, 0);
});

test('styles: namescope targets and captured StaticResource values use the same property store', () => {
  const fixture = propertyFixture();
  const owner = fixture.create();
  const part = fixture.create('Text', 'part');
  const namescope = new NameScope();
  namescope.registerName('part', part);
  fixture.resources.resources.add('text', 'initial');
  const styles = application(fixture, owner, {namescope});
  styles.apply(new Style('Button', {setters: [new Setter(undefined, staticResource('text'), {target: 'part.Text'})]}));
  fixture.resources.resources.set('text', 'later');
  assert.equal(fixture.storeFor(part).getValue(fixture.text), 'initial');
  styles.dispose();
  assert.equal(fixture.storeFor(part).getValue(fixture.text), '');
  assert.throws(() => styles.apply(new Style('Button')), {code: 'SFSTYLE015'});
});

test('styles: BasedOn cycles and incompatible targets are bounded diagnostics', () => {
  const fixture = propertyFixture();
  const first = new Style('Button');
  const second = new Style('Button', {basedOn: first});
  first.basedOn = second;
  assert.throws(() => first.compile(fixture.registry), {code: 'SFSTYLE003'});
  assert.throws(() => new Style('Button', {basedOn: new Style('Text')}).compile(fixture.registry), {code: 'SFSTYLE004'});
});
