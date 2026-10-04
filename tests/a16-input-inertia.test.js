import test from 'node:test';
import assert from 'node:assert/strict';
import { ManipulationRecognizer, ManipulationInertia, pointerEventArgs, serializeRoutedEvent,
  keyboardEventArgs } from '../packages/winui-controls/src/input/index.js';

test('coalesced points end at the current point and retain microsecond timestamps and typed device values', () => {
  const event = { type: 'pointermove', pointerId: 7, pointerType: 'pen', timeStamp: 12.5, clientX: 30, clientY: 50,
    buttons: 1, pressure: 0.7, getCoalescedEvents: () => [{ timeStamp: 10.5, clientX: 20, clientY: 40, pressure: 0.2 }] };
  const payload = serializeRoutedEvent(pointerEventArgs(event, { x: 15, y: 25 }));
  assert.equal(payload.Pointer.PointerDeviceType, 1);
  assert.equal(payload.CurrentPoint.Timestamp, 12500);
  assert.equal(payload.IntermediatePoints.length, 2);
  assert.equal(payload.IntermediatePoints[0].Properties.Pressure, 0.2);
  assert.deepEqual(payload.IntermediatePoints.at(-1), payload.CurrentPoint);
  assert.deepEqual(payload.IntermediatePoints[0].Position, { X: 5, Y: 15 });
  assert.equal(keyboardEventArgs({ key: 'a', code: 'KeyA', repeat: true }).KeyStatus.ScanCode, 0);
  assert.equal(keyboardEventArgs({ key: 'a', code: 'KeyA', repeat: true }).KeyStatus.WasKeyDown, true);
});

test('analytical inertia honors desired displacement and rotation, then reaches zero velocity', () => {
  const model = new ManipulationInertia({ Linear: { X: 1, Y: 0 }, Angular: 0.5, Expansion: 0 }, 64 | 128,
    { TranslationBehavior: { DesiredDisplacement: 50 }, RotationBehavior: { DesiredRotation: 25 } });
  const first = model.advance(50);
  const final = model.advance(100);
  assert.equal(first.Translation.X + final.Translation.X, 50);
  assert.equal(first.Rotation + final.Rotation, 25);
  assert.equal(model.velocities.Linear.X, 0);
  assert.equal(model.complete, true);
});

test('manipulation emits inertial deltas and completion, and Complete cancels its frame', () => {
  const events = [];
  const frames = new Map();
  let serial = 0;
  let now = 0;
  const recognizer = new ManipulationRecognizer({ now: () => now,
    requestFrame: callback => { frames.set(++serial, callback); return serial; }, cancelFrame: id => frames.delete(id),
    emit: (id, name, args) => {
      events.push([name, args]);
      if (name === 'ManipulationInertiaStarting') args.TranslationBehavior.DesiredDisplacement = 30;
    } });
  recognizer.down('item', { pointerId: 1, x: 0, y: 0, pointerType: 'touch' }, 1 | 64);
  now = 20;
  recognizer.move('item', { pointerId: 1, x: 20, y: 0 });
  recognizer.up('item', 1);
  assert.equal(frames.size, 1);
  now = 120;
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(now);
  assert(events.some(([name, args]) => name === 'ManipulationDelta' && args.IsInertial));
  assert.equal(events.at(-1)[0], 'ManipulationCompleted');
  assert.equal(events.at(-1)[1].Cumulative.Translation.X, 50);
  assert.equal(frames.size, 0);
  recognizer.down('item', { pointerId: 2, x: 0, y: 0 }, 1 | 64);
  now = 140;
  recognizer.move('item', { pointerId: 2, x: 20, y: 0 });
  recognizer.up('item', 2);
  recognizer.complete('item');
  assert.equal(frames.size, 0);
  recognizer.dispose();
});

test('stationary inertia with a desired displacement completes without NaN', () => {
  const value = new ManipulationInertia({ Linear: { X: 0, Y: 0 }, Angular: 0, Expansion: 0 }, 64,
    { TranslationBehavior: { DesiredDisplacement: 100 } });
  assert.equal(value.complete, true);
  assert.deepEqual(value.advance(16).Translation, { X: 0, Y: 0 });
});

test('coalesced pointer samples and horizontal wheel input preserve root DIP coordinates', () => {
  const value = pointerEventArgs({ type: 'pointermove', pointerId: 1, clientX: 100, clientY: 100, timeStamp: 5,
    getCoalescedEvents: () => [{ clientX: 90, clientY: 80, timeStamp: 4 }] }, { x: 50, y: 50, scaleX: 0.5, scaleY: 0.5 });
  assert.deepEqual(value.GetIntermediatePoints()[0].Position, { X: 45, Y: 40 });
  const wheel = pointerEventArgs({ type: 'wheel', deltaX: 70, deltaY: 0 }, { x: 0, y: 0 });
  assert.equal(wheel.CurrentPoint.Properties.IsHorizontalMouseWheel, true);
  assert.equal(wheel.CurrentPoint.Properties.MouseWheelDelta, -70);
});
