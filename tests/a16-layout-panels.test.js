import test from 'node:test';
import assert from 'node:assert/strict';
import { createTracks, resolveTracks, distributeSpan, rect, twoPaneGeometry, ScrollViewerModel,
  ScrollViewModel, nearestSnap, computeWorldLayout, parallaxOffset } from '../packages/winui-controls/src/layout/index.js';
import { element, panel, layoutFixture } from './helpers/a16-layout.js';

test('Grid distributes constrained stars after fixed and Auto demand, including spans', () => {
  const tracks = createTracks([{ Width: { GridUnitType: 1, Value: 100 } },
    { Width: { GridUnitType: 2, Value: 1 }, MaxWidth: 50 }, { Width: { GridUnitType: 2, Value: 2 } }], 'Width');
  resolveTracks(tracks, 400);
  assert.deepEqual(tracks.map(track => track.actual), [100, 50, 250]);
  const auto = createTracks([{ Width: { GridUnitType: 0 }, MaxWidth: 20 }, { Width: { GridUnitType: 0 } }], 'Width');
  distributeSpan(auto, 0, 2, 100, 10);
  assert.deepEqual(auto.map(track => track.base), [20, 70]);
});

test('Grid updates definitions incrementally and rounds shared edges to device pixels', () => {
  const root = panel('root', 'Grid', ['first', 'second'], { ColumnSpacing: 2 });
  root.collections.ColumnDefinitions = [{ $ref: 'column1' }, { $ref: 'column2' }];
  const fixture = layoutFixture([root, element('column1', { Width: { GridUnitType: 1, Value: 40 } }, 'ColumnDefinition'),
    element('column2', { Width: { GridUnitType: 2, Value: 1 } }, 'ColumnDefinition'),
    element('first', { Column: 0 }), element('second', { Column: 1 })], { width: 101, height: 50, scale: 1.25 });
  fixture.update();
  assert.equal(fixture.state('second').rect.x * 1.25 % 1, 0);
  fixture.nodes.get('column1').properties.Width.Value = 60;
  fixture.engine.invalidate('column1');
  fixture.update();
  assert.equal(fixture.nodes.get('column1').properties.ActualWidth, 60);
  assert.equal(fixture.state('second').rect.x, 62.4);
});

test('RelativePanel solves independent axes and rejects circular relations', () => {
  const fixture = layoutFixture([panel('root', 'RelativePanel', ['a', 'b']),
    element('a', { Width: 20, Height: 10, RightOf: { $ref: 'b' } }),
    element('b', { Width: 30, Height: 15, Below: { $ref: 'a' } })]);
  fixture.update();
  assert.deepEqual(fixture.state('a').rect, rect(30, 0, 20, 10));
  assert.deepEqual(fixture.state('b').rect, rect(0, 10, 30, 15));
  fixture.nodes.get('b').properties.RightOf = { $ref: 'a' };
  fixture.engine.invalidate('b');
  assert.throws(() => fixture.update(), /Circular RelativePanel/);
});

test('VariableSizedWrapGrid uses spans without probing first-child DOM geometry', () => {
  const fixture = layoutFixture([panel('root', 'VariableSizedWrapGrid', ['a', 'b', 'c'],
    { Orientation: 1, ItemWidth: 30, ItemHeight: 20 }),
    element('a', { WrapColumnSpan: 2 }), element('b'), element('c')], { width: 90, height: 100 });
  fixture.update();
  assert.deepEqual(fixture.state('a').slot, rect(0, 0, 60, 20));
  assert.deepEqual(fixture.state('b').slot, rect(60, 0, 30, 20));
  assert.deepEqual(fixture.state('c').slot, rect(0, 20, 30, 20));
});

test('scroll models clamp offsets, preserve zoom anchors, sequence events and cancel pending callbacks', () => {
  const events = [];
  const scheduled = new Map();
  let sequence = 0;
  const model = new ScrollViewerModel({ onEvent: (name, args) => events.push([name, args]),
    now: () => 0,
    requestFrame: callback => { scheduled.set(++sequence, callback); return sequence; }, cancelFrame: id => scheduled.delete(id) });
  model.setExtent({ width: 1000, height: 1000 }, { width: 100, height: 100 });
  assert.equal(model.changeView(2000, 30, null, true), true);
  assert.equal(model.horizontalOffset, 900);
  assert.equal(events.at(-1)[1].IsIntermediate, false);
  model.changeView(100, 100, 1, true);
  model.zoomAt(2, { x: 50, y: 50 });
  assert.equal(model.horizontalOffset, 125);
  model.changeView(120, 120, null, false);
  const [frame, callback] = scheduled.entries().next().value;
  scheduled.delete(frame);
  callback(90);
  assert.equal(events.at(-1)[1].IsIntermediate, true);
  model.dispose();
  assert.equal(scheduled.size, 0);
  assert.equal(model.changeView(0, 0, 1), false);
  const modern = new ScrollViewModel();
  modern.setExtent({ width: 1000, height: 1000 }, { width: 100, height: 100 });
  modern.verticalSnapPoints = [0, 100, 200];
  assert.equal(modern.scrollTo(0, 120, { animationMode: 'Disabled' }), 1);
  assert.equal(modern.verticalOffset, 100);
  assert.equal(nearestSnap(49, [{ offset: 0, interval: 20, start: 10, end: 100 }]), 40);
});

test('TwoPaneView thresholds and render-only transforms preserve layout sizes', () => {
  assert.equal(twoPaneGeometry({}, { width: 320, height: 568 }).mode, 'SinglePane');
  assert.equal(twoPaneGeometry({}, { width: 800, height: 568 }).mode, 'Wide');
  assert.equal(parallaxOffset(50, 200, 100, 20), -10);
  const fixture = layoutFixture([element('root', { Width: 20, Height: 10, Translation: { X: 10, Y: 20 }, Rotation: 90 })]);
  fixture.update();
  const world = computeWorldLayout(fixture.engine).get('root');
  assert.deepEqual(world.renderSize, { width: 20, height: 10 });
  assert.ok(Math.abs(world.bounds.width - 10) < 1e-9);
  assert.ok(Math.abs(world.bounds.height - 20) < 1e-9);
});
