import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimationClock} from '../packages/framework/src/animation-clock.js';
import {Compositor} from '../packages/rendering/src/composition/compositor.js';
import {CompositionTransport, CompositionTransportHost} from '../packages/rendering/src/composition/transport.js';
import {serializeCompositionGraph, applyCompositionGraph} from '../packages/rendering/src/composition/transport-codec.js';
import {IndependentTimelineTransport, IndependentTimelineHost} from '../packages/rendering/src/animation/independent-timelines.js';

const clockFactory = adapter => new AnimationClock(adapter);

test('worker composition definitions produce independent frames with one completion and no frame messages', () => {
  const packets = [];
  const source = new Compositor({clockFactory});
  const transport = new CompositionTransport({session: 'transport-fixture', emit: packet => packets.push(structuredClone(packet))});
  transport.connect(source);
  const visual = source.CreateSpriteVisual();
  visual.Size = [20, 20];
  visual.Brush = source.CreateColorBrush([1, 0, 0, 1]);
  source.attach(visual);
  const animation = source.CreateScalarKeyFrameAnimation();
  animation.Duration = 1000;
  animation.InsertKeyFrame(0, 0);
  animation.InsertKeyFrame(1, 1);
  let completed = 0;
  animation.add_Completed(() => completed++);
  visual.StartAnimation('Opacity', animation);
  const host = new CompositionTransportHost({clockFactory, onCompleted: token => transport.complete(token)});
  for (const packet of packets) host.receive(packet);
  packets.length = 0;
  const session = host.sessions.get('transport-fixture');
  for (let frame = 0; frame < 60; frame++) session.compositor.advance(1000 / 60);
  session.compositor.advance(0.001);
  assert.equal(completed, 1);
  assert.equal(packets.length, 0);
  assert.equal(session.objects.get(visual.id).Opacity, 1);
  host.dispose();
  source.dispose();
});

test('transported placement updates preserve content raster identity and reject cyclic graphs before mutation', () => {
  const source = new Compositor({clockFactory});
  const sprite = source.CreateSpriteVisual();
  sprite.Size = [20, 20];
  sprite.Brush = source.CreateColorBrush([1, 0, 0, 1]);
  source.attach(sprite);
  const host = new Compositor({clockFactory});
  let objects = applyCompositionGraph(host, structuredClone(serializeCompositionGraph(source)));
  const target = objects.get(sprite.id);
  host.render();
  const content = target.content;
  sprite.Offset = [12, 0, 0];
  objects = applyCompositionGraph(host, structuredClone(serializeCompositionGraph(source)), objects);
  host.render();
  assert.strictEqual(target.content, content);
  const bad = structuredClone(serializeCompositionGraph(source));
  bad.objects.find(row => row.id === sprite.id).children = [sprite.id];
  assert.throws(() => applyCompositionGraph(host, bad, objects), /cyclic/);
  assert.deepEqual(target.Offset, [12, 0, 0]);
  source.dispose();
  host.dispose();
});

test('property-set animations retain types, survive snapshot restoration and complete restored batches', () => {
  const compositor = new Compositor({clockFactory});
  const properties = compositor.CreatePropertySet();
  properties.InsertScalar('Progress', 0);
  const batch = compositor.CreateScopedBatch();
  const animation = compositor.CreateScalarKeyFrameAnimation();
  animation.Duration = 100;
  animation.InsertKeyFrame(1, 1);
  let completed = 0;
  batch.add_Completed(() => completed++);
  properties.StartAnimation('Progress', animation);
  batch.End();
  compositor.advance(25);
  const snapshot = compositor.snapshot();
  compositor.advance(25);
  compositor.restore(snapshot);
  assert.equal(properties.TryGetScalar('Progress').value, 0.25);
  compositor.advance(75);
  assert.equal(completed, 1);
  assert.equal(properties.TryGetScalar('Progress').value, 1);
  assert.equal(properties.TryGetVector2('Progress').status, 'TypeMismatch');
  assert.throws(() => properties.InsertVector3('Progress', [0, 0, 0]), /type/);
  compositor.dispose();
});

test('XAML independent transport writes managed values only at definition and completion boundaries', () => {
  const packets = [], native = new Map([['element', 0]]);
  let managed = 0, writes = 0, completed = 0;
  const clock = new AnimationClock({key: value => value, read: () => managed, readBase: () => 0, validate() {},
    write: (target, property, value) => { managed = value; writes++; }, completed: () => completed++});
  const source = new IndependentTimelineTransport({emit: packet => packets.push(structuredClone(packet)), session: 'xaml', clock, now: () => 0});
  const host = new IndependentTimelineHost({clockFactory, readProperty: id => native.get(id),
    applyProperty: (id, property, value) => native.set(id, value), onCompleted: packet => source.complete(packet)});
  assert.equal(source.begin('story', {id: 'story', target: 'element', property: 'Opacity', valueKind: 'Double', from: 0, to: 1, duration: 1000}), true);
  host.receive(packets.shift());
  const initialWrites = writes;
  for (let index = 0; index < 59; index++) host.clock.advance(1000 / 60);
  assert.equal(writes, initialWrites);
  assert.equal(packets.length, 0);
  host.clock.advance(1000 / 60 + 0.001);
  assert.equal(completed, 1);
  assert.equal(managed, 1);
  assert.equal(source.begin('dependent', {id: 'dependent', target: 'element', property: 'Width', to: 20, duration: 100}), false);
  source.dispose();
  host.dispose();
});
