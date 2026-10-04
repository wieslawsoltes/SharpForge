import assert from 'node:assert/strict';
import test from 'node:test';
import { StudioKeyboard } from '../apps/studio/workbench/studio-keyboard.js';
import { createCommandRegistry } from '../apps/studio/commands/registry.js';
import { eventStroke, normalizeSequence } from '@sharpforge/editor';
import { createNativeEditor, keyboardEvent, selectionPairs } from './support/native-editor-fixture.js';

function setup({ profile = 'vscode' } = {}) {
  const editor = createNativeEditor('one two', { mode: profile, selections: [[0, 3]] });
  const commands = createCommandRegistry();
  const calls = [];
  commands.registerCommand('save', 'Save', 'Ctrl+S', () => calls.push('save'));
  commands.registerCommand('palette', 'Palette', 'Ctrl+K', () => calls.push('palette'));
  let active = editor;
  const context = { debugState: 'stopped' };
  const errors = [];
  const keyboard = new StudioKeyboard({ commands, getEditor: () => active, context: () => context,
    onError: error => errors.push(error.message) });
  keyboard.profile(profile);
  keyboard.attach(editor);
  return { editor, keyboard, commands, calls, errors, context, setActive: value => { active = value; },
    dispose() { keyboard.dispose(); editor.dispose(); commands.dispose(); } };
}

function target(kind = 'editor') {
  return { closest(selector) {
    if (kind === 'editor' && selector === '.sf-editor') return this;
    if (kind === 'dialog' && selector === '[role="dialog"],dialog') return this;
    if (kind === 'solution' && selector.includes('[data-tool="solution"]')) return this;
    return null;
  } };
}

function send(fixture, sequence, kind = 'editor') {
  for (const stroke of sequence.split(' ')) {
    const event = { ...keyboardEvent(stroke), target: target(kind) };
    fixture.keyboard.capture(event);
    if (!event.defaultPrevented && kind === 'editor') fixture.editor.adapter.handle(event);
    if (!event.defaultPrevented) fixture.keyboard.handle(event);
  }
}

test('public shortcut utilities share native event normalization with the Options recorder', () => {
  assert.equal(eventStroke(keyboardEvent('Ctrl+Shift+[')), 'Ctrl+Shift+[');
  assert.deepEqual(normalizeSequence('Mod+K Mod+C', 'mac'), ['Meta+K', 'Meta+C']);
});

test('invalid keyboard assignments, removal syntax and profile IDs never replace active state', () => {
  const fixture = setup();
  const override = { id: 'custom:uppercase', command: 'Edit.MakeUppercase', keys: 'Ctrl+Alt+U', scope: 'Text Editor' };
  fixture.keyboard.apply([override]);
  const before = fixture.keyboard.list();
  const service = fixture.keyboard.service;
  assert.throws(() => fixture.keyboard.apply([{ ...override, keys: 'Hyper+Q' }]), /modifier/);
  assert.equal(fixture.keyboard.service, service);
  assert.deepEqual(fixture.keyboard.list(), before);
  assert.throws(() => fixture.keyboard.apply([{ ...override, keys: 'Ctrl+Alt+L' },
    { id: 'bad-removal', removed: true, command: 'Edit.Copy', keys: 'Hyper+C' }]), /modifier/);
  assert.equal(fixture.keyboard.service, service);
  assert.throws(() => fixture.keyboard.apply([{ ...override, id: 'editor-profile:0' }]), /Duplicate binding/);
  assert.equal(fixture.keyboard.service, service);
  assert.throws(() => fixture.keyboard.profile('not-a-profile'), /Unknown/);
  assert.deepEqual(fixture.keyboard.list(), before);
  send(fixture, 'Ctrl+Alt+U');
  assert.equal(fixture.editor.value, 'ONE two');
  fixture.dispose();
});

test('custom commands override defaults exactly once and remain visible to command menus', () => {
  const fixture = setup();
  fixture.keyboard.apply([{ id: 'custom:case', command: 'Edit.MakeUppercase', keys: 'Ctrl+D', scope: 'Text Editor' }]);
  send(fixture, 'Ctrl+D');
  assert.equal(fixture.editor.value, 'ONE two');
  assert.equal(fixture.editor.model.undoStack.depth, 1);
  assert.equal(fixture.keyboard.bindingsFor('Edit.MakeUppercase')[0].keys.join(' '), 'Ctrl+D');
  fixture.editor.undo();
  fixture.keyboard.apply([]);
  send(fixture, 'Ctrl+D');
  assert.equal(fixture.editor.value, 'one two');
  assert.deepEqual(fixture.errors, []);
  fixture.dispose();
});

test('removing one native chord leaves other chords sharing its prefix available', () => {
  const fixture = setup();
  const binding = fixture.keyboard.list().find(item => item.command === 'Edit.CommentSelection');
  fixture.keyboard.apply([{ ...binding, id: 'removed:' + binding.id, removed: true }]);
  assert.equal(fixture.keyboard.bindingsFor('Edit.CommentSelection').length, 0);
  assert.equal(fixture.editor.adapter.bindings.resolve('Ctrl+K Ctrl+C').binding, null);
  fixture.editor.goto(0);
  fixture.editor.applyEdits([{ start: 0, end: 0, text: '// ' }], { undoStop: true });
  fixture.editor.goto(0);
  send(fixture, 'Ctrl+K Ctrl+U');
  assert.equal(fixture.editor.value, 'one two');
  assert.deepEqual(fixture.calls, []);
  send(fixture, 'Ctrl+K Ctrl+C');
  assert.equal(fixture.editor.value, 'one two');
  fixture.dispose();
});

test('a removed global exact key does not intercept an editor chord using its prefix', () => {
  const fixture = setup();
  const palette = fixture.keyboard.list().find(item => item.command === 'palette');
  fixture.keyboard.apply([{ ...palette, id: 'removed:' + palette.id, removed: true }]);
  send(fixture, 'Ctrl+K Ctrl+C');
  assert.equal(fixture.editor.value, '// one two');
  assert.deepEqual(fixture.calls, []);
  fixture.dispose();
});

test('a removal follows command and scope across profile changes without suppressing a different command on the key', () => {
  const fixture = setup();
  const occurrence = fixture.keyboard.list().find(item => item.command === 'Edit.AddNextOccurrence');
  fixture.keyboard.apply([{ ...occurrence, id: 'removed:' + occurrence.id, removed: true }]);
  assert.equal(fixture.editor.adapter.bindings.resolve('Ctrl+D').binding, null);
  fixture.editor.adapter.setMode('visual-studio');
  fixture.keyboard.profile('visual-studio');
  send(fixture, 'Ctrl+D');
  assert.equal(fixture.editor.value, 'oneone two');
  assert.ok(fixture.keyboard.bindingsFor('Edit.Duplicate').some(item => item.keys.join(' ') === 'Ctrl+D'));
  fixture.dispose();
});

test('dynamic binding disposers remain valid after atomic table swaps and reject duplicate IDs', () => {
  const fixture = setup();
  const remove = fixture.keyboard.register({ id: 'temporary', command: 'save', keys: 'Ctrl+Alt+S', scope: 'Global' });
  fixture.keyboard.apply([]);
  fixture.keyboard.profile('emacs');
  const saveKeys = () => fixture.keyboard.bindingsFor('save').map(binding => binding.keys.join(' ')).sort();
  assert.deepEqual(saveKeys(), ['Ctrl+Alt+S', 'Ctrl+S', 'Ctrl+X Ctrl+S']);
  send(fixture, 'Ctrl+X Ctrl+S', 'global');
  assert.deepEqual(fixture.calls, ['save']);
  assert.throws(() => fixture.keyboard.register({ id: 'temporary', command: 'save', keys: 'X' }), /Duplicate/);
  remove(); remove();
  assert.deepEqual(saveKeys(), ['Ctrl+S', 'Ctrl+X Ctrl+S']);
  fixture.dispose();
});

test('keyboard conflict data excludes removed defaults and includes cross-scope prefix overlap', () => {
  const fixture = setup();
  const conflicts = fixture.keyboard.conflicts({ id: 'custom', keys: 'Ctrl+K', command: 'save', scope: 'Global' });
  assert.ok(conflicts.some(conflict => conflict.kind === 'prefix' && conflict.shadowing));
  const save = fixture.keyboard.list().find(item => item.command === 'save');
  fixture.keyboard.apply([{ ...save, id: 'removed:' + save.id, removed: true }]);
  assert.equal(fixture.keyboard.bindingsFor('save').length, 0);
  assert.ok(!fixture.keyboard.conflicts({ id: 'candidate', keys: 'Ctrl+S', command: 'other', scope: 'Global' })
    .some(conflict => conflict.right.command === 'save'));
  fixture.dispose();
});

test('popup installation handles global shortcuts once, releases listeners and leaves dialogs alone', () => {
  const fixture = setup();
  const listeners = [];
  const document = {
    addEventListener(name, listener, capture = false) { listeners.push({ name, listener, capture }); },
    removeEventListener(name, listener, capture = false) {
      const index = listeners.findIndex(item => item.name === name && item.listener === listener && item.capture === capture);
      if (index >= 0) listeners.splice(index, 1);
    }
  };
  const uninstall = fixture.keyboard.install(document);
  assert.equal(fixture.keyboard.install(document), uninstall);
  assert.equal(listeners.length, 2);
  const event = { ...keyboardEvent('Ctrl+S'), target: target('global') };
  for (const { listener } of listeners) listener(event);
  assert.deepEqual(fixture.calls, ['save']);
  assert.equal(event.defaultPrevented, true);
  for (const { listener } of listeners) listener(event);
  assert.deepEqual(fixture.calls, ['save']);
  const dialogEvent = { ...keyboardEvent('Ctrl+S'), target: target('dialog') };
  for (const { listener } of listeners) listener(dialogEvent);
  assert.equal(dialogEvent.defaultPrevented, false);
  assert.deepEqual(fixture.calls, ['save']);
  uninstall(); uninstall();
  assert.equal(listeners.length, 0);
  fixture.dispose();
});

test('attached command availability is explicit without an editor and closing a view detaches its filter', async () => {
  const fixture = setup();
  assert.equal(fixture.keyboard.attachments.size, 1);
  fixture.setActive(null);
  assert.throws(() => fixture.keyboard.execute('Edit.Delete'), /no active editor/);
  await assert.rejects(fixture.commands.execute('Edit.Delete'), /not available/);
  fixture.editor.dispose();
  assert.equal(fixture.keyboard.attachments.size, 0);
  fixture.dispose();
  assert.equal(fixture.keyboard.capture(keyboardEvent('Ctrl+C')), false);
  assert.equal(fixture.keyboard.handle(keyboardEvent('Ctrl+C')), false);
});
