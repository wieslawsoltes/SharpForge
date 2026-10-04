import test from 'node:test';
import assert from 'node:assert/strict';
import {trackDesignerPointer} from '../apps/studio/designer-surface-pointer.js';
import {sessionDom} from './fixtures/a18-session-dom.js';

function events(target) {
  const listeners = new Map();
  target.addEventListener = (type, callback) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(callback);
  };
  target.removeEventListener = (type, callback) => listeners.get(type)?.delete(callback);
  return {
    emit(type, value = {}) {
      for (const callback of [...listeners.get(type) ?? []]) callback({target, preventDefault() {}, stopPropagation() {}, ...value});
    },
    count: () => [...listeners.values()].reduce((sum, values) => sum + values.size, 0)
  };
}

function fixture({capture = true} = {}) {
  const {document} = sessionDom();
  const input = events(document);
  const stage = document.createElement('div');
  const target = document.createElement('button');
  const overlay = document.createElement('div');
  document.body.append(stage);
  stage.append(target, overlay);
  const targetEvents = events(target);
  const frames = new Map();
  const calls = [];
  let serial = 0;
  let captured = null;
  Object.assign(document.defaultView, {
    getComputedStyle: () => ({cursor: 'nwse-resize'}),
    requestAnimationFrame(callback) { frames.set(++serial, callback); return serial; },
    cancelAnimationFrame(id) { frames.delete(id); }
  });
  if (capture) {
    target.setPointerCapture = id => { calls.push(['capture', target, id]); captured = id; };
    target.hasPointerCapture = id => captured === id;
    target.releasePointerCapture = id => {
      calls.push(['release', target, id]);
      captured = null;
      targetEvents.emit('lostpointercapture', {pointerId: id});
    };
  }
  const errors = [];
  const view = {stage, overlay, error: error => errors.push(error), safe: action => action()};
  const controller = {view, cancelPointer: null};
  return {controller, view, target, targetEvents, input, calls, frames, errors,
    begin: (move, done, cancel, pointerId = 4) => trackDesignerPointer(controller, {target, pointerId}, move, done, cancel)};
}

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
