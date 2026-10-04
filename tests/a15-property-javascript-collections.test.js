import test from 'node:test';
import assert from 'node:assert/strict';
import {findContracts} from '@sharpforge/framework';
import {DrawingCollection, registerRenderingAdapters} from '@sharpforge/rendering';
import {createUIObjectCollection, invokeCollectionOperation, applyFacadeCollectionInput} from '../packages/winui/src/javascript/collections.js';
import {sceneTransaction} from '../packages/winui/src/javascript/scene-journal.js';
import {propertyJavaScriptHost} from './helpers/a15-property-js-host.js';

test('A15 JavaScript collections retain typed identity, visual order and exact incremental changes', () => {
  const {context, commands} = propertyJavaScriptHost();
  const panel = context.allocate('Microsoft.UI.Xaml.Controls.StackPanel');
  const collection = createUIObjectCollection(context, panel, 'Children');
  const first = context.allocate('Microsoft.UI.Xaml.Controls.Button'), second = context.allocate('Microsoft.UI.Xaml.Controls.Button');
  invokeCollectionOperation(context, collection, 'Add', [first]);
  invokeCollectionOperation(context, collection, 'Insert', [0, second]);
  assert.equal(context.typeOf(collection), 'Microsoft.UI.Xaml.Controls.UIElementCollection');
  assert.deepEqual(context.items(collection), [second, first]);
  assert.deepEqual(context.objectTree.getVisualChildren(context.id(panel)), [context.id(second), context.id(first)]);
  assert.equal(commands.filter(value => value.op === 'collectionChange').length, 2);
  assert.equal(commands.some(value => value.op === 'reset'), false);
  const iterator = collection[Symbol.iterator]();
  assert.equal(iterator.next().value, second);
  invokeCollectionOperation(context, collection, 'Move', [0, 1]);
  assert.throws(() => iterator.next(), {kind: 'InvalidOperationException'});
  assert.deepEqual(context.objectTree.getVisualChildren(context.id(panel)), [context.id(first), context.id(second)]);
  assert.throws(() => invokeCollectionOperation(context, collection, 'Add', [first]), /Duplicate/);
});

test('A15 failed JavaScript collection callbacks roll back values, source versions, parents and staged commands', () => {
  const {context, commands} = propertyJavaScriptHost();
  const panel = context.allocate('Microsoft.UI.Xaml.Controls.StackPanel');
  const collection = createUIObjectCollection(context, panel, 'Children');
  const child = context.allocate('Microsoft.UI.Xaml.Controls.Button');
  const model = context.model(collection), initialVersion = model.version;
  model.subscribe(() => { throw new Error('listener failed'); });
  const count = commands.length;
  assert.throws(() => invokeCollectionOperation(context, collection, 'Add', [child]), /listener failed/);
  assert.deepEqual(context.items(collection), []);
  assert.equal(model.version, initialVersion);
  assert.equal(context.parents.has(context.id(child)), false);
  assert.deepEqual(context.objectTree.getVisualChildren(context.id(panel)), []);
  assert.equal(commands.length, count);
});

test('A15 authoritative item reorder accepts only a complete identity-preserving permutation', () => {
  const {context, commands} = propertyJavaScriptHost();
  const owner = context.allocate('Microsoft.UI.Xaml.Controls.ListView');
  const collection = createUIObjectCollection(context, owner, 'Items');
  owner.$collections.Items = collection;
  invokeCollectionOperation(context, collection, 'Add', ['first']);
  invokeCollectionOperation(context, collection, 'Add', ['second']);
  const changed = [];
  context.itemsCollectionChanged = (value, items, delta) => changed.push({value, items: [...items], delta});
  context.itemScene = () => ({count: 2});
  const count = commands.length;
  applyFacadeCollectionInput(context, owner, 'Items', ['second', 'first']);
  assert.deepEqual(context.items(collection), ['second', 'first']);
  assert.equal(changed.length, 1);
  assert.equal(commands.length, count);
  for (const values of [['first'], ['first', 'first'], ['first', 'foreign']]) {
    assert.throws(() => applyFacadeCollectionInput(context, owner, 'Items', values), TypeError);
  }
  context.assertItemsWritable = () => { throw new Error('ItemsSource owns the collection'); };
  assert.throws(() => invokeCollectionOperation(context, collection, 'Clear', []), /ItemsSource/);
  assert.deepEqual(context.items(collection), ['second', 'first']);
});

test('A15 native drawing collections use their registered model methods and journal snapshots', () => {
  const {context} = propertyJavaScriptHost();
  registerRenderingAdapters(context.registry);
  const owner = 'Microsoft.UI.Xaml.Media.DoubleCollection';
  const receiver = context.wrapModel(new DrawingCollection(owner), owner);
  invokeCollectionOperation(context, receiver, 'Add', [2]);
  assert.deepEqual(context.model(receiver).items, [2]);
  assert.equal(invokeCollectionOperation(context, receiver, 'get_Item', [0]), 2);
  assert.throws(() => sceneTransaction(context, () => {
    invokeCollectionOperation(context, receiver, 'Add', [3]);
    throw new Error('abort drawing update');
  }), /abort drawing update/);
  assert.deepEqual(context.model(receiver).items, [2]);
  assert(findContracts(owner, 'Add').length);
});

test('A15 template children keep their templated logical parent and physical collection parent', () => {
  const {context} = propertyJavaScriptHost();
  const owner = context.allocate('Microsoft.UI.Xaml.Controls.Control'), panel = context.allocate('Microsoft.UI.Xaml.Controls.StackPanel');
  const part = context.allocate('Microsoft.UI.Xaml.Controls.Button');
  part.$values.$templateOwner = owner;
  const collection = createUIObjectCollection(context, panel, 'Children');
  invokeCollectionOperation(context, collection, 'Add', [part]);
  assert.equal(context.objectTree.getLogicalParent(context.id(part)), context.id(owner));
  assert.equal(context.objectTree.getVisualParent(context.id(part)), context.id(panel));
  invokeCollectionOperation(context, collection, 'Remove', [part]);
  assert.equal(context.objectTree.getLogicalParent(context.id(part)), null);
  assert.equal(context.objectTree.getVisualParent(context.id(part)), null);
});
