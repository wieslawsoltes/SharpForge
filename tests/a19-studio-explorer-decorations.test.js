import test from 'node:test';
import assert from 'node:assert/strict';
import { TreeModel, TreeView } from '@sharpforge/controls';
import { buildSolutionTree } from '@sharpforge/project-system';
import { createWorkbenchServices } from '../apps/studio/workbench/sessions.js';
import { connectExplorerProjectDecorations } from '../apps/studio/workbench/explorer-project-decorations.js';
import { fakeWorkers, fakeRuntime, compileResult } from './a19-session-fixtures.js';

// Only the platform element/event boundary is simulated; the production TreeModel,
// TreeView renderer, application events and composition adapter run unchanged.
class TreeElement extends EventTarget {
  constructor(document) {
    super();
    this.ownerDocument = document;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.classes = new Set();
    this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name) };
    this.scrollTop = 0;
    this.clientHeight = 400;
    this.htmlWrites = 0;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  set innerHTML(value) { this.html = value; this.htmlWrites++; }
  insertBefore(node, before) {
    node.remove();
    node.parent = this;
    const index = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(index, 0, node);
  }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this.append(...nodes); }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
}

const alpha = 'A/A.csproj';
const beta = 'B/B.csproj';

function fixture(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'ResizeObserver', previous);
    else delete globalThis.ResizeObserver;
  });
  const fake = fakeWorkers((message, worker) => ['launch', 'stop'].includes(message.method) ? fakeRuntime(message, worker) : undefined);
  const services = createWorkbenchServices({ workerFactory: fake.factory, records: [
    { uri: 'A/View.cs', text: 'class A {}' }, { uri: 'B/View.cs', text: 'class B {}' }
  ] });
  const projects = [alpha, beta].map((path, index) => ({ path, name: index ? 'App B' : 'App A',
    outputType: 'exe', compile: [{ path: index ? 'B/View.cs' : 'A/View.cs' }] }));
  for (const project of projects) services.registerProject({ ...project, id: project.path, files: [] });
  services.documents.setProjectMembership(alpha, ['A/View.cs']);
  services.documents.setProjectMembership(beta, ['B/View.cs']);
  const files = projects.map(project => ({ path: project.compile[0].path,
    get text() { throw new Error('Project decoration materialized source text'); } }));
  const data = { files, snapshot: { solution: { path: 'Apps.slnx', name: 'Apps' }, projects }, startup: alpha };
  const model = new TreeModel(buildSolutionTree(data));
  const document = { createElement: () => new TreeElement(document) };
  const root = document.createElement();
  const control = new TreeView(root, { model });
  const disconnect = connectExplorerProjectDecorations({ services, explorer: { model, control } });
  const node = id => model.nodes.get('project:' + id);
  const row = id => control.canvas.children.find(element => element.dataset.treeId === 'project:' + id);
  t.after(() => { disconnect(); control.dispose(); services.dispose(); });
  return { services, fake, data, model, control, disconnect, node, row };
}

test('actual Explorer rows expose multiple startup, running, paused and building states with descriptive accessible names', async t => {
  const current = fixture(t);
  const { services, node, row } = current;
  services.startup.configure({ mode: 'multiple', entries: [{ projectId: alpha }, { projectId: beta }] });
  assert.equal(node(alpha).startup, true);
  assert.equal(node(beta).startup, true);
  assert.match(row(beta).className, /startup/);
  assert.equal(row(beta).getAttribute('aria-label'), 'App B, Startup project');
  const application = services.sessions.create({ projectId: alpha, name: 'App A' });
  await application.launch({});
  assert.equal(node(alpha).badge, '1 running');
  assert.equal(row(alpha).getAttribute('aria-label'), 'App A, Startup project, 1 running');
  application.worker.worker.emit({ event: 'state', sessionId: 1, state: 'paused', frames: [], output: '', stats: {} });
  assert.equal(node(alpha).badge, '1 paused');
  const build = services.builds.get(beta).build();
  assert.equal(node(beta).badge, 'Building');
  assert.equal(row(beta).getAttribute('aria-label'), 'App B, Startup project, Building');
  const worker = services.builds.get(beta).worker.worker;
  worker.reply(worker.requests.at(-1).id, compileResult());
  await build;
  assert.equal(node(beta).badge, '');
  await application.stop();
  assert.equal(node(alpha).badge, '');
});

test('background session changes preserve tree selection and unchanged statistics do not redraw rows or read source records', async t => {
  const current = fixture(t);
  current.model.select('project:' + beta);
  const selected = current.model.snapshot();
  const application = current.services.sessions.create({ projectId: alpha }, { activate: false });
  await application.launch({});
  assert.deepEqual(current.model.snapshot(), selected);
  const originalNode = current.node(alpha);
  const originalRow = current.row(alpha);
  const writes = originalRow.htmlWrites;
  for (let count = 0; count < 30; count++) application.worker.worker.emit({
    event: 'state', sessionId: 1, state: 'running', frames: [], output: '', stats: { instructions: count }
  });
  assert.equal(current.node(alpha), originalNode);
  assert.equal(current.row(alpha), originalRow);
  assert.equal(originalRow.htmlWrites, writes);
  assert.deepEqual(current.model.snapshot(), selected);
});

test('a normal Explorer tree rebuild retains current badges and disposing the adapter releases every subscription', async t => {
  const current = fixture(t);
  const application = current.services.sessions.create({ projectId: alpha });
  await application.launch({});
  const previous = current.node(alpha);
  current.model.setNodes(buildSolutionTree(current.data));
  assert.notEqual(current.node(alpha), previous);
  assert.equal(current.node(alpha).badge, '1 running');
  assert.match(current.row(alpha).getAttribute('aria-label'), /1 running/);
  current.disconnect();
  const label = current.row(alpha).getAttribute('aria-label');
  await application.stop();
  current.services.startup.select(beta);
  assert.equal(current.row(alpha).getAttribute('aria-label'), label);
  assert.equal(current.node(alpha).badge, '1 running');
});

test('current-selection startup decorations follow the actual active document membership without selecting another project', t => {
  const current = fixture(t);
  current.services.startup.configure({ mode: 'currentSelection', entries: [] });
  current.services.documents.open('B/View.cs');
  assert.equal(current.node(beta).startup, true);
  assert.equal(current.node(alpha).startup, false);
  assert.equal(current.services.builds.activeId, alpha);
  current.services.documents.open('A/View.cs');
  assert.equal(current.node(alpha).startup, true);
  assert.equal(current.node(beta).startup, false);
  current.services.documents.setProjectMembership(beta, ['A/View.cs', 'B/View.cs']);
  current.services.builds.setActive(beta);
  assert.equal(current.node(alpha).startup, false);
  assert.equal(current.node(beta).startup, true, 'shared-source startup follows its selected project and clears the previous badge');
});

test('recycled ordinary tree rows remove a former project accessible label', t => {
  const current = fixture(t);
  current.services.startup.select(alpha);
  const id = 'project:' + alpha;
  const old = current.row(alpha);
  current.model.setNodes([{ id, label: 'Ordinary source', kind: 'source' }]);
  const next = current.control.canvas.children.find(element => element.dataset.treeId === id);
  assert.equal(next, old);
  assert.equal(next.getAttribute('aria-label'), null);
  assert.match(next.html, /Ordinary source/);
});
