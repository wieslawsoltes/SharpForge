import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceLoader } from '../packages/winui-controls/src/app/resources.js';
import { ResourceManager } from '../packages/winui-controls/src/app/resource-manager.js';
import { importResw, languageFallbacks } from '../packages/winui-controls/src/app/resw.js';
import { DataPackage, ClipboardService, LauncherService } from '../packages/winui-controls/src/app/data-transfer.js';
import { HostPermissionPolicy } from '../packages/winui-controls/src/policy/capabilities.js';

test('resource UIDs update on language changes and lease rewind does not replay setters', () => {
  const loader = new ResourceLoader({ language: 'en-US', resources: {
    'en-US': { 'Save.Content': 'Save', 'Save.ToolTip': 'Save file', fallback: 'default' },
    de: { 'Save.Content': 'Speichern' }, 'de-DE': { 'Save.ToolTip': 'Datei speichern' } } });
  const values = [];
  const owner = { id: 'owner' };
  const lease = loader.bindUid('Save', (property, value) => values.push([property, value]), { retainedValues: () => [owner] });
  assert.deepEqual(values, [['Content', 'Save'], ['ToolTip', 'Save file']]);
  const active = lease.snapshot();
  loader.setLanguage('de-DE');
  assert.deepEqual(values.slice(-2), [['Content', 'Speichern'], ['ToolTip', 'Datei speichern']]);
  assert.equal(loader.getString('fallback'), 'default');
  assert.equal(loader.getString('missing'), '');
  lease.dispose();
  const count = values.length;
  loader.setLanguage('en-US');
  lease.restore(active);
  assert.equal(values.length, count);
  assert.deepEqual([...lease.retainedValues()], [owner]);
  assert.deepEqual(languageFallbacks('zh-Hant-TW'), ['zh-Hant-TW', 'zh-Hant', 'zh']);
});

test('resource contexts isolate language and subtree lookup from the application override', () => {
  const loader = new ResourceLoader({ resources: { 'en-US': { 'Page/Title': 'Hello' }, de: { 'Page/Title': 'Hallo' } } });
  const manager = new ResourceManager(loader);
  const context = manager.createResourceContext();
  context.setLanguage('de');
  assert.equal(manager.mainResourceMap.getSubtree('Page').getValue('Title', context).ValueAsString, 'Hallo');
  assert.equal(loader.language, 'en-US');
  assert.throws(() => context.setQualifier('Scale', '200'), error => error.code === 'SFUI1694');
  assert.throws(() => manager.mainResourceMap.getValue('absent'), error => error.code === 'SFUI1695');
  assert.throws(() => manager.mainResourceMap.getSubtree('../outside'), error => error.code === 'SFUI1694');
});

test('.resw import handles escaped and CDATA strings and rejects external entities and duplicates', () => {
  const source = '<?xml version="1.0"?><root><data name="A.Content"><value>Hello &amp; world</value></data>'
    + '<data name="B.Text"><value><![CDATA[<literal><!-- text -->]]></value></data></root>';
  const values = importResw(source);
  assert.equal(values['A.Content'], 'Hello & world');
  assert.equal(values['B.Text'], '<literal><!-- text -->');
  assert.throws(() => importResw('<!DOCTYPE root SYSTEM "file:///secret"><root></root>'), error => error.code === 'SFUI1693');
  assert.throws(() => importResw('<root><data name="a"><value>1</value></data><data name="a"><value>2</value></data></root>'));
  assert.throws(() => importResw('<root><data name="a"><value>&unknown;</value></data></root>'));
  assert.throws(() => importResw(source, { maximumEntries: 1 }));
});

test('data packages keep bounded strings and opaque drop formats in immutable view snapshots', () => {
  const data = new DataPackage({ maximumBytes: 12, externalFormats: ['StorageItems'] });
  const changes = [];
  data.onChanged = snapshot => changes.push(snapshot);
  data.setText('abc');
  data.setHtml('xyz');
  assert.throws(() => data.setUri('a'), error => error.code === 'SFUI1691');
  data.RequestedOperation = 3;
  assert.equal(changes.at(-1).requestedOperation, 3);
  assert.equal(data.contains('StorageItems'), true);
  const snapshot = data.snapshot();
  const view = new DataPackage();
  view.restore(snapshot);
  data.setText('new');
  assert.equal(view.get('Text'), 'abc');
  assert.deepEqual(view.externalFormats, ['StorageItems']);
  assert.throws(() => data.setExternalFormats(['FileHandles']), error => error.code === 'SFUI1690');
  assert.throws(() => { data.RequestedOperation = 8; }, error => error.code === 'SFUI1690');
});

test('clipboard denial does not call the backend and supported writes report actual outcomes', async () => {
  let writes = 0;
  const backend = { writeText: async text => { writes++; assert.equal(text, 'hello'); } };
  const data = new DataPackage();
  data.setText('hello');
  const denied = new ClipboardService({ policy: new HostPermissionPolicy(), clipboard: backend });
  assert.deepEqual(await denied.setContent(data), { ok: false, reason: 'permission-denied' });
  assert.equal(writes, 0);
  const allowed = new ClipboardService({ policy: new HostPermissionPolicy({ request: async () => true }), clipboard: backend });
  assert.deepEqual(await allowed.setContent(data), { ok: true });
  assert.equal(writes, 1);
  const files = new DataPackage({ externalFormats: ['StorageItems'] });
  assert.deepEqual(await allowed.setContent(files), { ok: false, reason: 'unsupported-format' });
});

test('launcher policy requires origin and permission grants and preserves noopener intent', async () => {
  const opened = [];
  const policy = new HostPermissionPolicy({ origins: ['https://example.test'], request: async () => true });
  const launcher = new LauncherService({ policy, open: async (uri, options) => { opened.push([uri, options]); return true; } });
  assert.equal(await launcher.launchUri('https://example.test/path'), true);
  assert.equal(opened[0][1].features, 'noopener,noreferrer');
  assert.equal(await launcher.launchUri('https://ungranted.test/path'), false);
  assert.equal(await launcher.launchUri('javascript:alert(1)'), false);
  assert.equal(opened.length, 1);
});
