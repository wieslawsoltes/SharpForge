import test from 'node:test';
import assert from 'node:assert/strict';
import {SettingsStore, settingsKey, settingsDefaults} from '../apps/studio/workbench/settings-store.js';
import {keyboardConflicts, shortcutStroke} from '../apps/studio/workbench/options/keyboard-page.js';
import {ConfigurationManager} from '../apps/studio/workbench/configuration-manager.js';
import {RecentItems} from '../apps/studio/workbench/recent-items.js';
import {Notifications} from '../apps/studio/workbench/notifications.js';
import {FileWatch, readDroppedFiles} from '../apps/studio/workbench/file-watch.js';

function memoryStorage(entries = []) {
  const values = new Map(entries);
  return {values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
}

test('old settings migrate once and corrupt settings notify then recover defaults', () => {
  const storage = memoryStorage([['sharpforge.editor.settings.v1', JSON.stringify({keymap: 'vim', tabSize: 8})]]);
  const settings = new SettingsStore({storage}); settings.load();
  assert.equal(settings.get('environment', 'keymap'), 'vim'); assert.equal(settings.get('editor', 'tabSize'), 8);
  storage.setItem('sharpforge.editor.settings.v1', '{broken');
  assert.equal(new SettingsStore({storage}).load().environment.keymap, 'vim');
  const notices = [];
  storage.setItem(settingsKey, '{broken');
  const corrupt = new SettingsStore({storage, notify: item => notices.push(item)});
  assert.equal(corrupt.load().environment.theme, 'dark'); assert.equal(notices.length, 1);
});

test('settings transaction rejects invalid data and persistence failure before publishing', () => {
  const storage = memoryStorage(), settings = new SettingsStore({storage}); settings.load();
  let events = 0; settings.subscribe(() => events++);
  const before = settings.snapshot();
  assert.throws(() => settings.apply({environment: {theme: 'light'}, editor: {fontSize: 1000}}), RangeError);
  assert.deepEqual(settings.snapshot(), before); assert.equal(events, 0);
  assert.throws(() => settings.apply({keyboard: {bindings: null}}), /type/);
  assert.throws(() => settings.apply({environment: {showStartWindow: 'yes'}}), /type/);
  storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => settings.apply({environment: {theme: 'light'}}), /quota/);
  assert.deepEqual(settings.snapshot(), before); assert.equal(events, 0);
});

test('line-ending normalization stays opt-in across theme changes and rejects invalid settings', () => {
  const settings = new SettingsStore({storage: memoryStorage()});
  settings.load();
  assert.equal(settings.get('editor', 'normalizeLineEndings'), false);
  settings.apply({environment: {theme: 'light'}, editor: {endOfLine: '\r\n'}});
  assert.equal(settings.get('editor', 'normalizeLineEndings'), false);
  settings.apply({editor: {normalizeLineEndings: true}});
  assert.equal(settings.get('editor', 'normalizeLineEndings'), true);
  assert.equal(settings.get('editor', 'endOfLine'), '\r\n');
  assert.throws(() => settings.apply({editor: {normalizeLineEndings: 'yes'}}), /type/);
  assert.throws(() => settings.apply({editor: {endOfLine: 'invalid'}}), /line ending/);
});

test('workspace preferences override user scope and exported profiles omit secrets recursively', () => {
  const settings = new SettingsStore({storage: memoryStorage(), workspaceId: 'a'}); settings.load();
  settings.apply({environment: {theme: 'light'}});
  settings.apply({environment: {theme: 'blue'}}, {scope: 'workspace'});
  assert.equal(settings.get('environment', 'theme'), 'blue');
  settings.apply({layouts: {named: {layout: {password: 'unsafe', networkGrants: ['x'], dock: 'left'}}},
    runtime: {maxSessions: 8, grants: ['example']}});
  const profile = settings.export();
  assert(!profile.includes('unsafe')); assert(!profile.includes('networkGrants')); assert(!profile.includes('example'));
  assert(profile.includes('TODO')); assert(profile.includes('dock'));
  assert.throws(() => settings.previewImport(JSON.stringify({format: 'sharpforge-settings', version: 999, settings: {}})), /Unsupported/);
  const preview = settings.previewImport(JSON.stringify({format: 'sharpforge-settings', version: 2, settings: {editor: {tabSize: 2}}}));
  assert.equal(preview.conflicts[0].key, 'tabSize'); assert.equal(settings.get('editor', 'tabSize'), 4);
});

test('keyboard conflicts include default bindings and distinguish scopes', () => {
  const bindings = [{command: 'comment', keys: ['Ctrl+K', 'Ctrl+C'], scope: 'Text Editor'}];
  assert.equal(keyboardConflicts(bindings, {command: 'custom', keys: 'Ctrl+K Ctrl+C', scope: 'Text Editor'}).length, 1);
  assert.equal(keyboardConflicts(bindings, {command: 'custom', keys: 'Ctrl+K Ctrl+C', scope: 'Designer'}).length, 0);
});

test('keyboard Options shares native chord-prefix conflicts and shifted punctuation notation', () => {
  const bindings = [{id: 'short', command: 'short', keys: 'Ctrl+K', scope: 'Global'},
    {id: 'long', command: 'long', keys: 'Ctrl+R Ctrl+R', scope: 'Text Editor'}];
  assert.equal(keyboardConflicts(bindings, {command: 'custom', keys: 'Control+K Ctrl+C', scope: 'Text Editor'})[0].kind, 'prefix');
  assert.equal(keyboardConflicts(bindings, {command: 'custom', keys: 'Ctrl+R', scope: 'Text Editor'})[0].kind, 'prefix');
  assert.equal(shortcutStroke({key: '{', code: 'BracketLeft', ctrlKey: true, shiftKey: true}), 'Ctrl+Shift+[');
  assert.equal(shortcutStroke({key: '?', code: 'Slash', ctrlKey: true, shiftKey: true}), 'Ctrl+Shift+/');
  assert.equal(shortcutStroke({key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true}), 'Ctrl+Shift+1');
  assert.equal(shortcutStroke({key: 'x', isComposing: true}), null);
  assert.equal(shortcutStroke({key: '@', ctrlKey: true, altKey: true, getModifierState: key => key === 'AltGraph'}), null);
});

test('configuration manager applies release selection only to enabled project mappings', async () => {
  const settings = new SettingsStore({storage: memoryStorage()}); settings.load();
  const applied = [];
  const manager = new ConfigurationManager({settings, projects: () => [{id: 'a', name: 'A'}, {id: 'b', name: 'B'}],
    applyConfiguration: options => applied.push(options)});
  await manager.select('Release', 'Any CPU');
  manager.saveMappings(manager.mappings().map(mapping => ({...mapping, build: mapping.projectId === 'a'})));
  await manager.select('Release', 'Any CPU');
  assert.deepEqual(applied.at(-1).projects.map(mapping => mapping.projectId), ['a']);
  assert.equal(applied.at(-1).projects[0].configuration, 'Release');
  assert.throws(() => manager.saveMappings([{projectId: 'missing', configuration: 'Debug', build: true}]), /Invalid/);
});

test('recent files retain pinning and prune missing sources', async () => {
  const recent = new RecentItems({storage: memoryStorage(), limit: 2});
  recent.add({uri: 'a.cs'}); recent.pin('a.cs'); recent.add({uri: 'b.cs'}); recent.add({uri: 'c.cs'}); recent.add({uri: 'd.cs'});
  assert.deepEqual(recent.list().map(item => item.uri), ['a.cs', 'd.cs', 'c.cs']);
  await recent.prune(item => item.uri !== 'c.cs'); assert.equal(recent.list().length, 2);
});

test('notifications survive toast expiry and unread/dismissal are independent', () => {
  const announced = [];
  const notifications = new Notifications({announce: message => announced.push(message), limit: 2});
  const id = notifications.add({message: 'Build failed', severity: 'error'});
  notifications.add({message: 'Read me'}); notifications.markRead(id);
  assert.equal(notifications.unread, 1); assert.equal(notifications.list().length, 2);
  notifications.dismiss(id); assert.equal(notifications.list().length, 1);
  assert.equal(notifications.list({includeDismissed: true}).length, 2); assert.equal(announced.length, 2);
});

test('external change prompts once per disk version and recovery contains only document data', async () => {
  const file = {uri: 'Program.cs', text: 'old', version: 1, dirty: true, grants: ['secret']};
  const documents = {list: () => [file], get: () => file};
  let disk = 'old'; const notices = [], reloads = [];
  const watch = new FileWatch({documents, storage: memoryStorage(), readDisk: async () => disk,
    reload: (...args) => reloads.push(args), compare() {}, notify: item => notices.push(item), clock: () => 1});
  await watch.poll(); disk = 'new'; await watch.poll(); await watch.poll();
  assert.equal(notices.length, 1); await notices[0].actions[0].run(); assert.equal(reloads[0][1], 'new');
  const snapshot = watch.snapshot(); assert.equal(snapshot.files[0].text, 'old'); assert.equal(snapshot.files[0].grants, undefined);
  assert.equal(watch.recovery().timestamp, 1);
  watch.dispose(); disk = 'newer'; await watch.poll(); assert.equal(notices.length, 1);
});

test('dropped file import bounds count and total bytes', async () => {
  const data = {files: [{name: 'a.cs', size: 8}, {name: 'b.cs', size: 8}]};
  assert.equal((await readDroppedFiles(data)).length, 2);
  await assert.rejects(readDroppedFiles(data, {maxBytes: 10}), /limits/);
});
