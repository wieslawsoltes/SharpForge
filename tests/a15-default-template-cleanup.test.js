import test from 'node:test';
import assert from 'node:assert/strict';
import {DefaultTemplateCatalog} from '../packages/winui-properties/src/object-model/default-template-catalog.js';
import {propertyFixture} from './helpers/a15-resource-fixtures.js';

test('default-template failure disconnects subscriptions before disposing target stores', () => {
  const fixture = propertyFixture();
  const owner = fixture.create('Button');
  const created = [];
  const context = {
    make(type) {
      const target = fixture.create(type);
      created.push(target);
      return target;
    },
    typeOf: target => target.type,
    propertyRegistry: fixture.registry,
    properties: {toNative: value => value},
    storeFor: fixture.storeFor,
    templateHostAdapter: {
      ...fixture.adapter,
      dispose(target) {
        fixture.storeFor(target).dispose();
        target.disposed = true;
      }
    }
  };
  const catalog = new DefaultTemplateCatalog(context, () => null);
  const template = catalog.template('Button', {
    type: 'Text', properties: {}, children: [], child: null,
    bindings: [{target: 'Text', source: 'Text'}],
    resources: [{property: 'Width', key: 'invalidWidth'}]
  }, {family: 'test'});
  fixture.resources.resources.add('invalidWidth', 'not a width');
  fixture.storeFor(owner).setValue(fixture.text, 'before creation');
  assert.throws(() => template.instantiate({owner, resources: fixture.resources, adapter: context.templateHostAdapter}), error => {
    assert.equal(error instanceof AggregateError, false, 'cleanup must preserve the original validation fault');
    assert.equal(error.name, 'ArgumentException');
    return true;
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].disposed, true);
  assert.equal(fixture.storeFor(owner).listeners.size, 0);
  assert.equal(fixture.resources.observers.size, 0);
  assert.doesNotThrow(() => fixture.storeFor(owner).setValue(fixture.text, 'after failed creation'));
  fixture.resources.dispose();
  fixture.storeFor(owner).dispose();
});
