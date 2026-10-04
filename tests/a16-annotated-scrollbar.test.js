import test from 'node:test';
import assert from 'node:assert/strict';
import { AnnotatedScrollController, arrangeAnnotatedLabels, annotatedLabels, findScrollPresenter,
  computeWorldLayout } from '../packages/winui-controls/src/layout/index.js';
import { getScrollModel } from '../packages/winui-controls/src/layout/scroll-host.js';
import { element, layoutFixture } from './helpers/a16-layout.js';

test('annotated labels project offsets, preserve the first label and remove overlapping upper labels', () => {
  const labels = [0, 50, 55, 100].map(ScrollOffset => ({ Content: String(ScrollOffset), ScrollOffset }));
  const result = arrangeAnnotatedLabels(labels, { maximum: 100, height: 100, heights: [20, 20, 20, 20] });
  assert.deepEqual(result.map(value => value.index), [0, 2, 3]);
  assert.equal(result.at(-1).y, 80);
  assert.throws(() => arrangeAnnotatedLabels(new Array(2049).fill(labels[0]), { height: 100 }), /collection limit/);
  assert.throws(() => arrangeAnnotatedLabels([{ ScrollOffset: NaN }], { height: 100 }), /label offset/);
  const records = new Map([['label', { properties: { Content: 'A', ScrollOffset: 20 } }]]);
  assert.deepEqual(annotatedLabels({ properties: {}, collections: { Labels: [{ $ref: 'label' }] } }, id => records.get(id)),
    [{ Content: 'A', ScrollOffset: 20 }]);
});

test('annotated controller respects cancellation, range bounds, mouse state and synchronous completion', async () => {
  const requests = [], events = [];
  let cancel = true;
  const model = new AnnotatedScrollController({ requestEvent: async (event, args) => ({ ...args, Cancel: cancel }),
    onEvent: event => events.push(event), scrollTo(offset, options) {
      requests.push({ offset, options });
      model.notifyRequestedScrollCompleted(7);
      return 7;
    } });
  model.setValues(0, 100, 40, 20);
  model.setMouseScrolling(true);
  assert.equal(await model.scroll(90, 1), -1);
  assert.equal(model.offset, 40);
  assert.deepEqual(requests, []);
  cancel = false;
  assert.equal(await model.scroll(120, 1), 7);
  assert.equal(model.offset, 100);
  assert.deepEqual(requests, [{ offset: 100, options: { AnimationMode: 0, SnapPointsMode: 1 } }]);
  assert.equal(model.pending.size, 0);
  assert(events.includes('CanScrollChanged'));
  assert(events.includes('IsScrollingWithMouseChanged'));
  model.setIsScrollable(false);
  assert.equal(await model.scroll(0), -1);
  assert.throws(() => model.setValues(2, 1, 0, 0), /Invalid annotated scrollbar range/);
  model.dispose();
  await assert.rejects(model.scroll(0), /disposed/);
});

test('annotated asynchronous requests are superseded and disposed without moving the viewport', async () => {
  const pending = [];
  const model = new AnnotatedScrollController({ requestEvent: (event, args, { signal }) => new Promise(resolve => pending.push({ args, signal, resolve })) });
  model.setValues(0, 100, 0, 20);
  const first = model.scroll(10), second = model.scroll(20);
  assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve(pending[0].args);
  assert.equal(await first, -1);
  model.dispose();
  assert.equal(pending[1].signal.aborted, true);
  pending[1].resolve(pending[1].args);
  assert.equal(await second, -1);
  assert.equal(model.offset, 0);
});

test('a real ScrollPresenter template owns transforms, model identity and outer ScrollView events', () => {
  const owner = element('root', { Content: { $ref: 'body' } }, 'ScrollView');
  owner.templateRoot = 'presenter';
  const presenter = element('presenter', { Name: 'PART_ScrollPresenter', Content: { $ref: 'body' }, VerticalOffset: 50 }, 'ScrollPresenter');
  presenter.templateOwner = 'root';
  const fixture = layoutFixture([owner, presenter, element('body', { Height: 500 })], { width: 200, height: 100 });
  fixture.update();
  assert.equal(findScrollPresenter(owner, id => fixture.nodes.get(id)), 'presenter');
  const world = computeWorldLayout(fixture.engine);
  assert.equal(world.get('body').bounds.y, -50);
  assert.equal(world.get('presenter').bounds.y, 0);
  const states = new Map(), events = [];
  const host = { nodes: fixture.nodes, layoutEngine: fixture.engine, options: {}, services: {},
    context: { getState(node) { if (!states.has(node.id)) states.set(node.id, {}); return states.get(node.id); } },
    invalidate: (id, kind) => fixture.engine.invalidate(id, kind), emit: (node, event, payload) => events.push([node.id, event, payload]) };
  const first = getScrollModel(host, 'root'), second = getScrollModel(host, 'presenter');
  assert.equal(first, second);
  first.scrollTo(0, 100, { AnimationMode: 0 });
  assert.equal(fixture.nodes.get('root').properties.VerticalOffset, 100);
  assert.equal(fixture.state('root').data.scroll.verticalOffset, 100);
  assert.equal(fixture.state('presenter').data.scroll.verticalOffset, 100);
  assert.deepEqual(events.filter(value => value[1] === 'ScrollCompleted').map(value => value[0]), ['presenter', 'root']);
  first.dispose();
});

test('synchronous ChangeView publishes getter metrics before a later arrange or native feedback', () => {
  const root = element('root', { Width: 100, Height: 100, Content: { $ref: 'body' } }, 'ScrollViewer');
  const fixture = layoutFixture([root, element('body', { Width: 1000, Height: 1000 })], { width: 100, height: 100 });
  fixture.update();
  const storage = {};
  const host = { nodes: fixture.nodes, layoutEngine: fixture.engine, options: {}, services: {},
    context: { getState: () => storage }, invalidate: (id, kind) => fixture.engine.invalidate(id, kind), emit() {} };
  const model = getScrollModel(host, 'root', false);
  model.changeView(20, 30, 2, true);
  assert.equal(fixture.state('root').data.scroll.horizontalOffset, 20);
  assert.equal(fixture.state('root').data.scroll.verticalOffset, 30);
  assert.equal(fixture.state('root').data.scroll.zoomFactor, 2);
  model.changeView(null, 0, null, true);
  assert.equal(fixture.state('root').data.scroll.horizontalOffset, 20);
  assert.equal(fixture.state('root').data.scroll.verticalOffset, 0);
  assert.equal(fixture.state('root').data.scroll.zoomFactor, 2);
  model.dispose();
});
