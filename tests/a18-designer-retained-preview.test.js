import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument, DesignPreviewEnvironment, createDesign, designScene, projectDesignerAuthoringScene,
  normalizeDesignerBrush} from '@sharpforge/designer';
import {DesignerPreviewProjection} from '../apps/studio/designer-preview-projection.js';
import {geometryHost} from './fixtures/a18-host-geometry-dom.js';

function fixture(change = () => {}) {
  const value = createDesign('Retained preview');
  change(value);
  const document = new DesignDocument(value);
  const environment = new DesignPreviewEnvironment({theme: 'light'});
  let builds = 0;
  const buildPreviewScene = () => {
    builds++;
    const theme = environment.value.contrast === 'high' ? 'highContrast' : environment.value.theme;
    return environment.applyToScene(projectDesignerAuthoringScene(document.value,
      designScene(environment.document(document.value)), {theme}));
  };
  const dom = geometryHost(buildPreviewScene());
  const view = {document, host: dom.host, resourceGallery: {render() {}}, resourceDocument: false, buildPreviewScene,
    surface: {preview: {get value() { return environment.value; }}}, resizeArtboard() {}, drawAdorners() {}};
  const projection = new DesignerPreviewProjection(view);
  projection.update({kind: 'initialize'});
  dom.reset();
  return {...dom, view, projection, environment, builds: () => builds, reference: buildPreviewScene};
}

function transaction(view, action) {
  const events = [];
  const unsubscribe = view.document.subscribe(event => events.push(event));
  action(view.document);
  unsubscribe();
  assert.equal(events.length, 1, 'One authoring transaction must publish one host update.');
  return events[0];
}

function assertReference(host, scene) {
  assert.equal(host.nodes.size, scene.nodes.length);
  for (const node of scene.nodes) assert.deepEqual(host.nodes.get(node.id).properties, node.properties, node.id);
}

test('geometry commit, undo and redo each patch one retained control and match complete preview projection', () => {
  const {view, host, projection, builds, reference, rendered, reset} = fixture();
  const baseline = view.document.serialize();
  const count = builds();
  const element = host.elements.get('action');
  const edit = transaction(view, document => document.patchProperties({action: {Left: 88, Top: 182, Width: 248}}, {label: 'Drag'}));
  assert.equal(edit.changes.kind, 'properties');
  assert.equal(projection.update(edit), true);
  assert.equal(builds(), count);
  assert.deepEqual(rendered, ['action']);
  assert.equal(view.document.undoStack.length, 1);
  assertReference(host, reference());
  reset();
  assert.equal(projection.update(transaction(view, document => document.undo())), true);
  assert.deepEqual(rendered, ['action']);
  assert.equal(view.document.serialize(), baseline);
  assertReference(host, reference());
  reset();
  assert.equal(projection.update(transaction(view, document => document.undo(true))), true);
  assert.deepEqual(rendered, ['action']);
  assert.equal(host.elements.get('action'), element);
  assertReference(host, reference());
  host.dispose();
});

test('retained geometry honors adaptive and sample overrides and reapplies gradient decorations', () => {
  const {view, host, projection, reference} = fixture(value => {
    value.responsive = {version: 1, states: [{id: 'Compact', minWidth: 0, maxWidth: null,
      overrides: {action: {Width: 88, Top: 55}}}]};
    value.designTime = {version: 1, nodes: {action: {properties: {Left: 300}, bindingValues: {Top: 400}}}};
    value.styles.Accent.setters.Background = normalizeDesignerBrush({valueType: 'Microsoft.UI.Xaml.Media.LinearGradientBrush',
      GradientStops: [{Color: '#ffffff', Offset: 1}, {Color: '#000000', Offset: 0}]});
  });
  const event = transaction(view, document => document.patchProperties({action: {Left: 99, Top: 100, Width: 240}}, {label: 'Drag'}));
  assert.equal(projection.update(event), true);
  assert.equal(host.nodes.get('action').properties.Left, 300);
  assert.equal(host.nodes.get('action').properties.Top, 400);
  assert.equal(host.nodes.get('action').properties.Width, 88);
  assert.match(host.elements.get('action').style.background, /^linear-gradient\(/);
  assertReference(host, reference());
  host.dispose();
});

test('clearing local geometry restores the style/default value instead of retaining a stale preview property', () => {
  const {view, host, projection, reference} = fixture(value => { value.styles.Accent.setters.Width = 90; });
  const event = transaction(view, document => document.patchProperties({action: {Width: undefined}}, {label: 'Clear Width'}));
  assert.equal(projection.update(event), true);
  assert.equal(host.nodes.get('action').properties.Width, 90);
  assert.equal(Object.hasOwn(view.document.node('action').properties, 'Width'), false);
  assertReference(host, reference());
  host.dispose();
});

test('high-contrast resources and bindings remain projected during a retained geometry edit and undo', () => {
  const {view, host, projection, reference, environment} = fixture(value => {
    value.resources = {AccentBrush: {kind: 'theme', type: 'Microsoft.UI.Xaml.Media.Brush', variants: {
      default: normalizeDesignerBrush('#123456')
    }}};
    const action = value.nodes.find(node => node.id === 'action');
    action.resourceReferences = {Background: {kind: 'theme', key: 'AccentBrush'}};
    action.bindings = {Foreground: {path: 'TextColor'}};
  });
  environment.update({contrast: 'high'});
  projection.update({kind: 'preview'});
  const before = view.document.serialize();
  const edit = transaction(view, document => document.patchProperties({action: {Left: 75}}, {label: 'Move'}));
  assert.equal(projection.update(edit), true);
  assert.equal(host.nodes.get('action').properties.Background.Color.R, 0);
  assert.equal(host.nodes.get('action').properties.Foreground.Color.R, 255);
  assertReference(host, reference());
  assert.equal(projection.update(transaction(view, document => document.undo())), true);
  assertReference(host, reference());
  assert.equal(view.document.serialize(), before);
  host.dispose();
});

test('external scene publication and in-place theme changes invalidate the model-to-host cache', () => {
  const {view, host, projection, reference, builds, environment} = fixture();
  const external = reference();
  external.nodes.find(node => node.id === 'action').properties.Content = 'Unrelated preview state';
  host.load(external);
  host.flush();
  let before = builds();
  let event = transaction(view, document => document.patchProperties({action: {Left: 70}}, {label: 'Move'}));
  assert.equal(projection.update(event), false);
  assert.equal(builds(), before + 1);
  assertReference(host, reference());
  environment.value.theme = 'dark';
  before = builds();
  event = transaction(view, document => document.patchProperties({action: {Top: 190}}, {label: 'Move'}));
  assert.equal(projection.update(event), false, 'Mutable environment identity cannot authorize a stale cached projection.');
  assert.equal(builds(), before + 1);
  assertReference(host, reference());
  host.dispose();
});

test('changing adaptive preview state and edits with no property contract use the complete projection', () => {
  const {view, host, projection, reference, environment} = fixture(value => {
    value.responsive = {version: 1, states: [{id: 'Compact', minWidth: 0, maxWidth: 500,
      overrides: {action: {Width: 88}}}]};
  });
  environment.update({state: 'Compact'});
  assert.equal(projection.update(transaction(view,
    document => document.patchProperties({action: {Left: 65}}, {label: 'Move'}))), false);
  assert.equal(host.nodes.get('action').properties.Width, 88);
  assertReference(host, reference());
  const event = transaction(view, document => document.change('Edit source', draft => {
    draft.nodes.find(node => node.id === 'action').properties.Content = 'From source';
  }));
  assert.equal(event.changes, undefined);
  assert.equal(projection.update(event), false);
  assertReference(host, reference());
  projection.dispose();
  assert.equal(projection.document, null);
  assert.equal(projection.decorations.size, 0);
  host.dispose();
});
