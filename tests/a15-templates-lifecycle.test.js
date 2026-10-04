import test from 'node:test';
import assert from 'node:assert/strict';
import {ControlTemplate, DataTemplate, DataTemplateSelector, TemplateHost, ContentPresenterController, NameScope,
  ValueSource, ResourceScope} from '@sharpforge/winui-properties';
import {propertyFixture} from './helpers/a15-resource-fixtures.js';

function host(fixture, owner, options = {}) {
  return new TemplateHost({owner, registry: fixture.registry, adapter: fixture.adapter, resources: fixture.resources, ...options});
}

test('templates: explicit initialization with an empty tree survives snapshot and rewind without building parts', () => {
  const fixture = propertyFixture(), owner = fixture.create(), runtime = host(fixture, owner);
  const uninitialized = runtime.snapshot();
  assert.equal(runtime.initialized, false);
  assert.equal(runtime.apply(null), false);
  assert.equal(runtime.initialized, true);
  const initialized = runtime.snapshot();
  runtime.restore(uninitialized);
  assert.equal(runtime.initialized, false);
  runtime.restore(initialized);
  assert.equal(runtime.initialized, true);
  assert.equal(owner.templateRoot, undefined);
  runtime.dispose(); fixture.resources.dispose();
});

test('templates: each application owns fresh parts, a private namescope and removable TemplateBinding subscriptions', () => {
  const fixture = propertyFixture(), first = fixture.create(), second = fixture.create();
  fixture.storeFor(first).setValue(fixture.width, 12);
  fixture.storeFor(second).setValue(fixture.width, 24);
  const template = new ControlTemplate(context => {
    const part = fixture.create('Text', 'part');
    context.bind(part, fixture.width, fixture.width);
    return part;
  }, {targetType: 'Button'});
  const events = [];
  const a = host(fixture, first, {onApplyTemplate: (owner, instance) => events.push(instance.getTemplateChild('part'))});
  const b = host(fixture, second);
  assert.equal(a.apply(template), true);
  assert.equal(b.apply(template), true);
  const partA = a.getTemplateChild('part'), partB = b.getTemplateChild('part');
  assert.notEqual(partA, partB);
  assert.equal(partA.templatedParent, first);
  assert.equal(a.namescope.findName('part'), partA);
  assert.equal(fixture.storeFor(partA).getValue(fixture.width), 12);
  assert.equal(fixture.storeFor(partB).getValue(fixture.width), 24);
  assert.equal(a.apply(template), false);
  assert.deepEqual(events, [partA]);
  fixture.storeFor(first).setValue(fixture.width, 31);
  assert.equal(fixture.storeFor(partA).getValue(fixture.width), 31);
  a.apply(null);
  assert.equal(partA.disposed, true);
  assert.equal(partA.templatedParent, null);
  assert.equal(a.getTemplateChild('part'), null);
  fixture.storeFor(first).setValue(fixture.width, 60);
  assert.equal(fixture.storeFor(partA).getValueSource(fixture.width), ValueSource.Default);
  assert.equal(fixture.storeFor(partB).getValue(fixture.width), 24);
  a.dispose(); b.dispose(); fixture.resources.dispose();
});

test('templates: restoring a saved instance reconnects subscriptions without factories or OnApplyTemplate callbacks', () => {
  const fixture = propertyFixture(), owner = fixture.create();
  let factories = 0, callbacks = 0;
  const create = () => new ControlTemplate(context => {
    factories++;
    const part = fixture.create('Text', 'part');
    context.bind(part, fixture.width, fixture.width);
    return part;
  });
  const runtime = host(fixture, owner, {onApplyTemplate: () => callbacks++});
  fixture.storeFor(owner).setValue(fixture.width, 8);
  runtime.apply(create());
  const oldPart = runtime.getTemplateChild('part');
  const saved = runtime.snapshot(), savedStore = fixture.storeFor(oldPart).snapshot();
  runtime.apply(create());
  const nextPart = runtime.getTemplateChild('part');
  const callsBeforeRestore = {factories, callbacks};
  // The VM restores heap fields and property stores before restoring the authoritative template model.
  owner.templateRoot = oldPart;
  fixture.storeFor(oldPart).restore(savedStore);
  runtime.restore(saved);
  assert.deepEqual({factories, callbacks}, callsBeforeRestore);
  assert.equal(runtime.getTemplateChild('part'), oldPart);
  fixture.storeFor(owner).setValue(fixture.width, 19);
  assert.equal(fixture.storeFor(oldPart).getValue(fixture.width), 19);
  assert.equal(fixture.storeFor(nextPart).getValue(fixture.width), 8, 'future subscriptions were detached during restore');
  runtime.dispose(); fixture.resources.dispose();
});

test('templates: invalid factories, duplicate names, tree budgets and cancellation fail with complete cleanup', () => {
  const fixture = propertyFixture(), owner = fixture.create();
  const reused = fixture.create('Text', 'part');
  const definition = new ControlTemplate(() => reused);
  const live = definition.instantiate({owner, adapter: fixture.adapter});
  assert.throws(() => definition.instantiate({owner, adapter: fixture.adapter}), {code: 'SFTPL007'});
  assert.equal(reused.disposed, false, 'a failed reuse must not dispose another live instance');
  live.dispose();
  const nodes = [];
  const duplicate = new ControlTemplate(() => {
    const root = fixture.create('Text', 'same'), child = fixture.create('Text', 'same');
    nodes.push(root, child); root.children.push(child); return root;
  });
  assert.throws(() => duplicate.instantiate({owner, adapter: fixture.adapter}), {code: 'SFTPL003'});
  assert.ok(nodes.every(node => node.disposed));
  const limited = new ControlTemplate(() => {
    const root = fixture.create(); root.children.push(fixture.create()); return root;
  }, {maxNodes: 1});
  assert.throws(() => limited.instantiate({owner, adapter: fixture.adapter}), {code: 'SFTPL008'});
  const controller = new AbortController(); controller.abort();
  let called = false;
  assert.throws(() => new ControlTemplate(() => { called = true; return fixture.create(); })
    .instantiate({signal: controller.signal}), {name: 'AbortError'});
  assert.equal(called, false);
  fixture.resources.dispose();
});

test('namescopes: deferred names stay reserved across unload, and restore emits no name callbacks', () => {
  const scope = new NameScope();
  let count = 0, notifications = 0;
  scope.subscribe('lazy', () => notifications++);
  scope.registerDeferred('lazy', () => {
    const result = {count: ++count}; scope.registerName('lazy', result); return result;
  });
  const saved = scope.snapshot();
  assert.equal(count, 0);
  assert.equal(scope.peekName('lazy'), null);
  assert.equal(scope.findName('lazy').count, 1);
  scope.unregisterName('lazy');
  assert.equal(scope.findName('lazy').count, 2);
  scope.dispose({preserveValues: true});
  const before = notifications;
  scope.restore(saved);
  assert.equal(notifications, before);
  assert.equal(scope.findName('lazy').count, 3);
  assert.throws(() => scope.registerDeferred('lazy', () => null), {code: 'SFTPL003'});
  scope.registerDeferred('cycle', () => scope.findName('cycle'));
  assert.throws(() => scope.findName('cycle'), {code: 'SFTPL019'});
  scope.dispose();
});

test('content: primitive, UIElement and DataTemplate presentation preserve identity and dispose only owned visuals', () => {
  const fixture = propertyFixture(), presenter = fixture.create(), other = fixture.create();
  const adapter = {...fixture.adapter, isVisual: value => fixture.stores.has(value), parent: value => value.parent,
    createText: text => Object.assign(fixture.create('Text'), {formatted: text}),
    attachRoot: (owner, next, previous) => {
      if (previous) previous.parent = null;
      if (next) next.parent = owner;
      owner.templateRoot = next;
    }, detach: value => { value.parent = null; }};
  const content = new ContentPresenterController({presenter, owner: presenter, adapter});
  const implicit = content.present(42);
  assert.equal(implicit.formatted, '42');
  assert.equal(content.present(42), implicit);
  const visual = fixture.create('Text');
  assert.equal(content.present(visual), visual);
  assert.equal(implicit.disposed, true);
  const foreign = Object.assign(fixture.create('Text'), {parent: other});
  assert.throws(() => content.present(foreign), {code: 'SFTPL014'});
  assert.equal(presenter.templateRoot, visual);
  let selected = 0;
  const template = new DataTemplate(context => Object.assign(fixture.create('Text', 'data'), {model: context.data}));
  class Selector extends DataTemplateSelector { selectTemplateCore() { selected++; return template; } }
  const data = {label: 'one'};
  const first = content.present(data, {template, selector: new Selector()});
  assert.equal(selected, 0, 'an explicit ContentTemplate wins before invoking the selector');
  assert.equal(first.model, data);
  assert.equal(visual.disposed, false, 'user content is detached but not destroyed');
  content.present({label: 'two'}, {selector: new Selector()});
  assert.equal(selected, 1);
  assert.equal(first.disposed, true);
  content.present(null);
  assert.equal(presenter.templateRoot, null);
  content.dispose(); fixture.resources.dispose();
});

test('resources: deep scope disposal is iterative and removes every theme subscription', () => {
  const root = new ResourceScope();
  let last = root;
  for (let index = 0; index < 3000; index++) last = new ResourceScope({parent: last});
  root.dispose();
  assert.equal(root.children.size, 0);
  assert.equal(last.disposed, true);
  assert.equal(last.parent, null);
});
