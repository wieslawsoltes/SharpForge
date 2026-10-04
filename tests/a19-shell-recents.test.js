import test from 'node:test';
import assert from 'node:assert/strict';
import {RecentItems} from '../apps/studio/workbench/recent-items.js';
import {createRecentWorkspaces, recentWorkspaceItem, restoreRecentWorkspace} from '../apps/studio/workbench/recent-workspaces.js';

const currentMetadata = {name: 'Current', entry: 'Current.csproj', mode: 'project'};

function recovery() {
  return {format: 'sharpforge-project', version: 1, name: 'Restored', entry: 'App.csproj', mode: 'project',
    configuration: 'Release', startupProject: 'App.csproj', folders: ['src'], active: 'src/Program.cs', tabs: ['src/Program.cs'],
    diskRecords: [{path: 'App.csproj', text: '<Project />', encoding: 'utf-8', bom: true},
      {path: 'src/Program.cs', text: 'old', originalText: 'old', encoding: 'utf-16le', bom: true},
      {path: 'image.bin', base64: 'AAEC/w=='}],
    files: [{uri: 'src/Program.cs', text: 'unsaved', version: 8}]};
}

test('recent workspace remembering retains metadata and never enumerates source or disk records', () => {
  const recent = new RecentItems();
  const metadata = {...currentMetadata, get files() { throw new Error('Snapshot copied sources'); },
    get diskRecords() { throw new Error('Snapshot copied records'); }};
  const manager = createRecentWorkspaces({recent, getCurrent: () => metadata});
  const item = manager.remember();
  assert.equal(item.kind, 'project');
  assert.equal(item.label, 'Current');
  assert.equal(recent.list('project').length, 1);
  assert.deepEqual(Object.keys(recent.list()[0]).sort(), ['kind', 'label', 'pinned', 'uri', 'workspaceId']);
  assert.equal(recentWorkspaceItem({name: 'Sample', sampleId: 'arrays'}).uri, 'sample:arrays');
});

test('opening the current workspace activates it without reading recovery or requiring permission', async () => {
  const recent = new RecentItems();
  let activated = 0;
  const manager = createRecentWorkspaces({recent, getCurrent: () => currentMetadata,
    activateCurrent: () => { activated++; }, readRecovery() { throw new Error('Unexpected recovery read'); }});
  assert.equal(await manager.open(recentWorkspaceItem(currentMetadata)), true);
  assert.equal(activated, 1);
});

test('recovery preparation preserves file bytes, encoding, BOM and unsaved source metadata', async () => {
  const payload = recovery();
  const result = await restoreRecentWorkspace(payload);
  const source = result.records.find(record => record.path === 'src/Program.cs');
  assert.equal(source.text, 'unsaved');
  assert.equal(source.encoding, 'utf-16le');
  assert.equal(source.bom, true);
  assert.equal(source.originalText, 'old');
  assert.equal(source.version, 8);
  const binary = result.records.find(record => record.path === 'image.bin');
  assert.equal(binary.base64, 'AAEC/w==');
  assert.deepEqual([...binary.bytes], [0, 1, 2, 255]);
  assert.equal(payload.diskRecords[1].text, 'old');
  assert.equal(payload.diskRecords[2].bytes, undefined);
  assert.equal(result.options.configuration, 'Release');
  assert.equal(result.options.startup, 'App.csproj');
  assert.equal(result.options.settings.active, 'src/Program.cs');
});

test('recent opening uses the matching previous recovery and confirms actual workspace identity', async () => {
  const payload = recovery();
  const item = recentWorkspaceItem(payload);
  const recent = new RecentItems();
  const slots = [];
  let current = currentMetadata;
  const manager = createRecentWorkspaces({recent, getCurrent: () => current,
    readRecovery: slot => { slots.push(slot); return slot === 'previous' ? payload : null; },
    openRecords: (records, options) => {
      assert.equal(records.length, 3);
      assert.equal(options.entry, 'App.csproj');
      current = {...options, name: options.name};
    }});
  assert.equal(await manager.open(item), true);
  assert.deepEqual(slots, ['workspace', 'previous']);
  assert.equal(recent.list('project')[0].uri, item.uri);
});

test('samples require a provider-confirmed open instead of treating an unchanged workspace as success', async () => {
  const recent = new RecentItems();
  const item = recentWorkspaceItem({name: 'Arrays', sampleId: 'arrays'});
  const unavailable = createRecentWorkspaces({recent, getCurrent: () => currentMetadata, loadSample() {}});
  await assert.rejects(unavailable.open(item), /did not confirm/);
  assert.equal(recent.list().length, 0);
  const opened = createRecentWorkspaces({recent, getCurrent: () => currentMetadata,
    loadSample: id => { assert.equal(id, 'arrays'); return {opened: true}; }});
  assert.equal(await opened.open(item), true);
  assert.equal(recent.list()[0].uri, 'sample:arrays');
});

test('missing recent files request permission explicitly and cancellation preserves the pinned MRU', async () => {
  const recent = new RecentItems();
  const item = recentWorkspaceItem({name: 'Missing', entry: 'Missing.csproj'});
  recent.add(item);
  recent.pin(item.uri);
  let request;
  const manager = createRecentWorkspaces({recent, getCurrent: () => currentMetadata, readRecovery: () => null,
    openFolder: (target, options) => { request = {target, options}; return false; }});
  await assert.rejects(manager.open(item), {name: 'AbortError'});
  assert.equal(request.target, item);
  assert.equal(request.options.reason, 'permission-required');
  assert.equal(recent.list()[0].pinned, true);
  const unavailable = createRecentWorkspaces({recent, getCurrent: () => currentMetadata});
  await assert.rejects(unavailable.open(item), /grant file access/);
});

test('recovery bounds, corrupt data and cancelled providers fail before recent success is published', async () => {
  await assert.rejects(restoreRecentWorkspace({...recovery(), version: 2}), /format/);
  await assert.rejects(restoreRecentWorkspace({...recovery(), diskRecords: [{path: '../escape.cs', text: 'x'}]}), /Parent/);
  const invalid = recovery();
  invalid.diskRecords[2].base64 = '???=';
  await assert.rejects(restoreRecentWorkspace(invalid), /base64/);
  await assert.rejects(restoreRecentWorkspace({...recovery(), files: Array(20001).fill({uri: 'a.cs', text: ''})}), /limit/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(restoreRecentWorkspace(recovery(), {signal: controller.signal}), {name: 'AbortError'});
  const recent = new RecentItems();
  let calls = 0;
  const manager = createRecentWorkspaces({recent, getCurrent: () => currentMetadata, openFolder: () => { calls++; return true; }});
  await assert.rejects(manager.open(recentWorkspaceItem(recovery()), {signal: controller.signal}), {name: 'AbortError'});
  assert.equal(calls, 0);
  assert.equal(recent.list().length, 0);
});
