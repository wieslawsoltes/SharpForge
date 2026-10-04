import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesignerResourceDocument, createDesign, DesignDocument} from '@sharpforge/designer';
import {DesignerResourceGallery} from '../apps/studio/designer-resource-gallery.js';
import {DesignerResourceContext, designerResourceActionAllowed} from '../apps/studio/designer-resource-context.js';
import {renderDesignerResourceValue} from '../apps/studio/designer-resource-values.js';
import {resourceView} from './fixtures/a18-resource-dom.js';

function hostsFor(view) {
  const created = [];
  const gallery = new DesignerResourceGallery(view, {createHost: (surface, options) => {
    const host = {surface, options, elements: new Map(), disposed: 0,
      load(scene) { this.scene = scene; }, flush() { assert.equal(surface.isConnected, true); this.flushed = true; },
      dispose() { this.disposed++; }};
    created.push(host);
    return host;
  }});
  view.updatePreview = () => gallery.render();
  return {gallery, created};
}

test('A18 gallery defers host construction until connected and disposes each page or template transition', async () => {
  const styles = Object.fromEntries(Array.from({length: 10}, (_, index) => ['Style' + index,
    {targetType: 'Button', setters: {Width: 90 + index}}]));
  const model = createDesignerResourceDocument({styles});
  const harness = resourceView(model, {connected: false});
  const {gallery, created} = hostsFor(harness.view);
  const diagnostics = structuredClone(harness.view.sourceSync.session.analysis);
  gallery.render();
  assert.equal(created.length, 0);
  assert.equal(gallery.pending.length, 8);
  harness.document.body.append(harness.container);
  harness.observers[0].callback();
  assert.equal(created.length, 8);
  assert(created.every(host => host.flushed));
  gallery.render();
  assert.equal(created.length, 8);
  await gallery.root.querySelectorAll('button').find(button => button.textContent === 'Next').fire('click');
  assert.equal(created.length, 10);
  assert(created.slice(0, 8).every(host => host.disposed === 1));
  harness.view.templateScope = {};
  gallery.render();
  assert.equal(gallery.root.hidden, true);
  assert(created.every(host => host.disposed === 1));
  delete harness.view.templateScope;
  gallery.render();
  assert.equal(created.length, 12);
  assert.equal(gallery.root.hidden, false);
  assert.deepEqual(harness.view.sourceSync.session.analysis, diagnostics);
  gallery.dispose();
  gallery.dispose();
  assert(created.every(host => host.disposed === 1));
  assert.equal(harness.observers[0].disconnected, true);
  model.dispose();
});

test('A18 gallery refreshes real template scenes for theme, state and newly loaded assets', async () => {
  const model = createDesignerResourceDocument({resources: {Logo: {kind: 'theme', type: 'string', variants: {
    default: 'Images/day.png', highContrast: 'Images/high.png'}}}, templates: {
    Picture: {targetType: 'Button', root: {id: 'image', type: 'Image', properties: {}, children: [],
      resourceReferences: {Source: {kind: 'theme', key: 'Logo'}}}}}});
  const harness = resourceView(model);
  const {gallery, created} = hostsFor(harness.view);
  const before = model.serialize();
  gallery.render();
  const source = () => created.at(-1).scene.nodes.find(node => node.id === 'preview::image').properties.Source;
  assert.equal(source(), 'Images/day.png');
  const theme = gallery.root.querySelector('[aria-label="Dictionary preview theme"]');
  theme.value = 'highContrast';
  await theme.fire('change');
  assert.equal(source(), 'Images/high.png');
  const state = gallery.root.querySelector('[aria-label="Dictionary preview state"]');
  state.value = 'Disabled';
  await state.fire('change');
  assert.equal(created.at(-1).scene.nodes.find(node => node.id === 'preview').properties.IsEnabled, false);
  harness.assets.set('Images/high.png', 'blob:high');
  harness.view.assetPreviewController.version++;
  gallery.render();
  assert.equal(source(), 'blob:high');
  await gallery.root.querySelector('[data-resource-key="Picture"]').fire('click');
  assert.equal(harness.view.resources.selectedKey, 'Picture');
  assert.equal(harness.activations.at(-1), 'designer-styles');
  assert.equal(model.serialize(), before);
  gallery.dispose();
  model.dispose();
});

test('A18 typed resource cards and editors keep scalar values out of brush parsing and validate transactional commits', async () => {
  const model = createDesignerResourceDocument({resources: {Count: {type: 'int', value: 4},
    Caption: {type: 'string', value: '<img src=x>'}, Enabled: {type: 'bool', value: false}}});
  const harness = resourceView(model);
  const {gallery, created} = hostsFor(harness.view);
  gallery.render();
  assert.equal(created.length, 0);
  assert.equal(gallery.root.querySelectorAll('.design-resource-scalar-preview').length, 3);
  assert(gallery.root.textContent.includes('<img src=x>'));
  const parent = harness.panels.get('designer-styles');
  const controller = {view: harness.view, resourceThemes: new Map()};
  renderDesignerResourceValue(controller, parent, {key: 'Count', kind: 'brush', value: model.value.resources.Count});
  const input = parent.querySelector('[aria-label="Resource value"]');
  assert.equal(input.type, 'number');
  const depth = model.undoStack.length;
  input.value = '12';
  await input.fire('change');
  assert.equal(model.value.resources.Count.value, 12);
  assert.equal(model.undoStack.length, depth + 1);
  const before = model.serialize();
  input.value = '12.5';
  await input.fire('change');
  assert.equal(model.serialize(), before);
  assert.equal(parent.querySelector('.design-editor-error').hidden, false);
  model.undo();
  assert.equal(model.value.resources.Count.value, 4);
  gallery.dispose();
  model.dispose();
});

test('A18 dictionary mode preserves visual panel controller DOM and restores it only in template or visual scope', () => {
  const model = createDesignerResourceDocument();
  const harness = resourceView(model);
  const context = new DesignerResourceContext(harness.view);
  const toolbox = harness.panels.get('designer-toolbox');
  const retained = harness.document.createElement('button');
  retained.textContent = 'Existing toolbox controller';
  toolbox.append(retained);
  const run = harness.document.createElement('button');
  run.dataset.designAction = 'run-app';
  harness.view.controlsRoot.append(run);
  context.update();
  assert(toolbox.children.includes(retained));
  assert(toolbox.classList.contains('design-resource-visual-disabled'));
  assert.equal(run.hidden, true);
  assert.equal(harness.view.scroller.inert, true);
  for (const action of ['insert', 'delete', 'duplicate', 'copy', 'paste', 'preview', 'run-app', 'apply', 'generate']) {
    assert.equal(designerResourceActionAllowed(harness.view, action), false, action);
  }
  for (const action of ['save', 'source', 'undo', 'redo', 'options']) assert.equal(designerResourceActionAllowed(harness.view, action), true);
  harness.view.templateScope = {};
  context.update();
  assert.equal(toolbox.querySelector('.design-resource-unavailable'), null);
  assert.equal(toolbox.classList.contains('design-resource-visual-disabled'), false);
  assert.equal(harness.view.scroller.inert, false);
  assert.equal(designerResourceActionAllowed(harness.view, 'insert'), true);
  assert.equal(designerResourceActionAllowed(harness.view, 'run-app'), false);
  context.dispose();
  assert.equal(run.hidden, false);
  model.dispose();
});

test('A18 scalar theme edits target the selected variant while unknown typed resources stay visibly read-only', async () => {
  const model = createDesignerResourceDocument({resources: {Count: {kind: 'theme', type: 'int', variants: {default: 4, dark: 8}}}});
  const harness = resourceView(model);
  const parent = harness.panels.get('designer-styles');
  const controller = {view: harness.view, resourceThemes: new Map()};
  const selected = {key: 'Count', kind: 'theme', value: model.value.resources.Count};
  renderDesignerResourceValue(controller, parent, selected);
  const theme = parent.querySelector('[aria-label="Resource theme"]');
  theme.value = 'dark';
  await theme.fire('change');
  const input = parent.querySelector('[aria-label="Resource value"]');
  input.value = '22';
  await input.fire('change');
  assert.equal(model.value.resources.Count.variants.dark, 22);
  assert.equal(model.value.resources.Count.variants.default, 4);
  assert.equal(controller.resourceThemes.get('Count'), 'dark');
  parent.replaceChildren();
  const unknown = {kind: 'value', type: 'Windows.UI.Color', value: '#112233'};
  const boundary = {view: {document: {value: {resources: {Color: unknown}}, change() { assert.fail('Read-only value must not commit'); }}},
    resourceThemes: new Map()};
  renderDesignerResourceValue(boundary, parent, {key: 'Color', kind: 'brush', value: unknown});
  assert.equal(parent.querySelector('input'), null);
  assert(parent.textContent.includes('SFD1822'));
  assert(parent.textContent.includes('read-only'));
  model.dispose();
});

test('A18 ordinary visual documents never allocate a resource gallery or an instance host', () => {
  const model = new DesignDocument(createDesign());
  const {view} = resourceView(model);
  const {gallery, created} = hostsFor(view);
  assert.equal(gallery.render(), false);
  assert.equal(gallery.root, undefined);
  assert.equal(created.length, 0);
  gallery.dispose();
  model.dispose();
});
