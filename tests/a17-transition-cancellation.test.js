import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimationClock} from '@sharpforge/framework';
import {Compositor, CompositionTransport, CompositionTransportHost, ImplicitTransition, ImplicitTransitionCoordinator,
  ThemeTransition, ThemeTransitionCoordinator} from '@sharpforge/rendering';

const clockFactory = adapter => new AnimationClock(adapter);

test('public StopAnimation leaves the current value while transient cancellation reveals the current underlying base', async () => {
  const compositor = new Compositor({clockFactory});
  try {
    const visual = compositor.CreateSpriteVisual(), owner = {id: 'owner'};
    const direct = compositor.CreateScalarKeyFrameAnimation();
    direct.Duration = 100;
    direct.InsertKeyFrame(0, 0);
    direct.InsertKeyFrame(1, 1);
    visual.StartAnimation('Opacity', direct);
    compositor.advance(25);
    visual.StopAnimation('Opacity');
    assert.equal(visual.Opacity, 0.25, 'The released LeaveCurrentValue contract remains unchanged');
    const implicit = new ImplicitTransitionCoordinator(compositor, {getVisual: () => visual,
      getTransition: () => new ImplicitTransition('ScalarTransition', 100)});
    implicit.propertyChanged(owner, 'Opacity', 0.25, 1);
    compositor.advance(50);
    visual.Opacity = 0.8;
    implicit.cancel(owner, 'Opacity');
    assert.equal(visual.Opacity, 0.8, 'Cancellation reveals an underlying value changed while the animation was active');
    assert.equal(implicit.active.size, 0);
    implicit.dispose();
  } finally { await compositor.dispose(); }
});

test('canceling an exit theme restores base opacity and offset instead of retaining a faded or displaced sample', async () => {
  const compositor = new Compositor({clockFactory});
  try {
    const visual = compositor.CreateSpriteVisual(), owner = {id: 'owner'};
    visual.Opacity = 0.75;
    visual.Offset = [10, 20, 0];
    const themes = new ThemeTransitionCoordinator(compositor, {getVisual: () => visual});
    themes.start(owner, [new ThemeTransition('FadeOutThemeAnimation')], {previousOffset: [40, 50, 0]});
    compositor.advance(45);
    assert.ok(visual.Opacity < 0.75);
    themes.cancel(owner);
    assert.equal(visual.Opacity, 0.75);
    assert.deepEqual(visual.Offset, [10, 20, 0]);
    assert.equal(themes.active.size, 0);
    themes.dispose();
  } finally { await compositor.dispose(); }
});

test('the data-only stop packet restores host base values without replacing public stop semantics', async () => {
  const packets = [];
  const host = new CompositionTransportHost({clockFactory});
  const compositor = new Compositor({clockFactory});
  const transport = new CompositionTransport({session: 'transient-cancellation', enqueue: () => {},
    emit: packet => { packets.push(structuredClone(packet)); host.receive(packet); }});
  transport.connect(compositor);
  try {
    const visual = compositor.CreateSpriteVisual(), owner = {id: 'owner'};
    visual.Opacity = 1;
    const implicit = new ImplicitTransitionCoordinator(compositor, {getVisual: () => visual,
      getTransition: () => new ImplicitTransition('ScalarTransition', 100)});
    implicit.propertyChanged(owner, 'Opacity', 1, 0);
    const session = host.sessions.get('transient-cancellation');
    session.compositor.advance(25);
    assert.equal(session.objects.get(visual.id).Opacity, 0.75);
    compositor.advance(50);
    implicit.cancel(owner, 'Opacity');
    assert.equal(session.objects.get(visual.id).Opacity, 0);
    assert.equal(packets.at(-1).op, 'composition-stop');
    assert.equal(packets.at(-1).restoreBase, true);
    assert.throws(() => host.receive({...packets.at(-1), restoreBase: 'yes'}), /stop policy/);
    implicit.dispose();
  } finally { await compositor.dispose(); host.dispose(); }
});
