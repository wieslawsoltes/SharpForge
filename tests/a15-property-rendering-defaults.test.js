import test from 'node:test';
import assert from 'node:assert/strict';
import {frameworkType} from '@sharpforge/framework';
import {ValueSource, UnsetValue} from '@sharpforge/winui-properties';
import {DrawingModel, DrawingCollection, materializeRenderingModelDefaults, registerRenderingAdapters} from '@sharpforge/rendering';
import {JavaScriptUIContext} from '../packages/winui/src/javascript/context.js';
import {propertyJavaScriptHost} from './helpers/a15-property-js-host.js';

test('A15 JavaScript context reads native rendering collection defaults by their existing typed identity', () => {
  const {context} = propertyJavaScriptHost();
  context.baseType = type => frameworkType(type)?.base;
  context.frameworkRegistry = {frameworkType};
  registerRenderingAdapters(context.registry);
  for (const [name, property, collectionType] of [
    ['LinearGradientBrush', 'GradientStops', 'GradientStopCollection'],
    ['TransformGroup', 'Children', 'TransformCollection']
  ]) {
    const type = 'Microsoft.UI.Xaml.Media.' + name;
    const vectorType = 'Microsoft.UI.Xaml.Media.' + collectionType;
    const collection = new DrawingCollection(vectorType, [new DrawingModel('Microsoft.UI.Xaml.Media.'
      + (name === 'LinearGradientBrush' ? 'GradientStop' : 'TranslateTransform'))]);
    const owner = context.wrapModel(new DrawingModel(type, {[property]: collection}), type);
    const token = context.propertyRegistry.register({ownerType: type, name: property, propertyType: vectorType});
    const store = context.storeFor(owner);
    materializeRenderingModelDefaults(context, owner, (name, value) => store.setSource(token, ValueSource.Default, value));
    const expected = context.invoke({owner: type, kind: 'get', name: 'get_' + property, result: vectorType}, owner, []).value;
    assert.equal(context.unwrapModel(expected), collection);
    assert.equal(JavaScriptUIContext.prototype.read.call(context, owner, property), expected);
    assert.equal(JavaScriptUIContext.prototype.read.call(context, expected, 'Count'), 1);
    if (store.getValue(token) !== null) assert.equal(store.getValue(token), expected);
    assert.equal(owner.$collections[property], undefined);
    assert.equal(store.readLocalValue(token), UnsetValue);
  }
});
