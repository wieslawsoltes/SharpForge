import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument, createDesign, normalizeDesignerBrush, validateDesign} from '@sharpforge/designer';
import {DesignerLayoutPreview} from '../apps/studio/designer-layout-preview.js';
import {DesignerSurfaceController} from '../apps/studio/designer-surface-controller.js';
import {buildDesignerPreviewScene} from '../apps/studio/designer-preview-scene.js';

function fixture(change = () => {}) {
  const value = createDesign('High contrast resource preview');
  const action = value.nodes.find(node => node.id === 'action');
  action.resourceReferences = {Background: {kind: 'theme', key: 'AccentBrush'}};
  action.bindings = {Foreground: {path: 'Colors.Text'}, RequestedTheme: {path: 'SelectedTheme'}};
  value.resources = {AccentBrush: {kind: 'theme', type: 'Microsoft.UI.Xaml.Media.Brush', variants: {
    default: normalizeDesignerBrush('#204080'), light: normalizeDesignerBrush('#a02010'),
    dark: normalizeDesignerBrush('#106030'), highContrast: normalizeDesignerBrush('#778899')
  }}};
  change(value);
  const document = new DesignDocument(value);
  const view = {document, assetPreviews: {resolve: () => null}};
  const surface = {view, installed: true, scene: DesignerSurfaceController.prototype.scene};
  surface.preview = new DesignerLayoutPreview(surface);
  view.surface = surface;
  return {view, document, environment: surface.preview.environment, render: () => buildDesignerPreviewScene(view)};
}

function rgb(scene, id, name) {
  const color = scene.nodes.find(node => node.id === id).properties[name].Color;
  return [color.R, color.G, color.B, color.A];
}

test('high contrast resolves resource and binding sources before applying temporary appearance', () => {
  const {document, environment, render} = fixture();
  const before = document.serialize();
  environment.update({theme: 'light', contrast: 'high'});
  const projected = environment.document(document.value);
  assert.doesNotThrow(() => validateDesign(projected));
  assert.deepEqual(projected.nodes.find(node => node.id === 'action').resourceReferences,
    document.node('action').resourceReferences);
  assert.deepEqual(projected.nodes.find(node => node.id === 'action').bindings, document.node('action').bindings);
  const scene = render();
  assert.deepEqual(rgb(scene, 'canvas', 'Background'), [0, 0, 0, 255]);
  assert.deepEqual(rgb(scene, 'action', 'Background'), [0, 0, 0, 255]);
  assert.deepEqual(rgb(scene, 'action', 'Foreground'), [255, 255, 255, 255]);
  assert.equal(scene.nodes.find(node => node.id === 'action').properties.RequestedTheme, 1);
  assert.equal(document.serialize(), before);
  assert.equal(document.undoStack.length, 0);
});

test('normal contrast restores themed resources and sample bindings without a document transaction', () => {
  const {document, environment, render} = fixture(value => {
    value.designTime = {version: 1, nodes: {action: {bindingValues: {Foreground: '#123456'}}}};
  });
  const before = document.serialize();
  const dark = render();
  assert.deepEqual(rgb(dark, 'action', 'Background'), [16, 96, 48, 255]);
  assert.deepEqual(rgb(dark, 'action', 'Foreground'), [18, 52, 86, 255]);
  environment.update({contrast: 'high'});
  assert.deepEqual(rgb(render(), 'action', 'Foreground'), [255, 255, 255, 255]);
  environment.update({contrast: 'normal'});
  assert.deepEqual(render(), dark);
  environment.update({theme: 'light'});
  assert.deepEqual(rgb(render(), 'action', 'Background'), [160, 32, 16, 255]);
  assert.equal(document.serialize(), before);
  assert.equal(document.undoStack.length, 0);
});

test('template resources and template bindings receive appearance after instance projection', () => {
  const {document, environment, render} = fixture(value => {
    value.templates.Frame = {targetType: 'Button', root: {id: 'frame', type: 'Border', properties: {},
      resourceReferences: {Background: {kind: 'theme', key: 'AccentBrush'}}, children: [
        {id: 'text', type: 'TextBlock', properties: {Text: 'Template preview'}, bindings: {Foreground: 'Foreground'}, children: []}
      ]}};
    value.nodes.find(node => node.id === 'action').template = 'Frame';
    value.designTime = {version: 1, nodes: {action: {bindingValues: {Foreground: '#123456'}}}};
  });
  const before = document.serialize();
  const normal = render();
  assert.deepEqual(rgb(normal, 'action::frame', 'Background'), [16, 96, 48, 255]);
  assert.deepEqual(rgb(normal, 'action::text', 'Foreground'), [18, 52, 86, 255]);
  environment.update({contrast: 'high'});
  const high = render();
  assert.deepEqual(rgb(high, 'action::frame', 'Background'), [0, 0, 0, 255]);
  assert.deepEqual(rgb(high, 'action::text', 'Foreground'), [255, 255, 255, 255]);
  assert.equal(document.serialize(), before);
  environment.update({contrast: 'normal'});
  assert.deepEqual(render(), normal);
});

test('appearance is applied after the project component composition seam and supports standalone surface scenes', () => {
  const {view, document, environment, render} = fixture();
  const before = document.serialize();
  let composed = 0;
  view.projectRoots = {project(design, scene, options) {
    assert.equal(design, document.value);
    assert.equal(options.theme, 'highContrast');
    scene.nodes.find(node => node.id === 'canvas').properties.Background = normalizeDesignerBrush('#abcdef');
    composed++;
    return {scene};
  }};
  environment.update({contrast: 'high'});
  assert.deepEqual(rgb(render(), 'canvas', 'Background'), [0, 0, 0, 255]);
  assert.equal(composed, 1);
  assert.deepEqual(rgb(view.surface.scene(), 'canvas', 'Background'), [0, 0, 0, 255]);
  assert.deepEqual(rgb(view.surface.scene(document.value, {appearance: false}), 'canvas', 'Background'), [32, 36, 43, 255]);
  assert.equal(document.serialize(), before);
});

test('contrast does not bypass conflicting authored value sources', () => {
  const {view, document, environment} = fixture();
  environment.update({contrast: 'high'});
  const invalid = document.snapshot();
  invalid.nodes.find(node => node.id === 'action').properties.Background = normalizeDesignerBrush('#ffffff');
  assert.throws(() => view.surface.scene(invalid), {code: 'SFD1821'});
  assert.equal(Object.hasOwn(document.node('action').properties, 'Background'), false);
  assert.equal(document.undoStack.length, 0);
});
