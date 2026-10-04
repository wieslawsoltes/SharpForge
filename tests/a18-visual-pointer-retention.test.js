import test from 'node:test';
import assert from 'node:assert/strict';
import {disposeDesignerPointer, prepareDesignerPointer} from '../apps/studio/designer-surface-pointer.js';
import {pointerCaptureDom} from './fixtures/a18-pointer-capture-dom.js';

test('a mounted surface retains one inert hit layer across repeated gestures without DOM insertion or removal', () => {
  const {controller, view, begin, input, target} = pointerCaptureDom();
  const layer = prepareDesignerPointer(controller);
  assert.equal(prepareDesignerPointer(controller), layer);
  assert.equal(layer.style.pointerEvents, 'none');
  assert.equal(layer.getAttribute('aria-hidden'), 'true');
  view.overlay.append = () => assert.fail('A pointer boundary inserted another hit layer.');
  const remove = layer.remove.bind(layer);
  let removals = 0;
  layer.remove = () => { removals++; remove(); };
  let committed = 0;
  for (let index = 0; index < 200; index++) {
    begin(() => {}, () => committed++, () => assert.fail('Normal gesture canceled'));
    assert.equal(target.hasPointerCapture(4), true);
    assert.equal(layer.style.pointerEvents, 'auto');
    input.emit('pointerup', {pointerId: 4});
    assert.equal(layer.style.pointerEvents, 'none');
    assert.equal(target.hasPointerCapture(4), false);
    assert.equal(view.overlay.children[0], layer);
    assert.equal(input.count(), 0);
  }
  assert.equal(committed, 200);
  assert.equal(removals, 0);
  disposeDesignerPointer(controller);
  assert.equal(removals, 1);
  assert.equal(view.overlay.children.length, 0);
  assert.equal(controller.pointerLayer, null);
});

test('canceled and failed mounted gestures leave the retained surface inert with no active ownership', () => {
  for (const reason of ['keydown', 'pointercancel', 'lostpointercapture', 'capture-error']) {
    const {controller, view, begin, input, target, targetEvents, frames} = pointerCaptureDom();
    const layer = prepareDesignerPointer(controller);
    let canceled = 0;
    if (reason === 'capture-error') {
      target.setPointerCapture = () => { throw new Error('Native capture rejected'); };
      assert.throws(() => begin(() => {}, () => assert.fail('Failed capture committed'), () => canceled++), /capture rejected/);
    } else {
      begin(() => {}, () => assert.fail('Canceled pointer committed'), () => canceled++);
      input.emit('pointermove', {pointerId: 4});
      if (reason === 'lostpointercapture') targetEvents.emit(reason, {pointerId: 4});
      else input.emit(reason, {pointerId: 4, key: 'Escape'});
    }
    assert.equal(canceled, 1, reason);
    assert.equal(layer.style.pointerEvents, 'none', reason);
    assert.equal(view.overlay.children[0], layer, reason);
    assert.equal(input.count(), 0, reason);
    assert.equal(targetEvents.count(), 0, reason);
    assert.equal(frames.size, 0, reason);
    assert.equal(controller.cancelPointer, null, reason);
    disposeDesignerPointer(controller);
  }
});

test('disposing a mounted active pointer cancels once and releases the retained DOM and queued frame', () => {
  const {controller, view, begin, input, frames, target, targetEvents} = pointerCaptureDom();
  prepareDesignerPointer(controller);
  let canceled = 0;
  begin(() => {}, () => assert.fail('Disposed pointer committed'), () => canceled++);
  input.emit('pointermove', {pointerId: 4});
  disposeDesignerPointer(controller);
  disposeDesignerPointer(controller);
  assert.equal(canceled, 1);
  assert.equal(frames.size, 0);
  assert.equal(input.count(), 0);
  assert.equal(targetEvents.count(), 0);
  assert.equal(target.hasPointerCapture(4), false);
  assert.equal(view.overlay.children.length, 0);
});

test('replacing a capture surface cancels the previous owner before mounting the new inert layer', () => {
  const {controller, view, begin, target} = pointerCaptureDom();
  const original = prepareDesignerPointer(controller);
  let canceled = 0;
  begin(() => {}, () => assert.fail('Replaced surface committed'), () => canceled++);
  const overlay = view.stage.ownerDocument.createElement('div');
  view.stage.append(overlay);
  view.overlay = overlay;
  const replacement = prepareDesignerPointer(controller);
  assert.notEqual(replacement, original);
  assert.equal(original.parentElement, null);
  assert.equal(canceled, 1);
  assert.equal(target.hasPointerCapture(4), false);
  assert.equal(replacement.style.pointerEvents, 'none');
  disposeDesignerPointer(controller);
});
