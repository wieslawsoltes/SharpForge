import test from 'node:test';
import assert from 'node:assert/strict';
import { createItemPlan } from '@sharpforge/templates';
import { DesignDocument } from '@sharpforge/designer';
import { DesignerSourceSync } from '../apps/studio/designer-source-sync.js';
import { createDesignerMarkupServices } from '../apps/studio/designer/markup-services.js';

function host() {
  const plan = createItemPlan('winui-xaml-page', { name: 'View.xaml', namespace: 'Example' });
  const records = new Map(plan.records.map(record => [record.path, record]));
  const state = { revision: 1, readOnly: false };
  const writes = [];
  const view = { state, document: null, ensure() {}, sourceFiles: () => [], records: () => [...records.values()],
    replace(value) { this.document = new DesignDocument(value); },
    ...createDesignerMarkupServices({ state, records: () => [...records.values()], async perform(operations) {
      for (const operation of operations) {
        assert.equal(records.get(operation.path).text, operation.expectedText);
        records.set(operation.path, { ...records.get(operation.path), text: operation.text });
        writes.push(operation);
      }
      state.revision++;
    } }) };
  const sync = new DesignerSourceSync(view);
  view.sourceSync = sync;
  sync.setAuto(false);
  return { records, state, writes, view, sync };
}

test('XAML source-format services commit exact workspace records and leave code-behind unchanged', async () => {
  const { records, state, writes, view, sync } = host();
  const behind = records.get('View.xaml.cs').text;
  await sync.connect('View.xaml');
  assert.equal(sync.snapshot().format, 'xaml');
  const label = view.document.value.nodes.find(node => node.type.endsWith('.TextBlock')).id;
  view.document.setProperty('Text', 'Edited from designer', [label]);
  await sync.write();
  assert.equal(sync.dirty(), false);
  assert.equal(writes.length, 1);
  assert(records.get('View.xaml').text.includes('Edited from designer'));
  assert.equal(records.get('View.xaml.cs').text, behind);
  await sync.editText(records.get('View.xaml').text.replace('Edited from designer', 'Edited source'));
  await sync.read();
  assert(view.document.value.nodes.some(node => node.properties.Text === 'Edited source'));
  state.readOnly = true;
  await assert.rejects(() => sync.editText('invalid'), /Stop debugging/);
  sync.dispose();
});

test('XAML source-format services refuse conflicts, stale editor versions and host validation races', async () => {
  const { records, state, writes, view, sync } = host();
  await sync.connect('View.xaml');
  const label = view.document.value.nodes.find(node => node.type.endsWith('.TextBlock')).id;
  view.document.setProperty('Text', 'Staged', [label]);
  records.get('View.xaml').text += '\n';
  await assert.rejects(() => sync.write(), /changed/);
  assert.equal(writes.length, 0);
  await sync.read({ discardDesign: true });
  await assert.rejects(() => sync.editText('invalid', { expectedVersion: state.revision - 1 }), /changed/);
  const plan = sync.session.plan(view.document.value);
  await assert.rejects(() => view.applyMarkupSourceEdits('View.xaml', plan, state.revision, () => { throw new Error('race'); }), /race/);
  assert.equal(writes.length, 0);
  sync.dispose();
});
