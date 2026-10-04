import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesign, designScene, DesignerAppSessions, LiveDesignAttachment} from '@sharpforge/designer';
import {designerAttachmentItems, chooseDesignerAttachment} from '../apps/studio/designer-live-picker.js';
import {DesignerLiveSelection} from '../apps/studio/designer-live-selection.js';
import {DesignDocument} from '@sharpforge/designer';

function app(sessions, sessionId, generation = 1) {
  const calls = [];
  let revision = 0;
  const scene = designScene(createDesign('App ' + sessionId));
  const request = async (method, parameters) => {
    calls.push({method, parameters});
    if (method === 'designSnapshot') return {scene, revision};
    if (method === 'hotReload') return {codeVersion: parameters.expectedVersion + 1};
    if (method === 'applyDesign') return {
      revision: ++revision, bindings: parameters.patch.bindings, commands: parameters.patch.commands.length
    };
    throw new Error('Unexpected request ' + method);
  };
  sessions.register({sessionId, generation, request, uiActive: true, state: 'paused', projectName: 'Project ' + sessionId,
    windowTitle: 'Window ' + sessionId, codeVersion: 0, compile: async () => ({success: true, image: {name: sessionId}})});
  return {calls, request, scene};
}

test('picker lists each active app and cancel leaves both sessions untouched', async () => {
  const sessions = new DesignerAppSessions();
  const first = app(sessions, 'first');
  const second = app(sessions, 'second');
  const items = designerAttachmentItems(sessions);
  assert.equal(items.length, 2);
  assert.match(items[0].label, /Project first.*Session first.*Window first/);
  const chosen = await chooseDesignerAttachment({choose: async () => items[1].label}, sessions);
  assert.equal(chosen.sessionId, 'second');
  assert.equal(await chooseDesignerAttachment({choose: async () => null}, sessions), null);
  assert.equal(first.calls.length + second.calls.length, 0);
});

test('snapshot and scene patch dispatch only through the chosen app channel', async () => {
  const sessions = new DesignerAppSessions();
  const first = app(sessions, 'first');
  const second = app(sessions, 'second');
  const attachment = new LiveDesignAttachment(sessions);
  const {document} = await attachment.attach('second');
  const button = document.nodes.find(node => node.runtimeId === 'action');
  button.properties.Width = 222;
  const result = await attachment.apply(document);
  assert.equal(result.revision, 1);
  assert.equal(first.calls.length, 0);
  assert.deepEqual(second.calls.map(call => call.method), ['designSnapshot', 'applyDesign']);
  assert(second.calls.every(call => call.parameters.sessionId === 'second' && call.parameters.sessionGeneration === 1));
  assert.equal(second.calls[1].parameters.expectedRevision, 0);
});

test('a restarted app rejects stale attachment without sending any request to its replacement', async () => {
  const sessions = new DesignerAppSessions();
  app(sessions, 'same', 1);
  const attachment = new LiveDesignAttachment(sessions);
  const {document} = await attachment.attach('same');
  const replacement = app(sessions, 'same', 2);
  await assert.rejects(attachment.apply(document), {code: 'SFDL0001'});
  assert.equal(replacement.calls.length, 0);
});

test('late snapshots after restart and cancellation never become the active attachment', async () => {
  const sessions = new DesignerAppSessions();
  let complete;
  sessions.register({sessionId: 7, generation: 1, uiActive: true, request: () => new Promise(resolve => { complete = resolve; })});
  const attachment = new LiveDesignAttachment(sessions);
  const pending = attachment.attach(7);
  app(sessions, 7, 2);
  complete({scene: designScene(createDesign()), revision: 0});
  await assert.rejects(pending, {code: 'SFDL0001'});
  assert.equal(attachment.target, null);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(attachment.attach(7, {signal: controller.signal}), {name: 'AbortError'});
  attachment.dispose();
  await assert.rejects(attachment.attach(7), {code: 'SFDL0005'});
});

test('source write, compilation, hot reload and scene patch all retain the selected session identity', async () => {
  const sessions = new DesignerAppSessions();
  const other = app(sessions, 'other');
  const selected = app(sessions, 'selected');
  const attachment = new LiveDesignAttachment(sessions);
  const {document} = await attachment.attach('selected');
  document.nodes.find(node => node.runtimeId === 'action').properties.Content = 'Updated';
  const writes = [];
  const result = await attachment.hotReload(document, {writeSource: async identity => writes.push(identity)});
  assert.equal(writes[0].sessionId, 'selected');
  assert.equal(result.sourceWritten, true);
  assert.equal(result.codeVersion, 1);
  assert.deepEqual(selected.calls.map(call => call.method), ['designSnapshot', 'hotReload', 'applyDesign']);
  assert.equal(other.calls.length, 0);
});

test('failed Hot Reload compile reports source-write state and leaves running app requests unchanged', async () => {
  const sessions = new DesignerAppSessions();
  const selected = app(sessions, 'selected');
  const attachment = new LiveDesignAttachment(sessions);
  const {document} = await attachment.attach('selected');
  await assert.rejects(attachment.hotReload(document, {
    writeSource: async () => {}, compile: async () => ({success: false, diagnostics: [{code: 'CS1002'}]})
  }), error => error.code === 'SFDL0008' && error.sourceWritten && !error.codeApplied);
  assert.deepEqual(selected.calls.map(call => call.method), ['designSnapshot']);
});

test('two attached designers round-trip Live Visual Tree selection without cross-app feedback', async () => {
  const sessions = new DesignerAppSessions();
  app(sessions, 'a');
  app(sessions, 'b');
  const a = new LiveDesignAttachment(sessions);
  const b = new LiveDesignAttachment(sessions);
  const viewA = {document: new DesignDocument((await a.attach('a')).document)};
  const viewB = {document: new DesignDocument((await b.attach('b')).document)};
  const bridgeA = new DesignerLiveSelection(viewA, a);
  const bridgeB = new DesignerLiveSelection(viewB, b);
  const buttonA = viewA.document.value.nodes.find(node => node.runtimeId === 'action').id;
  viewA.document.select(buttonA);
  bridgeA.fromDesigner();
  assert.deepEqual(sessions.get('a').selection, ['action']);
  assert.deepEqual(sessions.get('b').selection, []);
  sessions.select('b', 1, ['title'], {fromTree: true});
  assert.equal(viewB.document.node().runtimeId, 'title');
  assert.equal(viewA.document.node().runtimeId, 'action');
  bridgeA.dispose();
  bridgeB.dispose();
  sessions.select('b', 1, ['action'], {fromTree: true});
  assert.equal(viewB.document.node().runtimeId, 'title');
});

test('registry rejects channel replacement, malformed identities and selection overflow', () => {
  const sessions = new DesignerAppSessions({limit: 1});
  app(sessions, 'a');
  assert.throws(() => app(sessions, 'a'), /channel cannot change/);
  assert.throws(() => app(sessions, 'b'), /limit/);
  assert.throws(() => sessions.register({sessionId: NaN, generation: 1, request() {}}), /Invalid numeric/);
  assert.throws(() => sessions.select('a', 1, new Array(1001).fill('x')), /invalid runtime/);
  sessions.dispose();
  assert.throws(() => sessions.resolve('a', 1), {code: 'SFDL0005'});
});
