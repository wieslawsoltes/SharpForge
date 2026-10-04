import test from 'node:test';
import assert from 'node:assert/strict';
import { pointerEventArgs, serializeRoutedEvent, hydratePointerEvent } from '../packages/winui-controls/src/input/index.js';

const event = () => ({ pointerId: 8, pointerType: 'pen', buttons: 1, pressure: 0.625, tiltX: 10, tiltY: -8,
  twist: 45, timeStamp: 20, clientX: 30, clientY: 40, width: 4, height: 6, ctrlKey: true });

test('routed pointer wire payloads contain data only and restore relative point methods', () => {
  const payload = pointerEventArgs(event(), { x: 30, y: 40 });
  payload.OriginalSource = 'control';
  payload.Handled = false;
  const wire = serializeRoutedEvent(payload);
  assert.equal(wire.GetCurrentPoint, undefined);
  assert.equal(wire.GetIntermediatePoints, undefined);
  assert.deepEqual(structuredClone(wire), wire);
  const hydrated = hydratePointerEvent(wire, { getLayout: id => id === 'child' ? { worldTransform: [2, 0, 0, 2, 10, 20] } : null });
  assert.deepEqual(hydrated.GetCurrentPoint({ $ref: 'child' }).Position, { X: 10, Y: 10 });
  assert.equal(hydrated.GetCurrentPoint().Properties.Pressure, 0.625);
  assert.equal(hydrated.GetIntermediatePoints('child')[0].Properties.ContactRect.Width, 2);
  hydrated.GetCurrentPoint().Position.X = 999;
  assert.equal(hydrated.GetCurrentPoint().Position.X, 30);
});

test('pointer coalescing is bounded and invalid/malicious wire data is rejected', () => {
  const native = event();
  native.getCoalescedEvents = () => Array.from({ length: 1000 }, (_, index) => ({ ...native, clientX: index }));
  const payload = serializeRoutedEvent(pointerEventArgs(native, { x: 30, y: 40 }));
  assert.equal(payload.IntermediatePoints.length, 256);
  assert.equal(payload.IntermediatePoints.at(-2).Position.X, 999);
  assert.deepEqual(payload.IntermediatePoints.at(-1), payload.CurrentPoint);
  const cycle = {}; cycle.next = cycle;
  assert.throws(() => serializeRoutedEvent(cycle), /cycle/);
  assert.throws(() => serializeRoutedEvent({ value: Infinity }), /finite/);
  assert.throws(() => serializeRoutedEvent({ get value() { return 1; } }), /member/);
  assert.throws(() => serializeRoutedEvent({ target: new Date() }), /projection/);
  assert.throws(() => hydratePointerEvent({ ...payload, Pointer: { PointerId: -1 } }), /pointer id/);
  const singular = hydratePointerEvent(payload, { worldTransform: [0, 0, 0, 0, 0, 0] });
  assert.throws(() => singular.GetCurrentPoint(), /singular/);
});
