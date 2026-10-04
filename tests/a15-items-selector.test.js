import test from 'node:test';
import assert from 'node:assert/strict';
import {ItemContainerGenerator, Style, Setter, StyleApplication, StyleSelector, ValueSource} from '@sharpforge/winui-properties';
import {propertyFixture} from './helpers/a15-resource-fixtures.js';

test('A15 alternating container styles update across recycling while local values retain precedence', () => {
  const fixture = propertyFixture();
  const even = new Style('Button', {setters: [new Setter(fixture.width, 10)]});
  const odd = new Style('Button', {setters: [new Setter(fixture.width, 20)]});
  const selected = [];
  class AlternatingSelector extends StyleSelector {
    selectStyleCore(item, container) {
      selected.push([item, container]);
      return item % 2 ? odd : even;
    }
  }
  const generator = new ItemContainerGenerator({owner: fixture.create(), maxPool: 1, styleSelector: new AlternatingSelector(),
    adapter: {
      createContainer: () => fixture.create(),
      setDataContext: (container, item) => { container.data = item; },
      applyStyle(container, style) {
        const application = new StyleApplication({target: container, store: fixture.storeFor(container),
          registry: fixture.registry, resources: fixture.resources, storeFor: fixture.storeFor});
        application.apply(style);
        return application;
      }
    }});
  generator.setItems([0, 1, 2]);
  const first = generator.realize(0), store = fixture.storeFor(first);
  assert.equal(store.getValue(fixture.width), 10);
  store.setValue(fixture.width, 99);
  generator.recycle(0);
  assert.equal(first.data, null);
  assert.equal(store.getValue(fixture.width), 99);
  assert.equal(generator.realize(1), first);
  assert.equal(store.getValue(fixture.width), 99);
  store.clearValue(fixture.width);
  assert.equal(store.getValue(fixture.width), 20);
  assert.equal(store.getValueSource(fixture.width), ValueSource.StyleSetter);
  generator.recycle(1);
  assert.equal(generator.realize(2), first);
  assert.equal(store.getValue(fixture.width), 10);
  assert.deepEqual(selected.map(([item]) => item), [0, 1, 2]);
  generator.dispose();
  assert.equal(first.data, null);
  assert.equal(store.getValue(fixture.width), 0);
});
