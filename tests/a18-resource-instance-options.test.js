import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesignerResourceDocument, designerInstancePreviews} from '@sharpforge/designer';

function fixture() {
  return createDesignerResourceDocument({styles: {Compact: {targetType: 'Button', setters: {Width: 94, Height: 31, Content: 'Styled'}}},
    resources: {Logo: {kind: 'theme', type: 'string', variants: {default: 'Images/base.png', dark: 'Images/dark.png',
      highContrast: 'Images/contrast.png'}}},
    templates: {Picture: {targetType: 'Button', root: {id: 'image', type: 'Image', properties: {}, children: [],
      resourceReferences: {Source: {kind: 'theme', key: 'Logo'}}}}}});
}

test('A18 instance previews retain authored style dimensions and default to ten independent scenes', () => {
  const document = fixture();
  const before = document.serialize();
  const previews = designerInstancePreviews(document.value, {resourceKey: 'Compact'});
  assert.equal(previews.length, 10);
  for (const preview of previews) {
    const root = preview.scene.nodes.find(node => node.id === 'preview');
    assert.equal(root.properties.Width, 94);
    assert.equal(root.properties.Height, 31);
    assert.equal(root.properties.Content, 'Styled');
    assert.deepEqual(root.events, []);
    if (preview.state === 'Disabled') assert.equal(root.properties.IsEnabled, false);
  }
  previews[0].scene.nodes[0].properties.Width = 500;
  assert.equal(previews[1].scene.nodes[0].properties.Width, 94);
  assert.equal(document.serialize(), before);
  document.dispose();
});

test('A18 explicit preview subsets preserve order, theme references and authorized asset resolution', () => {
  const document = fixture();
  const before = document.serialize();
  const previews = designerInstancePreviews(document.value, {resourceKey: 'Picture', kind: 'template',
    themes: ['highContrast', 'dark'], states: ['Disabled', 'Normal'], resolveAsset: uri => 'blob:' + uri});
  assert.deepEqual(previews.map(({theme, state}) => [theme, state]), [
    ['highContrast', 'Disabled'], ['highContrast', 'Normal'], ['dark', 'Disabled'], ['dark', 'Normal']
  ]);
  for (const preview of previews) {
    const image = preview.scene.nodes.find(node => node.id === 'preview::image');
    assert.equal(image.properties.Source, 'blob:Images/' + (preview.theme === 'dark' ? 'dark' : 'contrast') + '.png');
  }
  assert.equal(document.serialize(), before);
  document.dispose();
});

test('A18 preview option bounds and unknown resources reject before creating any scene', () => {
  const document = fixture();
  const before = document.serialize();
  const cases = [
    {themes: []}, {themes: ['light', 'light']}, {themes: ['unknown']}, {themes: ['light', 'dark', 'highContrast', 'light']},
    {states: []}, {states: ['Pressed', 'Pressed']}, {states: ['NotAState']},
    {states: ['Normal', 'PointerOver', 'Pressed', 'Disabled', 'Focused', 'Normal']},
    {kind: 'brush'}, {resolveAsset: 'not a function'}, {resourceKey: 'Missing'}
  ];
  for (const options of cases) {
    assert.throws(() => designerInstancePreviews(document.value, {resourceKey: 'Compact', ...options}), {code: 'SFD1854'});
  }
  assert.equal(document.serialize(), before);
  document.dispose();
});
