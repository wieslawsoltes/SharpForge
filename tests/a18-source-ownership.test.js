import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeDesignSources, readDesignSource, designSourceSnapshot, DesignDocument, planDesignSourceUpdate} from '@sharpforge/designer';

const source = `using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
partial class View {
  public static Window Create() {
    Window window = new Window();
    Canvas panel = new Canvas();
    Button action = new Button { Width = 160, Content = "Run" };
    Canvas.SetLeft(action, 20);
    action.Click += OnClick;
    panel.Children.Add(action);
    window.Content = panel;
    return window;
  }
  static void OnClick(object sender, RoutedEventArgs args) { }
}`;

const partials = [
  {uri: 'View.cs', text: `using Microsoft.UI.Xaml;using Microsoft.UI.Xaml.Controls;
partial class View {
  static Button action;
  static Window window;
  static Canvas panel;
  static void OnClick(object sender, RoutedEventArgs args) { action.Content = "Clicked"; }
}`},
  {uri: 'View.g.cs', text: `using Microsoft.UI.Xaml;using Microsoft.UI.Xaml.Controls;
partial class View {
  public static Window Create() {
    window = new Window();
    panel = new Canvas();
    action = new Button { Width = 160, Content = "Run" };
    action.Click += OnClick;
    panel.Children.Add(action);
    window.Content = panel;
    return window;
  }
}`}
];

test('semantic construction binds fields and handlers across partial declarations', () => {
  const analysis = analyzeDesignSources(partials, {uri: 'View.g.cs'});
  assert.equal(analysis.bindings.action.field, true);
  assert.equal(analysis.bindings.action.fieldDeclaration.uri, 'View.cs');
  assert.equal(analysis.bindings.action.declaration.uri, 'View.cs');
  assert.ok(analysis.bindings.action.references.some(reference => reference.uri === 'View.cs' && !reference.declaration));
  assert.equal(analysis.bindings.action.events.Click.location.uri, 'View.cs');
  assert.equal(analysis.compilationSucceeded, true, JSON.stringify(analysis.compilerDiagnostics));
});

test('every direct construction statement has exactly one JSON ownership region', () => {
  const analysis = readDesignSource(source);
  assert.equal(analysis.ownership.regions.length, analysis.method.body.statements.length);
  const spans = new Set(analysis.ownership.regions.map(region => region.span.start + ':' + region.span.end));
  assert.equal(spans.size, analysis.method.body.statements.length);
  assert.deepEqual(JSON.parse(JSON.stringify(analysis.ownership)), analysis.ownership);
  const snapshot = designSourceSnapshot(analysis);
  assert.equal(snapshot.bindings.action.events.Click.capability, 'edit');
  assert.doesNotThrow(() => structuredClone(snapshot));
});

test('multiple subscriptions and lambdas remain read-only and navigable', () => {
  for (const handler of ['OnClick', '(sender, args) => { action.Content = "Lambda"; }']) {
    const text = source.replace('action.Click += OnClick;', `action.Click += OnClick; action.Click += ${handler};`);
    const analysis = readDesignSource(text);
    const event = designSourceSnapshot(analysis).bindings.action.events.Click;
    assert.equal(event.capability, 'navigate');
    assert.equal(event.subscriptions.length, 2);
    assert.equal(event.subscriptions[1].protected, handler !== 'OnClick');
    const document = new DesignDocument(analysis.document);
    document.change('handler', candidate => { candidate.nodes.find(node => node.id === 'action').events.Click = 'Other'; });
    assert.throws(() => planDesignSourceUpdate(analysis, document.value), error => error.code === 'SFSYNC_EVENT');
  }
});

test('protected expressions survive unrelated scalar edits byte-for-byte', () => {
  const text = source.replace('Width = 160', 'Width = /* handwritten */ ComputeWidth()')
    .replace('static void OnClick', 'static double ComputeWidth() { return 160; }\n  static void OnClick');
  const analysis = readDesignSource(text);
  const document = new DesignDocument(analysis.document);
  document.setProperty('Content', 'Changed', ['action']);
  const plan = planDesignSourceUpdate(analysis, document.value);
  assert.ok(plan.text.includes('Width = /* handwritten */ ComputeWidth()'));
  document.setProperty('Width', 200, ['action']);
  assert.throws(() => planDesignSourceUpdate(analysis, document.value), error => error.code === 'SFSYNC_DYNAMIC');
});

test('renaming and moving C# statements retains design node identities', () => {
  const first = readDesignSource(source);
  const renamed = source.replaceAll('action', 'commandButton');
  const second = readDesignSource(renamed, {previous: first});
  assert.equal(second.bindings.action.name, 'commandButton');
  assert.equal(second.document.nodes.find(node => node.id === 'action').properties.Content, 'Run');
  const moved = renamed.replace('    Canvas.SetLeft(commandButton, 20);\n', '')
    .replace('    commandButton.Click', '    Canvas.SetLeft(commandButton, 20);\n    commandButton.Click');
  const third = readDesignSource(moved, {previous: second});
  assert.equal(third.bindings.action.name, 'commandButton');
});

test('malformed, ambiguous, duplicate, size-limited and cancelled requests are explicit', () => {
  assert.throws(() => readDesignSource(source.replace('new Window()', 'new Window(')), error => error.code === 'SFSYNC_PARSE');
  assert.throws(() => analyzeDesignSources([{uri: 'x.cs', text: source}, {uri: 'x.cs', text: source}]), /unique/);
  assert.throws(() => readDesignSource(source, {maxBytes: 8}), error => error.code === 'SFSYNC_LIMIT');
  assert.throws(() => readDesignSource(source, {maxNodes: 1}), error => error.code === 'SFSYNC_LIMIT');
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => readDesignSource(source, {signal: controller.signal}), error => error.code === 'SFSYNC_CANCELLED');
});

export {source, partials};
