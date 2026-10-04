import test from 'node:test';
import assert from 'node:assert/strict';
import {controlColorPolicy} from '../packages/rendering/src/controls/color-policy.js';

test('retained forced colors use the computed host palette and preserve transparent hit-test backgrounds', () => {
  const palette = {Canvas: '#112233', CanvasText: '#ffffff', ButtonFace: '#334455', ButtonText: '#ffff00',
    GrayText: '#aabbcc', Highlight: '#ff00ff'};
  const requested = [], services = {environment: {HighContrast: true, revision: 7},
    systemColors(name) { requested.push(name); return palette[name]; }};
  const original = {type: 'Microsoft.UI.Xaml.Controls.Button', properties: {Foreground: 'red', Background: '#00000000',
    BorderBrush: 'blue', FocusVisualPrimaryBrush: 'red', Shadow: {kind: 'drop-shadow'}}};
  const policy = controlColorPolicy(original, services);
  assert.equal(policy.node.properties.Foreground, palette.ButtonText);
  assert.equal(policy.node.properties.Background, '#00000000');
  assert.equal(policy.node.properties.BorderBrush, palette.ButtonText);
  assert.equal(policy.node.properties.FocusVisualPrimaryBrush, palette.Highlight);
  assert.equal(policy.node.properties.FocusVisualSecondaryBrush, palette.ButtonFace);
  assert.equal(policy.node.properties.Shadow, null);
  assert.equal(policy.revision, 7);
  assert.equal(original.properties.Foreground, 'red');
  const disabled = controlColorPolicy({...original, properties: {...original.properties, IsEnabled: false}}, services);
  assert.equal(disabled.foreground, palette.GrayText);
  assert.ok(requested.every(name => Object.hasOwn(palette, name)));
  assert.equal(controlColorPolicy(original, {environment: {HighContrast: false}}).node, original);
});
