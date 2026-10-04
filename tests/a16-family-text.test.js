import test from 'node:test';
import assert from 'node:assert/strict';
import { TextBuffer } from '../packages/winui-controls/src/text/text-buffer.js';
import { PasswordBuffer, redactPasswordProperties } from '../packages/winui-controls/src/text/passwordbox.js';
import { RichTextDocument } from '../packages/winui-controls/src/text/rich-document.js';
import { fontFamilySource, typographyFeatures } from '../packages/winui-controls/src/text/typography.js';

test('UTF-16 text selection preserves emoji and does not truncate a surrogate pair', () => {
  const model = new TextBuffer({ text: 'a😀b', maximumLength: 3 });
  assert.equal(model.text, 'a😀');
  model.select(1, 2);
  assert.equal(model.selectedText, '😀');
  model.insert('é');
  assert.equal(model.text, 'aé');
  assert.equal(model.selectionStart, 2);
  assert.throws(() => model.select(2, 1), error => error.code === 'SFUI1601');
  assert.equal(new TextBuffer({ text: 'a😀', maximumLength: 2 }).text, 'a');
});

test('typing groups, undo/redo and snapshots restore the authoritative editing history', () => {
  let now = 0;
  const model = new TextBuffer({ now: () => now });
  model.insert('a', { reason: 'user' });
  now = 50;
  model.insert('b', { reason: 'user' });
  assert.equal(model.undoStack.length, 1);
  now = 1500;
  model.insert('c', { reason: 'user' });
  assert.equal(model.undoStack.length, 2);
  model.undo();
  const snapshot = model.snapshot();
  assert.equal(model.text, 'ab');
  model.insert('future');
  model.restore(snapshot);
  assert.equal(model.text, 'ab');
  assert.equal(model.canRedo, true);
  model.redo();
  assert.equal(model.text, 'abc');
  model.undo();
  model.undo();
  assert.equal(model.text, '');
});

test('IME commits once, cancellation keeps text and composition survives rewind', () => {
  const model = new TextBuffer({ text: 'before' });
  model.selectAll();
  const changes = [];
  model.on('TextChanged', args => changes.push(args));
  model.beginComposition();
  model.updateComposition('に');
  const snapshot = model.snapshot();
  model.endComposition('日本');
  assert.equal(model.text, '日本');
  assert.equal(changes.length, 1);
  assert.equal(model.undoStack.length, 1);
  model.restore(snapshot);
  assert.equal(model.text, 'before');
  assert.equal(model.composition.text, 'に');
  model.endComposition('', { cancelled: true });
  assert.equal(model.text, 'before');
  assert.equal(changes.length, 1);
});

test('read-only, cancellation, casing and history limits apply before mutation', () => {
  const model = new TextBuffer({ historyLimit: 2, characterCasing: 2 });
  model.on('BeforeTextChanging', args => { if (args.NewText.includes('!')) args.Cancel = true; });
  model.replace('first');
  model.replace('second');
  model.replace('third');
  assert.equal(model.text, 'THIRD');
  assert.equal(model.undoStack.length, 2);
  assert.equal(model.replace('!'), false);
  assert.equal(model.text, 'THIRD');
  model.readOnly = true;
  assert.equal(model.insert('x'), false);
  assert.equal(model.undo(), false);
  assert.equal(model.beginComposition(), false);
  assert.equal(model.replace('programmatic', { force: true }), true);
});

test('password events and JSON never contain secret text and disposal erases storage', () => {
  const model = new PasswordBuffer({ maximumLength: 3 });
  const events = [];
  model.on('PasswordChanging', args => events.push(args));
  model.on('PasswordChanged', args => events.push(args));
  model.set('a😀x');
  assert.equal(model.read(), 'a😀');
  assert.equal(model.length, 3);
  assert.equal(JSON.stringify({ model, events }).includes('a😀'), false);
  assert.deepEqual(redactPasswordProperties('Microsoft.UI.Xaml.Controls.PasswordBox',
    { Password: 'secret', SelectedText: 'secret', Header: 'Password' }), { Header: 'Password', PasswordRedacted: true });
  model.dispose();
  assert.equal(model.read(), '');
  assert.throws(() => new PasswordBuffer({ maximumLength: -1 }));
});

test('rich document formatting and Unicode RTF roundtrip preserve visible content', () => {
  const model = new RichTextDocument('Hello 😀\nworld');
  model.select(0, 5);
  model.formatSelection({ bold: true, italic: true, size: 18, foreground: '#123456' });
  const other = new RichTextDocument();
  other.setText(model.getText('rtf'), 'rtf');
  assert.equal(other.text, model.text);
  assert.equal(other.runs[0].format.bold, true);
  assert.equal(other.runs[0].format.size, 18);
  const snapshot = model.snapshot();
  model.select(6, 2);
  model.replaceSelection('X');
  assert.equal(model.text, 'Hello X\nworld');
  model.restore(snapshot);
  assert.equal(model.text, 'Hello 😀\nworld');
});

test('RTF rejects embedded destinations and unsupported formatting with diagnostics', () => {
  const model = new RichTextDocument();
  for (const text of ['{\\rtf1{\\pict data}}', '{\\rtf1{\\object data}}', '{\\rtf1\\unknown value}']) {
    assert.throws(() => model.setText(text, 'rtf'), error => error.code === 'SFUI1629');
  }
  assert.throws(() => model.setText('{\\rtf1 unbalanced', 'rtf'), error => error.code === 'SFUI1628');
  assert.throws(() => model.formatSelection({ backgroundImage: 'url(x)' }), error => error.code === 'SFUI1625');
  assert.throws(() => model.formatSelection({ size: -1 }), error => error.code === 'SFUI1626');
});

test('typography maps native capitals and numeral style to explicit OpenType features', () => {
  assert.deepEqual(typographyFeatures({ 'Typography.Capitals': 1, 'Typography.NumeralStyle': 2 }),
    ['"c2sc" 1', '"smcp" 1', '"onum" 1']);
  assert.match(fontFamilySource('Segoe UI'), /system-ui/);
  assert.match(fontFamilySource({ Source: 'Segoe Fluent Icons' }), /Segoe MDL2 Assets/);
  assert.throws(() => fontFamilySource('url(https://invalid/font)'), error => error.code === 'SFUI1641');
  assert.throws(() => typographyFeatures({ 'Typography.Capitals': 50 }), error => error.code === 'SFUI1641');
});
