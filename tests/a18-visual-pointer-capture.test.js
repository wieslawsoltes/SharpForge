import test from 'node:test';
import assert from 'node:assert/strict';
import {pointerCaptureDom as fixture} from './fixtures/a18-pointer-capture-dom.js';

test('the original control owns capture and a bounded hit layer until the latest pointer commits', () => {
  const {begin, input, target, targetEvents, view, calls, frames} = fixture();
  const moves = [];
  let committed = 0;
  let canceled = 0;
  begin(event => moves.push(event.clientX), () => committed++, () => canceled++);
  assert.deepEqual(calls[0], ['capture', target, 4], 'Capturing the surface would change Button double-click ownership.');
  assert.equal(view.overlay.children.length, 1);
  const layer = view.overlay.children[0];
  assert.equal(layer.getAttribute('aria-hidden'), 'true');
  assert.equal(layer.style.pointerEvents, 'auto');
  assert.equal(layer.style.cursor, 'nwse-resize');
  for (let index = 0; index < 200; index++) input.emit('pointermove', {pointerId: 4, clientX: index});
  assert.equal(frames.size, 1);
  input.emit('pointerup', {pointerId: 4, clientX: 200});
  assert.deepEqual(moves, [200]);
  assert.equal(committed, 1);
  assert.equal(canceled, 0);
  assert.deepEqual(calls.at(-1), ['release', target, 4]);
  assert.equal(view.overlay.children.length, 0);
  assert.equal(input.count(), 0);
  assert.equal(targetEvents.count(), 0);
  assert.equal(frames.size, 0);
});

test('Escape, pointer cancellation and lost capture each release ownership exactly once', () => {
  for (const reason of ['keydown', 'pointercancel', 'lostpointercapture']) {
    const {begin, input, targetEvents, view, frames, controller} = fixture();
    let canceled = 0;
    let committed = 0;
    begin(() => {}, () => committed++, () => canceled++);
    input.emit('pointermove', {pointerId: 4});
    if (reason === 'lostpointercapture') targetEvents.emit(reason, {pointerId: 4});
    else input.emit(reason, {pointerId: 4, key: 'Escape'});
    input.emit('pointerup', {pointerId: 4});
    assert.equal(canceled, 1, reason);
    assert.equal(committed, 0, reason);
    assert.equal(view.overlay.children.length, 0, reason);
    assert.equal(input.count(), 0, reason);
    assert.equal(targetEvents.count(), 0, reason);
    assert.equal(frames.size, 0, reason);
    assert.equal(controller.cancelPointer, null, reason);
  }
});

test('capture failures and failed previews cancel without leaking native capture or temporary DOM', () => {
  const failed = fixture();
  let canceled = 0;
  failed.target.setPointerCapture = () => { throw new Error('Capture rejected'); };
  assert.throws(() => failed.begin(() => {}, () => {}, () => canceled++), /Capture rejected/);
  assert.equal(canceled, 1);
  assert.equal(failed.input.count(), 0);
  assert.equal(failed.targetEvents.count(), 0);
  assert.equal(failed.view.overlay.children.length, 0);
  const moved = fixture();
  moved.begin(() => { throw new Error('Preview failed'); }, () => assert.fail('Invalid preview committed'), () => canceled++);
  moved.input.emit('pointermove', {pointerId: 4});
  moved.input.emit('pointerup', {pointerId: 4});
  assert.equal(canceled, 2);
  assert.equal(moved.errors[0].message, 'Preview failed');
  assert.equal(moved.view.overlay.children.length, 0);
  assert.equal(moved.targetEvents.count(), 0);
});

test('a replacement gesture releases its predecessor and ignores unrelated pointer IDs', () => {
  const {begin, input, view, controller} = fixture();
  let canceled = 0;
  const moves = [];
  begin(() => {}, () => assert.fail('Replaced gesture committed'), () => canceled++, 1);
  begin(event => moves.push(event.clientX), () => {}, () => canceled++, 2);
  assert.equal(canceled, 1);
  assert.equal(view.overlay.children.length, 1);
  input.emit('pointermove', {pointerId: 1, clientX: 100});
  input.emit('pointermove', {pointerId: 2, clientX: 5});
  input.emit('pointerup', {pointerId: 2, clientX: 8});
  assert.deepEqual(moves, [8]);
  assert.equal(view.overlay.children.length, 0);
  assert.equal(controller.cancelPointer, null);
});

test('non-browser pointer adapters retain document-event tracking without inserting a hit-test layer', () => {
  const {begin, input, view} = fixture({capture: false});
  let committed = 0;
  begin(() => {}, () => committed++, () => assert.fail('Canceled normal pointer adapter'));
  assert.equal(view.overlay.children.length, 0);
  input.emit('pointerup', {pointerId: 4});
  assert.equal(committed, 1);
  assert.equal(input.count(), 0);
});
