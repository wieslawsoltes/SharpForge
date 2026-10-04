import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { KeybindingService } from '../packages/editor/src/keymaps/resolve.js';
import { compileWhen } from '../packages/editor/src/keymaps/when.js';
import { eventStroke, normalizeSequence, normalizeStroke, platformBindingInventory } from '../packages/editor/src/keymaps/platform.js';
import { getProfileBindings } from '../packages/editor/src/keymaps/native.js';
import { createNativeEditor, keyboardEvent, selectionPairs } from './support/native-editor-fixture.js';
import { vscodeBehaviorFixtures } from './support/vscode-behavior-fixtures.js';

test('VS Code shortcuts apply independently specified text, caret, view and host results', async t => {
  assert.ok(new Set(vscodeBehaviorFixtures.map(fixture => fixture.keys)).size >= 60);
  const modelFixtures = vscodeBehaviorFixtures.filter(fixture => fixture.expectedText !== undefined || fixture.expectedSelections !== undefined);
  assert.ok(modelFixtures.length >= 45, 'Most fixtures must validate real edits and carets, not provider dispatch');
  for (const fixture of vscodeBehaviorFixtures) await t.test(fixture.keys, async () => {
    const editor = createNativeEditor(fixture.text, fixture);
    try {
      fixture.setup?.(editor);
      const before = editor.value;
      const selections = selectionPairs(editor);
      const primaryIndex = editor.primaryIndex;
      await editor.press(fixture.keys);
      assert.deepEqual(editor.messages.filter(message => !message.endsWith('…')), []);
      assert.equal(editor.value, fixture.expectedText ?? before);
      if (fixture.expectedSelections) assert.deepEqual(selectionPairs(editor), fixture.expectedSelections);
      fixture.check?.(editor);
      if (fixture.expectedText !== undefined && fixture.undo !== false && fixture.expectedText !== before) {
        assert.equal(editor.model.undoStack.depth, 1, 'One shortcut must create one history group');
        editor.undo();
        assert.equal(editor.value, before);
        assert.deepEqual(selectionPairs(editor), selections);
        assert.equal(editor.primaryIndex, primaryIndex);
        editor.undo(true);
        assert.equal(editor.value, fixture.expectedText);
      }
    } finally { editor.dispose(); }
  });
});

test('normalizes platform modifiers and real shifted punctuation without intercepting AltGraph or IME', () => {
  assert.equal(normalizeStroke('Mod+Shift+k', 'mac'), 'Meta+Shift+K');
  assert.deepEqual(normalizeSequence('Ctrl+K Ctrl+C'), ['Ctrl+K', 'Ctrl+C']);
  for (const stroke of ['Ctrl+Shift+[', 'Ctrl+Shift+]', 'Ctrl+Shift+\\', 'Alt+Shift+,', 'Alt+Shift+.']) {
    assert.equal(eventStroke(keyboardEvent(stroke)), normalizeStroke(stroke));
  }
  for (const [digit, key] of [...')!@#$%^&*('].entries()) {
    assert.equal(eventStroke({ key, code: `Digit${digit}`, ctrlKey: true, shiftKey: true }), `Ctrl+Shift+${digit}`);
  }
  assert.equal(eventStroke({ key: 'é', code: 'Digit2', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+É');
  assert.equal(eventStroke({ key: '!', code: 'Digit8', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+!');
  assert.equal(eventStroke({ ...keyboardEvent('Ctrl+Alt+E'), getModifierState: key => key === 'AltGraph' }), null);
  assert.equal(eventStroke({ ...keyboardEvent('Ctrl+C'), isComposing: true }), null);
  assert.equal(eventStroke({ key: 'Dead' }), null);
  assert.ok(platformBindingInventory('mac').every(binding => binding.alternate && binding.browserMayIntercept));
});

test('macOS profile editing uses Meta while physical Ctrl bindings remain distinct', async () => {
  const editor = createNativeEditor('one one', { platform: 'mac', selections: [[0, 3]] });
  await editor.press('Mod+D');
  assert.deepEqual(selectionPairs(editor), [[0, 3], [4, 7]]);
  await editor.press('Ctrl+F6');
  assert.equal(editor.requests.at(-1).command, 'nextDocument');
  assert.equal(editor.adapter.handle(keyboardEvent('Ctrl+D', 'mac')), false);
  editor.dispose();
});

test('context expressions are bounded boolean predicates without evaluation side effects', () => {
  const predicate = compileWhen('editorTextFocus && (!editorReadonly || language == "markdown")');
  assert.equal(predicate({ editorTextFocus: true, editorReadonly: false }), true);
  assert.equal(predicate(new Map([['editorTextFocus', true], ['editorReadonly', true], ['language', 'markdown']])), true);
  assert.equal(predicate({ editorTextFocus: false }), false);
  assert.throws(() => compileWhen('globalThis.process.exit()'), SyntaxError);
  assert.throws(() => compileWhen('('.repeat(30) + 'true' + ')'.repeat(30)), RangeError);
  assert.throws(() => compileWhen('a '.repeat(1100)), /Invalid/);
});

test('resolver honors scope, priority, predicates, disposal, and atomic replacement of invalid bindings', () => {
  const calls = [];
  const resolver = new KeybindingService({ execute: command => calls.push(command) });
  resolver.register({ id: 'global', keys: 'Ctrl+K', command: 'global', scope: 'Global' });
  resolver.register({ id: 'editor', keys: 'Ctrl+K', command: 'editor', when: 'writable' });
  resolver.register({ id: 'priority', keys: 'Ctrl+K', command: 'priority', priority: 10, when: 'override' });
  assert.equal(resolver.resolve('Ctrl+K', { context: { writable: true } }).binding.command, 'editor');
  assert.equal(resolver.resolve('Ctrl+K', { scope: 'Tool Window', context: { writable: true } }).binding.command, 'global');
  assert.equal(resolver.resolve('Ctrl+K', { context: { override: true } }).binding.command, 'priority');
  assert.equal(resolver.resolve('Ctrl+K', { context: {} }).binding.command, 'global');
  assert.ok(resolver.conflicts().some(conflict => conflict.shadowing));
  assert.throws(() => resolver.setBindings([{ keys: 'Hyper+K', command: 'bad' }]), /modifier/);
  assert.equal(resolver.resolve('Ctrl+K').binding.command, 'global');
  resolver.handle(keyboardEvent('Ctrl+K'));
  assert.deepEqual(calls, ['global']);
  resolver.dispose();
  assert.equal(resolver.handle(keyboardEvent('Ctrl+K')), false);
  assert.throws(() => resolver.register({ keys: 'X', command: 'new' }), /disposed/);
});

test('chord cancellation, failure and timeout leave no stale pending input', () => {
  const timers = new Map();
  const messages = [];
  const calls = [];
  let sequence = 0;
  const resolver = new KeybindingService({ execute: command => calls.push(command), onStatus: message => messages.push(message),
    clock: { setTimeout(callback) { const id = ++sequence; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); } } });
  resolver.setBindings([{ keys: 'Ctrl+K Ctrl+C', command: 'comment' }]);
  resolver.handle(keyboardEvent('Ctrl+K'));
  assert.equal(timers.size, 1);
  resolver.handle(keyboardEvent('Escape'));
  assert.equal(timers.size, 0);
  assert.equal(resolver.pending, null);
  resolver.handle(keyboardEvent('Ctrl+K'));
  resolver.handle(keyboardEvent('Ctrl+X'));
  assert.match(messages.at(-1), /not assigned/);
  resolver.handle(keyboardEvent('Ctrl+K'));
  [...timers.values()][0]();
  assert.equal(resolver.pending, null);
  assert.match(messages.at(-1), /timed out/);
  resolver.handle(keyboardEvent('Ctrl+K'));
  resolver.handle(keyboardEvent('Ctrl+C'));
  assert.deepEqual(calls, ['comment']);
  resolver.dispose();
});

test('a higher-priority chord prefix suppresses a lower-priority destructive command even after timeout', () => {
  const calls = [];
  let timeout;
  const resolver = new KeybindingService({ execute: command => calls.push(command),
    clock: { setTimeout(callback) { timeout = callback; return 1; }, clearTimeout() {} } });
  resolver.setBindings([
    { keys: 'Ctrl+X', command: 'cut', priority: 0 },
    { keys: 'Ctrl+X Ctrl+S', command: 'save', priority: 20 }
  ]);
  assert.equal(resolver.resolve('Ctrl+X').binding, null);
  resolver.handle(keyboardEvent('Ctrl+X'));
  assert.deepEqual(calls, []);
  timeout();
  assert.deepEqual(calls, []);
  resolver.handle(keyboardEvent('Ctrl+X'));
  resolver.handle(keyboardEvent('Ctrl+S'));
  assert.deepEqual(calls, ['save']);
  resolver.dispose();
});

test('all shipped profile bindings have executable command registrations', () => {
  const editor = createNativeEditor();
  for (const profile of ['visual-studio', 'vscode', 'sublime', 'emacs', 'vim']) {
    for (const binding of getProfileBindings(profile)) assert.ok(editor.adapter.commands.has(binding.command), `${profile}: ${binding.command}`);
  }
  assert.throws(() => editor.adapter.setMode('unknown'), /Unknown editor profile/);
  assert.equal(editor.adapter.mode, 'vscode');
  editor.dispose();
});

test('Visual Studio bindings and unbound known commands match the pinned inventory', async () => {
  const inventory = JSON.parse(await readFile(new URL('../docs/vs-inventory.json', import.meta.url), 'utf8'));
  const actual = getProfileBindings('visual-studio').map(({ keys, command, scope }) => ({ keys, command, scope }));
  assert.deepEqual(actual, inventory.bindings);
  const editor = createNativeEditor();
  for (const id of inventory.unboundKnownCommands) assert.ok(editor.adapter.commands.has(id), id);
  for (const platform of ['windows', 'mac', 'linux']) {
    assert.deepEqual(platformBindingInventory(platform), inventory.platforms.filter(binding => binding.platform === platform));
  }
  editor.dispose();
});

test('readonly commands and editing aliases preserve text/history while navigation remains available', async () => {
  const editor = createNativeEditor('alpha\nbeta', { selections: [[0, 5]] });
  editor.setReadOnly(true);
  for (const id of ['Edit.Cut', 'Edit.Paste', 'Edit.Delete', 'Edit.DeleteBackwards', 'Edit.LineDelete', 'Edit.MakeUppercase',
    'Edit.MoveSelectedLinesUp', 'Edit.FormatDocument', 'Edit.Undo', 'Edit.Redo']) {
    assert.equal(await editor.adapter.commands.execute(id), false, id);
    assert.equal(editor.value, 'alpha\nbeta');
  }
  await editor.press('ArrowRight');
  assert.deepEqual(selectionPairs(editor), [[5, 5]]);
  assert.equal(editor.model.undoStack.depth, 0);
  editor.dispose();
});

test('completion filter aliases call the implemented insight API with directions', () => {
  const editor = createNativeEditor();
  const directions = [];
  editor.insights = { changeCompletionFilterLevel: direction => directions.push(direction) };
  editor.adapter.execute('Edit.DecreaseFilterLevel');
  editor.adapter.execute('Edit.IncreaseFilterLevel');
  assert.deepEqual(directions, [-1, 1]);
  editor.dispose();
});
