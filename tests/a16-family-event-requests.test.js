import test from 'node:test';
import assert from 'node:assert/strict';
import { TextBuffer } from '../packages/winui-controls/src/text/text-buffer.js';
import { proposedTextEdit, interceptAcknowledgedEdit } from '../packages/winui-controls/src/text/acknowledged-input.js';
import { PaneState } from '../packages/winui-controls/src/navigation/pane.js';
import { ControlEvents } from '../packages/winui-controls/src/policy/events.js';
import { dispatchDeferred } from '../packages/winui-controls/src/overlay/deferrals.js';
import { forwardDeferredControlEvent } from '../packages/winui-controls/src/policy/event-requests.js';

function pending() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return { promise, resolve };
}

const microtasks = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

test('acknowledged edit proposals preserve surrogate pairs and apply casing/length before the callback', () => {
  const model = new TextBuffer({ text: 'A😀', maximumLength: 4, characterCasing: 2 });
  model.select(3);
  assert.deepEqual(proposedTextEdit(model, { type: 'deleteContentBackward' }), { text: 'A', selectionStart: 1, selectionLength: 0 });
  assert.equal(proposedTextEdit(model, { type: 'insertText', text: 'zz' }).text, 'A😀Z');
});

test('worker cancellation prevents text mutation and later keystrokes rebase on accepted text', async () => {
  const states = {};
  const requests = [];
  const node = { id: 'edit', type: 'Microsoft.UI.Xaml.Controls.TextBox', events: ['BeforeTextChanging'], properties: {} };
  const context = { getState: () => states, invalidate() {}, host: { options: { onError: error => { throw error; } } },
    requestEvent(owner, name, payload) { const result = pending(); requests.push({ name, payload, result }); return result.promise; } };
  const model = new TextBuffer({ text: '' });
  const editor = { value: '', selectionStart: 0, selectionEnd: 0,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } };
  let prevented = 0;
  const input = data => ({ type: 'beforeinput', cancelable: true, inputType: 'insertText', data,
    preventDefault() { prevented++; } });
  interceptAcknowledgedEdit(context, node, editor, model, input('a'));
  interceptAcknowledgedEdit(context, node, editor, model, input('b'));
  assert.equal(model.text, '');
  requests[0].result.resolve({ Cancel: true });
  await microtasks();
  assert.equal(requests[1].payload.NewText, 'b');
  requests[1].result.resolve({ Cancel: false });
  await microtasks();
  assert.equal(model.text, 'b');
  assert.equal(editor.value, 'b');
  assert.equal(prevented, 2);
  assert.equal(model.undoStack.length, 1);
});

test('native paste waits for Paste cancellation before BeforeTextChanging and records one approved edit', async () => {
  const states = {};
  const requests = [];
  const node = { id: 'paste', events: ['Paste', 'BeforeTextChanging'], properties: {} };
  const context = { getState: () => states, invalidate() {}, host: { options: { onError: error => { throw error; } } },
    requestEvent(owner, name, payload) { const result = pending(); requests.push({ name, payload, result }); return result.promise; } };
  const model = new TextBuffer({ text: 'old' });
  model.selectAll();
  const editor = { value: 'old', selectionStart: 0, selectionEnd: 3,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } };
  let prevented = 0;
  const paste = { type: 'paste', cancelable: true, clipboardData: { getData: () => 'new' }, preventDefault() { prevented++; } };
  assert.equal(interceptAcknowledgedEdit(context, node, editor, model, paste), true);
  assert.equal(requests[0].name, 'Paste');
  assert.equal(model.text, 'old');
  requests[0].result.resolve({ Handled: true });
  await microtasks();
  assert.equal(requests.length, 1);
  assert.equal(model.text, 'old');
  assert.equal(model.undoStack.length, 0);
  interceptAcknowledgedEdit(context, node, editor, model, paste);
  requests[1].result.resolve({ Handled: false });
  await microtasks();
  assert.equal(requests[2].name, 'BeforeTextChanging');
  assert.equal(requests[2].payload.NewText, 'new');
  requests[2].result.resolve({ Cancel: false });
  await microtasks();
  assert.equal(model.text, 'new');
  assert.equal(model.undoStack.length, 1);
  assert.equal(prevented, 2);
});

test('paste-only handlers can cancel and disposal discards a pending accepted paste', async () => {
  const states = {};
  let request = pending();
  const node = { id: 'paste', events: ['Paste'], properties: {} };
  const context = { getState: () => states, invalidate() {}, host: { options: {} }, requestEvent: () => request.promise };
  const model = new TextBuffer({ text: 'before' });
  const editor = { value: 'before', selectionStart: 6, selectionEnd: 6, setSelectionRange() {} };
  const event = { type: 'paste', cancelable: true, clipboardData: { getData: () => ' after' }, preventDefault() {} };
  interceptAcknowledgedEdit(context, node, editor, model, event);
  request.resolve({ Cancel: true });
  await microtasks();
  assert.equal(model.text, 'before');
  request = pending();
  interceptAcknowledgedEdit(context, node, editor, model, event);
  states.familyStates.get('acknowledged-edit').dispose();
  request.resolve({ Cancel: false });
  await microtasks();
  assert.equal(model.text, 'before');
  assert.equal(model.undoStack.length, 0);
});

test('pane requests observe cancellation and superseded responses cannot close a newer state', async () => {
  const model = new PaneState({ open: true });
  const first = pending();
  const close = model.requestOpen(false, () => first.promise);
  assert.equal(model.open, true);
  first.resolve({ Cancel: true });
  assert.equal(await close, false);
  const second = pending();
  const stale = model.requestOpen(false, () => second.promise);
  model.setOpen(false);
  model.setOpen(true);
  second.resolve({ Cancel: false });
  assert.equal(await stale, false);
  assert.equal(model.open, true);
});

test('browser deferral stays open until the acknowledged managed deferral result arrives', async () => {
  const events = new ControlEvents();
  const request = pending();
  const node = { id: 'dialog' };
  let emitted = 0;
  const context = { requestEvent: () => request.promise, emit() { emitted++; }, host: { options: {} } };
  events.on('Closing', args => forwardDeferredControlEvent(context, node, 'Closing', args));
  let settled = false;
  const closing = dispatchDeferred(events, 'Closing', {}, { timeout: 1000 }).then(args => { settled = true; return args; });
  await microtasks();
  assert.equal(settled, false);
  request.resolve({ Cancel: true });
  assert.equal((await closing).Cancel, true);
  assert.equal(emitted, 0);
});
