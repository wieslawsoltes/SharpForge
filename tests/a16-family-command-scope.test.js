import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionCommandBar, commandBarGeometry } from '../packages/winui-controls/src/commands/geometry.js';
import { TextCommandController } from '../packages/winui-controls/src/commands/text-command.js';
import { TextBuffer } from '../packages/winui-controls/src/text/text-buffer.js';
import { RichTextDocument } from '../packages/winui-controls/src/text/rich-document.js';
import { DataPackage } from '../packages/winui-controls/src/app/data-transfer.js';
import { teachingTipCloseReason } from '../packages/winui-controls/src/overlay/index.js';

test('dynamic overflow preserves collections and moves equal explicit priorities as one group', () => {
  const primary = [{ id: 'a', DynamicOverflowOrder: 2 }, { id: 'b', DynamicOverflowOrder: 1 },
    { id: 'c', DynamicOverflowOrder: 1 }, { id: 'd', DynamicOverflowOrder: 0 }];
  const original = primary.map(item => ({ ...item }));
  const result = partitionCommandBar(primary, 130, () => 50);
  assert.deepEqual(result.primary.map(item => item.id), ['a', 'd']);
  assert.deepEqual(result.overflow.map(item => item.id), ['b', 'c']);
  assert.deepEqual(primary, original);
  assert.deepEqual(partitionCommandBar(primary, 1, () => 50, { enabled: false }).primary, primary);
});

test('default overflow removes from the trailing edge and restores all commands at sufficient width', () => {
  assert.deepEqual(partitionCommandBar(['a', 'b', 'c'], 100, () => 50), { primary: ['a', 'b'], overflow: ['c'], width: 100 });
  assert.deepEqual(partitionCommandBar(['a', 'b', 'c'], 150, () => 50).overflow, []);
  assert.throws(() => partitionCommandBar([{ DynamicOverflowOrder: -1 }], 0, () => 50), error => error.code === 'SFUI1654');
});

test('command geometry reserves the actual overflow button, places rows and clips closed commands', () => {
  const result = commandBarGeometry({ primary: ['a', 'b', 'c'], secondary: ['save'], available: { width: 170, height: 48 },
    properties: { IsOpen: false } }, () => ({ width: 60, height: 32 }));
  assert.deepEqual(result.primary, ['a', 'b']);
  assert.deepEqual(result.overflow, ['c']);
  assert.equal(result.button.width, 40);
  assert.equal(result.rectangles.get('a').overflow, false);
  assert.equal(result.rectangles.get('c').hidden, true);
  assert.equal(result.rectangles.get('save').y, 80);
  const open = commandBarGeometry({ primary: ['a'], secondary: ['save'], available: { width: 170, height: 48 },
    properties: { IsOpen: true } }, () => ({ width: 60, height: 32 }));
  assert.equal(open.rectangles.get('save').hidden, false);
});

test('text command enabled states follow selection, readonly state, history and capability availability', async () => {
  const model = new TextBuffer({ text: 'hello' });
  let readOnly = false;
  const controller = new TextCommandController({ model, clipboard: { available: false }, readOnly: () => readOnly });
  assert.equal(controller.enabled('Copy'), false);
  assert.equal(controller.enabled('Paste'), false);
  assert.equal(controller.enabled('Delete'), false);
  await controller.execute('SelectAll');
  assert.equal(model.selectedText, 'hello');
  assert.equal(controller.enabled('Delete'), true);
  readOnly = true;
  assert.equal(controller.enabled('Delete'), false);
  assert.equal((await controller.execute('Delete')).reason, 'command-disabled');
  controller.dispose();
});

test('cut preserves the selected text after clipboard refusal and applies one undoable edit after approval', async () => {
  const model = new TextBuffer({ text: 'first second' }); model.select(6, 6);
  let allowed = false, copied;
  const clipboard = { async setContent(value) { copied = value.get('Text'); return { ok: allowed, reason: 'permission-denied' }; } };
  const controller = new TextCommandController({ model, clipboard });
  assert.equal((await controller.execute('Cut')).ok, false);
  assert.equal(model.text, 'first second');
  allowed = true;
  assert.equal((await controller.execute('Cut')).ok, true);
  assert.equal(copied, 'second');
  assert.equal(model.text, 'first ');
  assert.equal(model.canUndo, true);
  assert.equal((await controller.execute('Undo')).ok, true);
  assert.equal(model.text, 'first second');
});

test('paste waits for cancellable edit approval and rejects stale clipboard selection without loss', async () => {
  const model = new TextBuffer({ text: 'old' }); model.selectAll();
  const data = new DataPackage(); data.setText('new');
  let approve = false;
  const clipboard = { async getContent() { return { ok: true, data }; } };
  const controller = new TextCommandController({ model, clipboard, beforeEdit: async () => approve });
  assert.equal((await controller.execute('Paste')).reason, 'cancelled');
  assert.equal(model.text, 'old');
  approve = true;
  assert.equal((await controller.execute('Paste')).ok, true);
  assert.equal(model.text, 'new');
  clipboard.getContent = async () => { model.select(0); return { ok: true, data }; };
  assert.equal((await controller.execute('Paste')).reason, 'selection-changed');
  assert.equal(model.text, 'new');
});

test('the text flyout honors Paste before reading the clipboard or mutating history', async () => {
  const model = new TextBuffer({ text: 'unchanged' });
  model.selectAll();
  let reads = 0;
  const controller = new TextCommandController({ model, beforePaste: async () => false,
    clipboard: { getContent() { reads++; throw new Error('Canceled paste must not read clipboard data'); } } });
  assert.equal((await controller.execute('Paste')).reason, 'cancelled');
  assert.equal(reads, 0);
  assert.equal(model.text, 'unchanged');
  assert.equal(model.undoStack.length, 0);
  controller.dispose();
});

test('rich text cut preserves unselected formatting and paste inserts plain clipboard text without HTML execution', async () => {
  const model = new RichTextDocument('bold plain');
  model.select(0, 4); model.formatSelection({ bold: true }); model.select(5, 5);
  const data = new DataPackage(); data.setText('<script>plain text</script>');
  const controller = new TextCommandController({ model, clipboard: { getContent: async () => ({ ok: true, data }) } });
  await controller.execute('Paste');
  assert.equal(model.text, 'bold <script>plain text</script>');
  assert.equal(model.runs[0].format.bold, true);
});

test('teaching tip maps close button, light dismiss and programmatic outcomes to native enum values', () => {
  assert.equal(teachingTipCloseReason('Close'), 0);
  assert.equal(teachingTipCloseReason('light-dismiss'), 1);
  assert.equal(teachingTipCloseReason('escape'), 1);
  assert.equal(teachingTipCloseReason('programmatic'), 2);
});
