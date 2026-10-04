import test from 'node:test';
import assert from 'node:assert/strict';
import {readDesignSource, DesignDocument, planDesignSourceUpdate} from '@sharpforge/designer';

const source = `using Microsoft.UI.Xaml;using Microsoft.UI.Xaml.Controls;
class View { static Window Create() {
  var window = new Window();
  var panel = new StackPanel { Children = {
    new Button { Content = "One", Width = 160 }, // retain first comment
    new Button { Content = "Two" }
  } };
  window.Content = panel;
  return window;
} }`;

function first(analysis) { return analysis.document.nodes.find(node => node.properties.Content === 'One'); }

test('nested collection initializers map controls and preserve original literal form', () => {
  const analysis = readDesignSource(source);
  const document = new DesignDocument(analysis.document);
  assert.equal(analysis.document.nodes.length, 4);
  document.setProperty('Width', 200, [first(analysis).id]);
  const plan = planDesignSourceUpdate(analysis, document.value);
  assert.equal(plan.text, source.replace('Width = 160', 'Width = 200'));
  assert.equal(plan.compilationSucceeded, false);
  assert.ok(plan.diagnostics.some(diagnostic => diagnostic.severity === 'error'));
});

test('adding an inline property edits the initializer rather than inventing a variable', () => {
  const analysis = readDesignSource(source);
  const document = new DesignDocument(analysis.document);
  document.setProperty('Height', 40, [first(analysis).id]);
  const plan = planDesignSourceUpdate(analysis, document.value);
  assert.ok(plan.text.includes('Width = 160, Height = 40.0'));
  assert.ok(!plan.text.includes('panel_Children_0.Height'));
  assert.equal(first(plan.analysis).properties.Height, 40);
});

test('deleting an inline collection child preserves siblings and comments', () => {
  const analysis = readDesignSource(source);
  const document = new DesignDocument(analysis.document);
  document.remove([first(analysis).id]);
  const plan = planDesignSourceUpdate(analysis, document.value);
  assert.ok(!plan.text.includes('Content = "One"'));
  assert.ok(plan.text.includes('Content = "Two"'));
  assert.ok(plan.text.includes('// retain first comment'));
  assert.equal(plan.document.nodes.length, 3);
});

test('inline Name edits update the literal without a fictitious symbol rename', () => {
  const analysis = readDesignSource(source);
  const document = new DesignDocument(analysis.document);
  document.setProperty('Name', 'FirstButton', [first(analysis).id]);
  const plan = planDesignSourceUpdate(analysis, document.value);
  assert.equal(first(plan.analysis).properties.Name, 'FirstButton');
  assert.ok(plan.text.includes('Name = "FirstButton"'));
});

test('active partial containing only fields discovers construction in its sibling file', () => {
  const primary = {uri: 'View.cs', text: 'partial class View { static Microsoft.UI.Xaml.Controls.Button action; }'};
  const generated = {uri: 'View.g.cs', text: `partial class View { static Microsoft.UI.Xaml.Window Create() {
  var window = new Microsoft.UI.Xaml.Window();
  action = new Microsoft.UI.Xaml.Controls.Button();
  window.Content = action;
  return window;
} }`};
  const analysis = readDesignSource(primary.text, {uri: primary.uri, sources: [primary, generated]});
  assert.equal(analysis.uri, generated.uri);
  assert.equal(analysis.bindings.action.field, true);
});
