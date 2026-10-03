import test from 'node:test';
import assert from 'node:assert/strict';
import {readDesignSource, designSourceSnapshot, DesignDocument, planDesignSourceUpdate} from '@sharpforge/designer';

const source = `using Microsoft.UI.Xaml.Controls;
namespace Example {
  partial class Widget : UserControl {
    void InitializeComponent() {
      var root = new Grid();
      var action = new Button() { Content = "Owned" };
      root.Children.Add(action);
      this.Content = root;
    }
  }
}`;
const options = {uri: 'Widget.cs', className: 'Example.Widget', methodName: 'InitializeComponent'};

test('instance component content has serialized source evidence without adding an editable synthetic node', () => {
  const analysis = readDesignSource(source, options);
  const evidence = designSourceSnapshot(analysis).ownership.rootAssignment;
  assert.equal(evidence.owner, 'Example.Widget');
  assert.equal(evidence.methodName, 'InitializeComponent');
  assert.equal(evidence.receiver, 'this');
  assert.equal(evidence.property, 'Content');
  assert.equal(evidence.childId, analysis.document.root);
  assert.deepEqual(evidence.capabilities, ['preview', 'navigate']);
  assert.equal(source.slice(evidence.span.start, evidence.span.end), 'this.Content = root;');
  assert.deepEqual(analysis.document.nodes.map(node => node.id), ['root', 'action']);
  assert.equal(analysis.compilationSucceeded, false);
  assert.ok(analysis.compilerDiagnostics.some(diagnostic => diagnostic.code === 'SF2200' && diagnostic.severity === 'error'));
  assert.throws(() => planDesignSourceUpdate(analysis, analysis.document, source, {requireCompilation: true}),
    error => error.code === 'SFSYNC_COMPILE');
});

test('component root evidence follows retained identities after source symbol rename', () => {
  const previous = readDesignSource(source, options);
  const text = source.replaceAll('root', 'surface');
  const analysis = readDesignSource(text, {...options, previous});
  assert.equal(analysis.identityRemap.surface, 'root');
  assert.equal(analysis.ownership.rootAssignment.childId, 'root');
  assert.equal(analysis.bindings.root.name, 'surface');
});

test('inline instance content exposes literal edits on the actual construction expression', () => {
  const text = source.replace('var root = new Grid();\n      var action = new Button() { Content = "Owned" };\n' +
    '      root.Children.Add(action);\n      this.Content = root;', 'this.Content = new Grid() { Width = 160 };');
  const analysis = readDesignSource(text, options);
  const document = new DesignDocument(analysis.document);
  document.setProperty('Width', 200, [document.value.root]);
  const plan = planDesignSourceUpdate(analysis, document.value);
  assert.equal(plan.text, text.replace('Width = 160', 'Width = 200'));
  assert.equal(plan.analysis.ownership.rootAssignment.childId, document.value.root);
});

test('computed instance content does not claim direct root ownership', () => {
  const text = source.replace('this.Content = root;', 'this.Content = MakeContent();')
    .replace('void InitializeComponent()', 'Grid MakeContent() { return new Grid(); }\n    void InitializeComponent()');
  const analysis = readDesignSource(text, options);
  assert.equal(analysis.ownership.rootAssignment, undefined);
  assert.equal(analysis.structuralEditable, false);
});
