import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignDocument, DesignerAppSessions, LiveDesignAttachment, bindLinkedLiveDesign,
  createDesign, designFromScene, designScene
} from '@sharpforge/designer';
import {DesignerLiveAttachment} from '../apps/studio/designer-live-attachment.js';

function runtimeScene(source) {
  const scene = designScene(source);
  const ids = new Map(scene.nodes.map((node, index) => [node.id, index + 101]));
  const rewrite = value => {
    if (!value || typeof value !== 'object') return;
    if (Object.hasOwn(value, '$ref')) value.$ref = ids.get(value.$ref);
    else for (const item of Object.values(value)) rewrite(item);
  };
  for (const node of scene.nodes) {
    node.id = ids.get(node.id);
    if (node.templateRoot !== undefined) node.templateRoot = ids.get(node.templateRoot);
    rewrite(node.properties);
    rewrite(node.collections);
  }
  scene.windows = scene.windows.map(id => ids.get(id));
  return {scene, ids};
}

function runningApp(source, {sessions = new DesignerAppSessions(), sessionId = 'linked'} = {}) {
  const {scene, ids} = runtimeScene(source);
  const calls = [];
  let revision = 0;
  sessions.register({
    sessionId, generation: 1, uiActive: true, state: 'paused', projectName: 'Linked project', codeVersion: 0,
    compile: async () => ({success: true, image: {name: 'linked'}}),
    request: async (method, parameters) => {
      calls.push({method, parameters});
      if (method === 'designSnapshot') return {scene, revision};
      if (method === 'hotReload') return {codeVersion: parameters.expectedVersion + 1};
      if (method === 'applyDesign') return {
        revision: ++revision, commands: parameters.patch.commands.length, bindings: parameters.patch.bindings
      };
      throw new Error('Unexpected request ' + method);
    }
  });
  return {scene, ids, calls, sessions, sessionId};
}

function sourceView(document, baseline) {
  const writes = [];
  const view = {
    document, sourceSync: {session: {analysis: {document: baseline}}}, chrome: {}, state: {readOnly: false},
    path: 'View.cs', live: null, writes,
    replace() { throw new Error('A linked source document must not be replaced by a live snapshot'); },
    update(event) { this.liveAttachment?.update(event); },
    safe: action => action(),
    writeDesignerSourceForSession: async identity => { writes.push(identity); }
  };
  return view;
}

test('exact live ownership binds source IDs while preserving source values and staged edits', async () => {
  const document = new DesignDocument(createDesign('Source view'));
  const input = document.add('TextBox', 'canvas', {Name: 'Input', Text: 'Source value', Width: 120});
  const baseline = document.snapshot();
  const app = runningApp(baseline);
  app.scene.nodes.find(node => node.id === app.ids.get(input)).properties.Text = 'User typed into the running app';
  document.setProperty('Width', 230, [input]);
  const original = document.serialize();
  const attachment = new LiveDesignAttachment(app.sessions);
  const result = await attachment.attach(app.sessionId, {linkedDocument: document.value, linkedBaseline: baseline});
  assert.equal(result.document.root, baseline.root);
  assert.deepEqual(result.document.nodes.map(node => node.id), baseline.nodes.map(node => node.id));
  assert.equal(result.document.nodes.find(node => node.id === input).runtimeId, app.ids.get(input));
  assert.equal(result.document.nodes.find(node => node.id === input).properties.Text, 'Source value');
  assert.equal(result.live.baseline.nodes.find(node => node.id === input).properties.Width, 120);
  assert.equal(result.live.sourceLinked, true);
  assert.equal(document.serialize(), original);
  await attachment.apply(result.document);
  const patch = app.calls.find(call => call.method === 'applyDesign').parameters.patch;
  assert.deepEqual(patch.commands, [{op: 'set', id: input, property: 'Width', value: 230}]);
  assert.equal(patch.bindings[input], app.ids.get(input));
});

test('a source Page can bind its one exact owned subtree inside the running Window', () => {
  const page = {
    version: 1, name: 'Page source', width: 960, height: 640, root: 'page', styles: {}, templates: {},
    nodes: [
      {id: 'page', type: 'Page', properties: {Name: 'StartPage'}, children: ['content']},
      {id: 'content', type: 'Canvas', properties: {Name: 'PageContent'}, children: []}
    ]
  };
  const hosted = structuredClone(page);
  hosted.root = 'window';
  hosted.nodes.unshift({id: 'window', type: 'Window', properties: {}, children: ['page']});
  const {scene, ids} = runtimeScene(hosted);
  const result = bindLinkedLiveDesign(page, designFromScene(scene), {scene});
  assert.deepEqual(Object.keys(result.bindings), ['page', 'content']);
  assert.equal(result.document.nodes[0].runtimeId, ids.get('page'));
  assert.equal(result.document.nodes.length, 2);
});

test('duplicate runtime names and indistinguishable unnamed siblings reject source attachment', () => {
  const source = createDesign();
  const {scene, ids} = runtimeScene(source);
  scene.nodes.find(node => node.id === ids.get('caption')).properties.Name = 'ActionButton';
  assert.throws(() => bindLinkedLiveDesign(source, designFromScene(scene), {scene}), {code: 'SFDL0009'});
  const unnamed = new DesignDocument(source);
  unnamed.add('TextBlock', 'canvas', {Name: '', Text: 'A second unnamed text control'});
  const second = runtimeScene(unnamed.value).scene;
  assert.throws(() => bindLinkedLiveDesign(unnamed.value, designFromScene(second), {scene: second}), /unnamed sibling controls/);
});

test('uncaptured runtime children and mismatched ownership retain the previous attachment', async () => {
  const source = createDesign();
  const app = runningApp(source);
  const attachment = new LiveDesignAttachment(app.sessions);
  await attachment.attach(app.sessionId, {linkedDocument: source});
  const previous = attachment.target;
  const canvas = app.scene.nodes.find(node => node.id === app.ids.get('canvas'));
  canvas.collections.Children.push({$ref: 9999});
  app.scene.nodes.push({id: 9999, type: 'Application.UnsupportedControl', properties: {}, collections: {}});
  await assert.rejects(attachment.attach(app.sessionId, {linkedDocument: source}), /uncaptured children/);
  assert.equal(attachment.target, previous);
  canvas.collections.Children.pop();
  canvas.collections.Children.pop();
  await assert.rejects(attachment.attach(app.sessionId, {linkedDocument: source}), {code: 'SFDL0009'});
  assert.equal(attachment.target, previous);
});

test('Studio linked attachment preserves its document, undo history and source Hot Reload path', async () => {
  const document = new DesignDocument(createDesign());
  const baseline = document.snapshot();
  const app = runningApp(baseline);
  document.setProperty('Width', 207, ['action']);
  const view = sourceView(document, baseline);
  const session = view.sourceSync.session;
  const adapter = new DesignerLiveAttachment(view, {sessions: app.sessions});
  view.liveAttachment = adapter;
  await adapter.attach(app.sessionId);
  assert.equal(view.document, document);
  assert.equal(view.sourceSync.session, session);
  assert.equal(document.undoStack.length, 1);
  assert.equal(document.node('action').runtimeId, app.ids.get('action'));
  await adapter.hotReload();
  assert.equal(view.writes[0].sessionId, app.sessionId);
  assert.deepEqual(app.calls.map(call => call.method), ['designSnapshot', 'hotReload', 'applyDesign']);
  assert.deepEqual(app.calls[2].parameters.patch.commands, [{op: 'set', id: 'action', property: 'Width', value: 207}]);
  document.undo();
  adapter.update({kind: 'undo'});
  assert.equal(document.node('action').properties.Width, 160);
  assert.equal(document.node('action').runtimeId, app.ids.get('action'));
  adapter.dispose();
});

test('Studio mismatched source fails explicitly or opens a separate adopted live target without losing the link', async () => {
  const baseline = createDesign();
  const app = runningApp(baseline);
  app.scene.nodes.find(node => node.id === app.ids.get('canvas')).collections.Children.pop();
  const view = sourceView(new DesignDocument(baseline), baseline);
  const before = view.document.serialize();
  const session = view.sourceSync.session;
  const adapter = new DesignerLiveAttachment(view, {sessions: app.sessions});
  await assert.rejects(adapter.attach(app.sessionId), {code: 'SFDL0009'});
  assert.equal(adapter.attachment.target, null);
  view.choose = async (_, choices) => choices[0];
  view.openStandaloneLiveDesign = async (document, {live, reason}) => {
    const separate = new LiveDesignAttachment(app.sessions);
    separate.adopt(live);
    return {document, separate, reason};
  };
  const opened = await adapter.attach(app.sessionId);
  assert.match(opened.reason, /different child counts/);
  assert.equal(opened.separate.target.sourceLinked, false);
  assert.equal(opened.separate.resolve().sessionId, app.sessionId);
  assert.equal(adapter.attachment.target, null);
  assert.equal(view.sourceSync.session, session);
  assert.equal(view.document.serialize(), before);
  opened.separate.dispose();
  adapter.dispose();
});

test('a design edit during a pending snapshot cannot replace the source attachment or consume pending edits', async () => {
  const baseline = createDesign();
  const app = runningApp(baseline);
  const view = sourceView(new DesignDocument(baseline), baseline);
  const adapter = new DesignerLiveAttachment(view, {sessions: app.sessions});
  const pending = adapter.attach(app.sessionId);
  view.document.setProperty('Width', 290, ['action']);
  await assert.rejects(pending, {code: 'SFDL0004'});
  assert.equal(adapter.attachment.target, null);
  assert.equal(view.document.node('action').properties.Width, 290);
  assert.equal(view.document.undoStack.length, 1);
  adapter.dispose();
});

test('a receipt-aware app cannot fall back to an unguarded generic C# write callback', async () => {
  const document = new DesignDocument(createDesign());
  const baseline = document.snapshot();
  const app = runningApp(baseline);
  const view = sourceView(document, baseline);
  delete view.writeDesignerSourceForSession;
  const writes = [];
  view.sourceSync.write = async () => writes.push('unguarded source write');
  app.sessions.get(app.sessionId).assertSourceOwnership = () => [];
  const adapter = new DesignerLiveAttachment(view, {sessions: app.sessions});
  await adapter.attach(app.sessionId);
  const calls = app.calls.length;
  await assert.rejects(adapter.hotReload(), error => error.code === 'SFDL0006' && error.sourceWritten === false && !error.codeApplied);
  assert.deepEqual(writes, []);
  assert.equal(app.calls.length, calls);
  assert.equal(view.document, document);
  adapter.dispose();
});
