import test from 'node:test';
import assert from 'node:assert/strict';
import {CollectionViewSource, GroupStyle, Style, Setter, DataTemplate, ItemsPanelTemplate} from '@sharpforge/winui-properties';
import {GroupHeaderCache} from '../packages/winui-properties/src/items/group-headers.js';
import {ItemsPanelHost} from '../packages/winui-properties/src/items/panel-template.js';
import {presentationFixture} from './helpers/a15-presentation-fixture.js';

test('group headers: managed containers receive templates and two independent style layers', () => {
  const {context, controls, width} = presentationFixture();
  const owner = context.make(controls + 'ListView');
  const groups = [{Name: 'A', items: ['a', 'b']}, {Name: 'empty', items: []}, {Name: 'B', items: ['c']}];
  const source = new CollectionViewSource({source: groups, isSourceGrouped: true});
  const template = new DataTemplate(() => context.make(controls + 'TextBlock'));
  const style = new GroupStyle({headerTemplate: template,
    containerStyle: new Style(controls + 'GroupItem', {setters: [new Setter(width, 80)]}),
    headerContainerStyle: new Style(controls + 'ContentPresenter', {setters: [new Setter(width, 50)]})});
  owner.values.GroupStyle = [style];
  const cache = new GroupHeaderCache(context, owner);
  const visible = cache.update(source.view, [1, 2]);
  assert.equal(visible.length, 3);
  const entry = cache.entries.get(0);
  assert.equal(entry.header.parent, owner);
  assert.equal(entry.presenter.values.Content, groups[0]);
  assert.equal(entry.presenter.values.ContentTemplate, template);
  assert.equal(context.storeFor(entry.header).getValue(width), 80);
  assert.equal(context.storeFor(entry.presenter).getValue(width), 50);
  assert.equal(cache.indexFor(groups[2]), 2);
  assert.equal(cache.indexFor({Name: 'B'}), -1);
  const remove = cache.entries.get(1).header;
  style.hidesIfEmpty = true;
  cache.update(source.view, [2]);
  assert.equal(remove.disposed, true);
  assert.deepEqual(cache.records().map(record => record.group), [groups[2]]);
  cache.dispose();
  assert.equal(style.listeners.size, 0);
});

test('group headers: definitions refresh reactively and rewind never constructs or writes a visual', () => {
  const {context, controls} = presentationFixture();
  const owner = context.make(controls + 'ListView'), style = new GroupStyle();
  owner.values.GroupStyle = [style];
  const source = new CollectionViewSource({source: [{items: [0]}, {items: [1]}], isSourceGrouped: true});
  const cache = new GroupHeaderCache(context, owner);
  let changed = 0;
  context.itemsChanged = () => { changed++; };
  cache.update(source.view, [0]);
  const snapshot = cache.snapshot(), original = cache.records()[0].header;
  style.notifyDefinitionChanged();
  assert.equal(changed, 1);
  cache.update(source.view, [1]);
  const before = {nodes: context.nodes.length, writes: context.writes.length};
  cache.restore(snapshot);
  assert.equal(cache.records()[0].header, original);
  assert.equal(context.nodes.length, before.nodes);
  assert.equal(context.writes.length, before.writes);
  cache.dispose({preserveValues: true});
  assert.equal(context.writes.length, before.writes);
});

test('group headers: empty groups can render, bounds reject excessive visible headers and infinite groups', () => {
  const {context, controls} = presentationFixture();
  const owner = context.make(controls + 'ListView');
  const source = new CollectionViewSource({source: [{items: []}, {items: []}], isSourceGrouped: true});
  const cache = new GroupHeaderCache(context, owner, {maxHeaders: 1});
  assert.throws(() => cache.update(source.view, []), {code: 'SFITEM015'});
  const empty = new GroupHeaderCache(context, owner);
  assert.equal(empty.update(source.view, []).length, 2);
  const forever = { *[Symbol.iterator]() { while (true) yield {items: []}; } };
  assert.throws(() => new CollectionViewSource({source: forever, isSourceGrouped: true, maxGroups: 2}), {code: 'SFITEM002'});
});

test('ItemsPanelTemplate: a fresh managed Panel drives each owner and old instances dispose on replacement', () => {
  const {context, controls} = presentationFixture();
  const first = context.make(controls + 'ListView'), second = context.make(controls + 'ListView');
  const template = new ItemsPanelTemplate(() => context.make(controls + 'StackPanel'));
  const a = new ItemsPanelHost(context, first), b = new ItemsPanelHost(context, second);
  const root = a.update(template);
  assert.notEqual(b.update(template), root);
  assert.equal(root.parent, first);
  assert.equal(root.values.$templateOwner, first);
  assert.equal(a.update(template), root);
  const snapshot = a.snapshot();
  a.update(new ItemsPanelTemplate(() => context.make(controls + 'Grid')));
  assert.equal(root.disposed, true);
  const count = context.nodes.length;
  a.restore(snapshot);
  assert.equal(a.instance.root, root);
  assert.equal(context.nodes.length, count);
  assert.throws(() => b.update(new ItemsPanelTemplate(() => context.make(controls + 'TextBlock'))), {code: 'SFITEM016'});
  a.dispose({preserveValues: true});
  b.dispose();
});
