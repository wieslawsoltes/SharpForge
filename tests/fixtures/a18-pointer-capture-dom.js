import {trackDesignerPointer} from '../../apps/studio/designer-surface-pointer.js';
import {sessionDom} from './a18-session-dom.js';

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

/** Explicit native pointer and animation-frame boundary; the real browser gate owns hit-testing qualification. */
export function pointerCaptureDom({capture = true} = {}) {
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
