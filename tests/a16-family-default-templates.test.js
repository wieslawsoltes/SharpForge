import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultControlTemplates, defaultControlTemplate, materializeDefaultControlStyle, controlVisualStates }
  from '../packages/winui-controls/src/policy/default-templates.js';

function materializer() {
  const nodes = [];
  return { nodes, hasProperty: () => true,
    create(type, properties) { const value = { type, properties, bindings: {}, resources: {}, children: [] }; nodes.push(value); return value; },
    bind(node, property, source) { node.bindings[property] = source; },
    resource(node, property, key) { node.resources[property] = key; },
    child(parent, child) { parent.children = [child]; },
    children(parent, children) { parent.children = children; },
    template(type, root, information) { return { type, root, ...information }; },
    states(template, groups) { template.groups = structuredClone(groups); },
    style(type, setters) { return { type, setters }; }
  };
}

test('every default template creates named managed visuals and fresh instance state', () => {
  for (const description of defaultControlTemplates) {
    assert.equal(Object.isFrozen(description.visualTree), true);
    for (const type of description.types) {
      const first = materializeDefaultControlStyle(type, materializer());
      const second = materializeDefaultControlStyle(type, materializer());
      assert.notEqual(first.setters.Template.root, second.setters.Template.root);
      if (description.family === 'ScrollView') {
        assert.equal(first.setters.Template.parts.get('PART_ScrollPresenter').type,
          'Microsoft.UI.Xaml.Controls.Primitives.ScrollPresenter');
        assert.equal(first.setters.Template.parts.size, 1);
        const bindings = first.setters.Template.parts.get('PART_ScrollPresenter').bindings;
        for (const property of ['ContentOrientation', 'HorizontalScrollBarVisibility', 'VerticalScrollBarVisibility',
          'HorizontalAnchorRatio', 'VerticalAnchorRatio']) assert.equal(bindings[property], property);
        continue;
      }
      assert.ok(first.setters.Template.parts.has('PART_BehaviorRoot'));
      assert.ok(first.setters.Template.parts.has('RootBorder'));
      assert.ok(first.setters.Template.parts.has('FocusVisual'));
      assert.notEqual(first.setters.Template.groups, second.setters.Template.groups);
      const selected = first.setters.Template.groups.find(group => group.name === 'SelectionStates').states[1];
      assert.equal(selected.setters[0].target, 'SelectionVisual');
    }
  }
});

test('Button defaults and ContentTemplate bindings belong to the managed style', () => {
  const style = materializeDefaultControlStyle('Button', materializer());
  assert.equal(style.setters.MinHeight, 32);
  assert.deepEqual(style.setters.Padding, { Left: 11, Top: 5, Right: 11, Bottom: 6 });
  assert.deepEqual(style.setters.Template.parts.get('PART_BehaviorRoot').bindings,
    { Content: 'Content', ContentTemplate: 'ContentTemplate', ContentTemplateSelector: 'ContentTemplateSelector' });
});

test('Expander has distinct typed header and content presenters for native behavior integration', () => {
  const style = materializeDefaultControlStyle('Expander', materializer());
  const parts = style.setters.Template.parts;
  assert.equal(parts.get('ExpanderLayoutRoot').type, 'Microsoft.UI.Xaml.Controls.StackPanel');
  assert.equal(parts.get('HeaderPresenter').bindings.Content, 'Header');
  assert.equal(parts.get('HeaderPresenter').bindings.ContentTemplate, 'HeaderTemplate');
  assert.equal(parts.get('PART_BehaviorRoot').bindings.Content, 'Content');
  assert.notEqual(parts.get('HeaderPresenter'), parts.get('PART_BehaviorRoot'));
});

test('unknown controls receive no fabricated template and optional bindings respect declared properties', () => {
  assert.equal(defaultControlTemplate('NotAControl'), null);
  assert.equal(materializeDefaultControlStyle('NotAControl', materializer()), null);
  const factory = materializer();
  factory.hasProperty = (_type, property) => property !== 'ContentTemplateSelector';
  const value = materializeDefaultControlStyle('Button', factory);
  assert.equal(value.setters.Template.parts.get('PART_BehaviorRoot').bindings.ContentTemplateSelector, undefined);
  assert.deepEqual(controlVisualStates({ IsEnabled: false, IsPressed: true, FocusState: 2, IsSelected: true }),
    ['Disabled', 'Focused', 'Selected']);
});
