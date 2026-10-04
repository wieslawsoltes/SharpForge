import test from 'node:test';
import assert from 'node:assert/strict';
import {VisualState, VisualStateGroup, VisualTransition, VisualStateManager, VisualStateAnimationAdapter,
  AdaptiveTrigger, StateTrigger, Setter, ValueSource, themeResource} from '@sharpforge/winui-properties';
import {propertyFixture} from './helpers/a15-resource-fixtures.js';

function fixture(groups, options = {}) {
  const props = propertyFixture(), target = props.create();
  return {...props, target, manager: new VisualStateManager({target, store: props.storeFor(target), registry: props.registry,
    resources: props.resources, storeFor: props.storeFor, groups: groups(props), ...options})};
}

test('visual states: setters restore lower layers, preserve local values and detach ThemeResource observers', () => {
  const result = fixture(props => [new VisualStateGroup('Common', {states: [
    new VisualState('Normal'), new VisualState('PointerOver', {setters: [new Setter(props.width, themeResource('width'))]})]})]);
  const {manager, target, width, storeFor, resources} = result, store = storeFor(target);
  resources.resources.add('width', 20);
  store.setSource(width, ValueSource.StyleSetter, 10);
  assert.equal(manager.goToState('missing'), false);
  manager.goToState('PointerOver', false);
  assert.equal(store.getValue(width), 20);
  resources.resources.set('width', 24);
  assert.equal(store.getValue(width), 24);
  store.setValue(width, 40);
  manager.goToState('Normal', false);
  assert.equal(store.getValue(width), 40);
  store.clearValue(width);
  assert.equal(store.getValue(width), 10);
  assert.equal(resources.resources.listeners.size, 0);
  manager.dispose(); resources.dispose();
});

test('visual states: adaptive specificity and custom trigger priority share deterministic state selection', () => {
  const narrow = new AdaptiveTrigger(), wide = new AdaptiveTrigger({minWindowWidth: 600});
  const tall = new AdaptiveTrigger({minWindowWidth: 600, minWindowHeight: 400}), custom = new StateTrigger();
  const result = fixture(props => [new VisualStateGroup('Size', {states: [
    new VisualState('Narrow', {triggers: [narrow], setters: [new Setter(props.width, 1)]}),
    new VisualState('Wide', {triggers: [wide], setters: [new Setter(props.width, 2)]}),
    new VisualState('Tall', {triggers: [tall], setters: [new Setter(props.width, 3)]}),
    new VisualState('Custom', {triggers: [custom], setters: [new Setter(props.width, 4)]})]})]);
  const value = () => result.storeFor(result.target).getValue(result.width);
  result.manager.updateSize(800, 500); assert.equal(value(), 3);
  custom.setActive(true); assert.equal(value(), 4);
  custom.setActive(false); assert.equal(value(), 3);
  result.manager.updateSize(800, 300); assert.equal(value(), 2);
  result.manager.updateSize(400, 300); assert.equal(value(), 1);
  result.manager.dispose();
  assert.equal(custom.listeners.size, 0); assert.equal(wide.listeners.size, 0);
  result.resources.dispose();
});

test('visual states: transition cancellation ignores stale completion even when returning to the same state', () => {
  const pending = [], changed = [];
  const animations = {
    transition(transition, previous, next, context, complete) {
      const entry = {complete, canceled: false, from: next[0]?.from}; pending.push(entry);
      return {cancel: () => { entry.canceled = true; }};
    }, begin() { return {cancel() {}}; }
  };
  const result = fixture(props => [new VisualStateGroup('Common', {
    states: [new VisualState('Normal', {setters: [new Setter(props.width, 10)]}),
      new VisualState('Pressed', {setters: [new Setter(props.width, 30)]})],
    transitions: [new VisualTransition({generatedDuration: 100})]
  })], {animations});
  const group = result.manager.groups[0];
  group.onCurrentStateChanged(event => changed.push(event.newState.name));
  result.manager.goToState('Normal');
  result.manager.goToState('Pressed');
  result.manager.goToState('Normal');
  assert.equal(pending[0].canceled, true); assert.equal(pending[1].canceled, true);
  pending[0].complete(); pending[1].complete();
  assert.deepEqual(changed, []);
  pending[2].complete();
  assert.deepEqual(changed, ['Normal']);
  assert.equal(pending[1].from, 10);
  result.manager.dispose(); result.resources.dispose();
});

test('visual states: callback reentrancy queues transitions and cyclic callbacks reach a deterministic budget', () => {
  const result = fixture(() => [new VisualStateGroup('Common', {states: [new VisualState('A'), new VisualState('B')]})]);
  const {manager} = result, group = manager.groups[0], events = [];
  group.onCurrentStateChanging(event => {
    events.push('changing ' + event.newState.name);
    if (event.newState.name === 'A') manager.goToState('B', false);
  });
  group.onCurrentStateChanged(event => events.push('changed ' + event.newState.name));
  manager.goToState('A', false);
  assert.deepEqual(events, ['changing A', 'changed A', 'changing B', 'changed B']);
  group.changing.clear(); group.changed.clear();
  group.onCurrentStateChanged(event => manager.goToState(event.newState.name === 'A' ? 'B' : 'A', false));
  assert.throws(() => manager.goToState('A', false), {code: 'SFSTATE006'});
  assert.equal(manager.processingChanges, false);
  group.changed.clear(); manager.dispose(); result.resources.dispose();
});

test('visual states: definition preflight rejects duplicate global names before attaching any listeners', () => {
  const trigger = new StateTrigger();
  const first = new VisualStateGroup('One', {states: [new VisualState('Repeated', {triggers: [trigger]})]});
  const second = new VisualStateGroup('Two', {states: [new VisualState('Repeated')]});
  assert.throws(() => fixture(() => [first, second]), {code: 'SFSTATE001'});
  assert.equal(first.definitionListeners.size, 0);
  assert.equal(trigger.listeners.size, 0);
  function* many() { while (true) yield new StateTrigger(); }
  assert.throws(() => new VisualState('Budget', {triggers: many()}), {code: 'SFSTATE005'});
});

test('visual state animation bridge stops generated clocks on completion and has restorable pending callbacks', () => {
  const started = [], stopped = [], completed = [];
  const adapter = new VisualStateAnimationAdapter({clock: {begin: (...args) => started.push(args), stop: id => stopped.push(id)},
    idFor: target => target.id, storyboardDefinition: value => value});
  const transition = new VisualTransition({generatedDuration: 100});
  const entry = {target: {id: 'part'}, property: {name: 'Width'}, value: 10, from: 5};
  adapter.transition(transition, [], [entry], {}, () => completed.push('done'));
  const saved = adapter.snapshot(), id = started[0][0];
  assert.equal(started[0][1].children[0].from, 5);
  adapter.completed(id); assert.deepEqual(completed, ['done']);
  adapter.restore(saved); adapter.completed(id);
  assert.deepEqual(completed, ['done', 'done']);
  assert.deepEqual(stopped, [id, id]);
  adapter.dispose();
});
