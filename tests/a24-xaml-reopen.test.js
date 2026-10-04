import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWorkspaceFile } from '@sharpforge/archive';
import { createProjectPlan } from '@sharpforge/templates';
import { DesignDocument } from '@sharpforge/designer';
import { exportWorkspaceZip, importWorkspaceZip, importWorkspaceZipFromBlob,
  readProviderDirectory, writeNewDirectory } from '@sharpforge/project-system';
import { DesignerSourceSync } from '../apps/studio/designer-source-sync.js';
import { createDesignerMarkupServices } from '../apps/studio/designer/markup-services.js';
import { TestDirectory } from './helpers/a24-directory.js';

function designer(records) {
  const files = new Map(records.map(record => [record.path, record]));
  const state = { revision: 1, readOnly: false };
  const view = {
    state, document: null, ensure() {}, sourceFiles: () => [], records: () => [...files.values()],
    replace(value) { this.document = new DesignDocument(value); },
    ...createDesignerMarkupServices({ state, records: () => [...files.values()], async perform(operations) {
      for (const operation of operations) {
        const previous = files.get(operation.path);
        assert.equal(previous.text, operation.expectedText);
        files.set(operation.path, { ...previous, text: operation.text, version: (previous.version ?? state.revision) + 1 });
      }
      state.revision++;
    } })
  };
  const sync = new DesignerSourceSync(view);
  view.sourceSync = sync;
  sync.setAuto(false);
  return { view, sync, files };
}

const reopen = [
  ['ZIP', async snapshot => importWorkspaceZip(exportWorkspaceZip(snapshot, { compression: 'deflate' }))],
  ['Blob ZIP', async snapshot => importWorkspaceZipFromBlob(new Blob([
    exportWorkspaceZip(snapshot, { compression: 'deflate', forceZip64: true })
  ]))],
  ['selected folder', async snapshot => {
    const directory = new TestDirectory();
    await writeNewDirectory(directory, snapshot);
    return readProviderDirectory(directory);
  }]
];

for (const [transport, open] of reopen) {
  test('Generated XAML reconnects to the designer after ' + transport + ' reopening and another export', async () => {
    const plan = createProjectPlan('winui-native-packaged', { projectName: 'Reopened' });
    const records = plan.records.map(record => /\.(xaml|manifest|appxmanifest)$/i.test(record.path) ? {
      ...record, text: record.text.replace('encoding="utf-8"', 'encoding="utf-16"').replaceAll('\n', '\r\n'),
      encoding: 'utf-16be', bom: true
    } : record);
    const source = records.find(record => record.path.endsWith('/MainWindow.xaml'));
    assert(source);
    const codeBehind = records.find(record => record.path === source.path + '.cs');
    const loaded = await open({ records, folders: plan.folders,
      settings: { name: plan.name, entry: plan.entry, startup: plan.startup } });
    for (const original of records.filter(record => /\.(xaml|manifest|appxmanifest)$/i.test(record.path))) {
      const restored = loaded.records.find(record => record.path === original.path);
      assert.equal(restored.text, original.text, original.path);
      assert.equal(restored.encoding, 'utf-16be');
      assert.equal(restored.bom, true);
      assert.deepEqual(encodeWorkspaceFile(restored), encodeWorkspaceFile(original));
    }
    const logo = records.find(record => record.path.endsWith('.png'));
    const restoredLogo = loaded.records.find(record => record.path === logo.path);
    assert.equal(restoredLogo.text, undefined);
    assert.deepEqual(restoredLogo.bytes, logo.bytes);

    const first = designer(loaded.records);
    try {
      await first.sync.connect(source.path);
      assert.equal(first.sync.snapshot().format, 'xaml');
      assert.equal(first.sync.snapshot().state, 'synced');
      const caption = first.view.document.value.nodes.find(node => node.type.endsWith('.TextBlock'));
      first.view.document.setProperty('Text', 'Restored design λ', [caption.id]);
      await first.sync.write();
      assert.equal(first.files.get(codeBehind.path).text, codeBehind.text);

      const again = importWorkspaceZip(exportWorkspaceZip({ records: [...first.files.values()], folders: loaded.folders }));
      const edited = again.records.find(record => record.path === source.path);
      assert.equal(edited.encoding, 'utf-16be');
      assert.equal(edited.bom, true);
      assert(edited.text.includes('Restored design λ'));
      assert(edited.text.includes('\r\n'));
      const second = designer(again.records);
      try {
        await second.sync.connect(source.path);
        assert.equal(second.sync.snapshot().state, 'synced');
        assert(second.view.document.value.nodes.some(node => node.properties.Text === 'Restored design λ'));
        assert.equal(second.files.get(codeBehind.path).text, codeBehind.text);
      } finally { second.sync.dispose(); }
    } finally { first.sync.dispose(); }
  });
}
