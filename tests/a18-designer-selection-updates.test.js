import test from 'node:test';
import assert from 'node:assert/strict';
import {TreeModel} from '@sharpforge/controls';
import {DesignerDocumentUpdates} from '../apps/studio/designer-document-updates.js';
import {DesignerOutlineProjection} from '../apps/studio/designer-outline-projection.js';
import {DesignerOutline} from '../apps/studio/designer-outline.js';
import {DesignerSurfaceController} from '../apps/studio/designer-surface-controller.js';
import {DesignerSurfaceGestures} from '../apps/studio/designer-surface-gestures.js';

function documentFixture(count = 5000) {
  const nodes = [{id: 'root', type: 'Microsoft.UI.Xaml.Controls.Canvas', properties: {}, children: []}];
  for (let index = 1; index < count; index++) {
    const id = `item${index}`;
    nodes[0].children.push(id);
    nodes.push({id, type: 'Microsoft.UI.Xaml.Controls.Button', properties: {Name: id}, children: []});
  }
  const index = new Map(nodes.map(node => [node.id, node]));
  let nodeScans = 0;
  return {
    value: {root: 'root', get nodes() { nodeScans++; return nodes; }}, revision: 0, selection: ['root'],
    node: id => index.get(id), parent: id => id === 'root' ? null : nodes[0], scans: () => nodeScans
  };
}

function projectionFixture() {
  const document = documentFixture();
  const model = new TreeModel();
  let rebuilds = 0;
  model.subscribe(() => rebuilds++);
  const view = {document, treeModel: model, resourceDocument: false};
  const projection = new DesignerOutlineProjection(view);
  return {document, model, projection, rebuilds: () => rebuilds};
}

test('5000-node selection reuses tree identities and flattened rows without scanning the design', () => {
  const {document, model, projection, rebuilds} = projectionFixture();
  projection.update({kind: 'initialize'});
  const rows = model.rows();
  const root = model.nodes.get('root');
  const scans = document.scans();
  const builds = rebuilds();
  for (let index = 1; index < 100; index++) {
    document.selection = [`item${index}`];
    projection.update({kind: 'selection'});
    assert.deepEqual([...model.selected], document.selection);
    assert.equal(model.rows(), rows);
    assert.equal(model.nodes.get('root'), root);
  }
  assert.equal(document.scans(), scans);
  assert.equal(rebuilds(), builds);
});

test('selection expands a collapsed ancestor and property deltas refresh names without rebuilding the tree', () => {
  const {document, model, projection, rebuilds} = projectionFixture();
  projection.update({kind: 'initialize'});
  model.expand('root', false);
  assert.equal(model.rows().length, 1);
  document.selection = ['item40'];
  projection.update({kind: 'selection'});
  assert.equal(model.rows().length, 5000);
  const builds = rebuilds();
  model.setFilter('renamed');
  assert.equal(model.rows().length, 0);
  document.node('item40').properties.Name = 'Renamed';
  document.revision++;
  projection.update({kind: 'Set Name', changes: {kind: 'properties', nodes: [{id: 'item40', properties: ['Name']}]}});
  assert.equal(model.nodes.get('item40').label, 'Renamed · Button');
  assert.deepEqual(model.rows().map(row => row.id), ['root', 'item40']);
  assert.equal(rebuilds(), builds + 2, 'Only the explicit filter operation notified the tree twice.');
});

test('unknown edits and a replacement document invalidate the tree projection', () => {
  const {document, model, projection, rebuilds} = projectionFixture();
  projection.update({kind: 'initialize'});
  const builds = rebuilds();
  document.node('item1').properties.Name = 'Changed';
  document.revision++;
  projection.update({kind: 'source sync'});
  assert.equal(model.nodes.get('item1').label, 'Changed · Button');
  assert.equal(rebuilds(), builds + 1);
  projection.view.document = documentFixture(3);
  projection.update({kind: 'selection'});
  assert.equal(model.nodes.size, 3);
  assert.equal(model.nodes.has('item4'), false);
});

function updateFixture() {
  const document = documentFixture(3);
  const calls = [];
  const panels = new Map(['designer-tree', 'designer-properties', 'designer-layout', 'designer-styles', 'designer-toolbox']
    .map(id => [id, {isConnected: true, hidden: true, closest() { return this.hidden ? this : null; }}]));
  let dockListener;
  let released = false;
  const record = name => () => calls.push(name);
  const view = {
    document, initialized: true, disposed: false, resourceDocument: false, status: 'Ready', statusElement: {textContent: ''},
    docking: {layout: {subscribe: listener => { dockListener = listener; return () => { released = true; }; }}},
    panel: id => panels.get(id), treeModel: new TreeModel(), treeView: {render: record('tree')},
    resourceContext: {update: record('context'), breadcrumbContext: () => undefined},
    surface: {onDocumentChanged: record('surface')},
    outline: {render: record('outline'), projectVisibility: record('visibility')},
    accessibility: {update: record('accessibility')}, liveAttachment: {update: record('live')},
    chrome: {renderSelection: record('breadcrumb'), rulers: record('rulers')},
    sourceSync: {designChanged: record('source')}, assetPreviewController: {refresh: record('assets')},
    updatePreview: record('preview'), renderToolbox: record('toolbox'), renderProperties: record('properties'),
    renderLayout: record('layout'), renderResources: record('resources'), renderSource: record('sourcePanel'),
    updateButtons: record('buttons'), safe: action => action()
  };
  const updates = new DesignerDocumentUpdates(view);
  updates.update({kind: 'initialize'});
  calls.length = 0;
  return {view, updates, panels, calls, dock: () => dockListener(), released: () => released};
}

test('selection updates visible properties, breadcrumbs and accessibility without preview, catalog or hidden panel work', () => {
  const {view, updates, panels, calls} = updateFixture();
  panels.get('designer-properties').hidden = false;
  view.document.selection = ['item2'];
  updates.update({kind: 'selection'});
  assert.deepEqual([...view.treeModel.selected], ['item2']);
  for (const required of ['surface', 'properties', 'buttons', 'accessibility', 'live', 'breadcrumb']) assert(calls.includes(required));
  for (const absent of ['context', 'preview', 'toolbox', 'tree', 'outline', 'layout', 'resources', 'visibility', 'rulers', 'source', 'assets']) {
    assert.equal(calls.includes(absent), false, absent);
  }
  assert.equal(view.syncing, false);
});

test('hidden panels flush the latest selection on docking, explicit activation and document routing', () => {
  const {view, updates, panels, calls, dock} = updateFixture();
  view.document.selection = ['item2'];
  updates.update({kind: 'selection'});
  panels.get('designer-layout').hidden = false;
  dock();
  assert.equal(calls.filter(name => name === 'layout').length, 1);
  dock();
  assert.equal(calls.filter(name => name === 'layout').length, 1);
  assert.equal(updates.renderTool('designer-properties'), true);
  assert.equal(calls.filter(name => name === 'properties').length, 1);
  panels.get('designer-tree').isConnected = false;
  panels.get('designer-tree').hidden = false;
  updates.flushVisible();
  assert.equal(calls.includes('tree'), false);
  panels.get('designer-tree').isConnected = true;
  updates.flushVisible();
  assert(calls.includes('tree'));
  assert(calls.includes('outline'));
  assert.deepEqual([...view.treeModel.selected], ['item2']);
});

test('coordinator releases docking subscriptions and restores syncing after a failed visible panel update', () => {
  const {view, updates, panels, released, dock, calls} = updateFixture();
  panels.get('designer-properties').hidden = false;
  view.renderProperties = () => { throw new Error('Property render failed'); };
  assert.throws(() => updates.update({kind: 'selection'}), /Property render failed/);
  assert.equal(view.syncing, false);
  updates.dispose();
  assert.equal(released(), true);
  const before = calls.length;
  dock();
  updates.update({kind: 'selection'});
  assert.equal(calls.length, before);
});

test('one geometry delta updates the host once without rebuilding the catalog, guides or asset scene', () => {
  const {view, updates, calls} = updateFixture();
  view.document.revision++;
  updates.update({kind: 'Move controls', changes: {kind: 'properties', nodes: [{id: 'item2', properties: ['Left', 'Top']}]}});
  assert.equal(calls.filter(name => name === 'preview').length, 1);
  for (const absent of ['context', 'toolbox', 'rulers', 'assets', 'visibility']) assert.equal(calls.includes(absent), false, absent);
  assert(calls.includes('source'));
  calls.length = 0;
  view.document.revision++;
  updates.update({kind: 'Set Source', changes: {kind: 'properties', nodes: [{id: 'item2', properties: ['Source']}]}});
  assert(calls.includes('assets'), 'Source edits must refresh authorized asset previews.');
});

test('outline selection and scrolling never enumerate or mutate every scene element', () => {
  const document = documentFixture();
  const elements = new Map();
  elements[Symbol.iterator] = () => { throw new Error('Full host enumeration'); };
  const outline = new DesignerOutline({document, host: {elements}});
  outline.root = {querySelectorAll: () => []};
  outline.render({project: false});
  assert.equal(document.scans(), 0);
  outline.projectVisibility();
  assert.equal(document.scans(), 0);
});

test('surface selection schedules adorners without rewriting dimensions, guide DOM or cached geometry', () => {
  const document = documentFixture(3);
  let adorners = 0;
  const unexpected = () => { throw new Error('Selection invalidated the full surface'); };
  const controller = {installed: true, disposed: false, view: {document}, lastDocument: document,
    geometry: {invalidate: unexpected}, preview: {applyDimensions: unexpected}, guides: {render: unexpected},
    drawAdorners: () => adorners++};
  DesignerSurfaceController.prototype.onDocumentChanged.call(controller, {kind: 'selection'});
  assert.equal(adorners, 1);
});

test('a gesture rejected by a changed source capability still clears keyboard ownership and restores adorners', () => {
  let renders = 0;
  const gestures = new DesignerSurfaceGestures({view: {}, drawAdorners: () => renders++});
  gestures.keyboard = {kind: 'geometry', session: {commit: () => { throw new Error('Source property became protected'); }}};
  assert.throws(() => gestures.finishKeyboard(), /became protected/);
  assert.equal(gestures.keyboard, null);
  assert.equal(renders, 1);
});

test('outline projection preserves inherited visibility and removes stale attributes after unhide or scene replacement', () => {
  const document = documentFixture(3);
  let writes = 0;
  const makeElement = () => ({attributes: new Map(),
    setAttribute(name, value) { writes++; this.attributes.set(name, value); },
    removeAttribute(name) { writes++; this.attributes.delete(name); }});
  const elements = new Map(['root', 'item1', 'item2'].map(id => [id, makeElement()]));
  const outline = new DesignerOutline({document, host: {elements}});
  outline.state.toggle('item1', 'hidden');
  outline.projectVisibility();
  assert.equal(elements.get('item1').attributes.get('data-design-hidden'), 'true');
  assert.equal(elements.get('item2').attributes.size, 0);
  outline.projectVisibility();
  assert.equal(writes, 1);
  const replacement = makeElement();
  elements.set('item1', replacement);
  outline.projectVisibility();
  assert.equal(replacement.attributes.get('data-design-hidden'), 'true');
  outline.state.toggle('item1', 'hidden');
  outline.projectVisibility();
  assert.equal(replacement.attributes.has('data-design-hidden'), false);
});
