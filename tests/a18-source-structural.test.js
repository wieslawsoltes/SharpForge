import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {analyzeDesignSources, readDesignSource, DesignDocument, planDesignSourceUpdate, planDesignEventHandler,
  copyDesignSelection, planDesignPaste, CSharpDesignSession} from '@sharpforge/designer';

const source = `using Microsoft.UI.Xaml;using Microsoft.UI.Xaml.Controls;
class View {
  public static Window Create() {
    Window window = new Window();
    Grid root = new Grid();
    Canvas canvas = new Canvas();
    Grid target = new Grid();
    Button action = new Button { Name = "ActionButton", Width = 160, Content = "Run" }; // keep
    Canvas.SetLeft(action, 20);
    Canvas.SetTop(action, 30);
    canvas.Children.Add(action);
    root.Children.Add(canvas);
    root.Children.Add(target);
    window.Content = root;
    return window;
  }
  // handwritten handler must stay byte identical
  static void Spare(object sender, RoutedEventArgs args) { Console.WriteLine("keep"); }
}`;
const compile = text => compileToIL(text, {outputKind: 'library'});

test('insertion changes only new declaration/properties/edge and preserves original construction', () => {
  const analysis = readDesignSource(source);
  const document = new DesignDocument(analysis.document);
  const id = document.add('TextBlock', 'canvas', {Text: 'Added'});
  const plan = planDesignSourceUpdate(analysis, document.value, source, {requireCompilation: true});
  assert.ok(plan.document.nodes.some(node => node.id === id));
  assert.ok(plan.text.includes('Button action = new Button { Name = "ActionButton", Width = 160, Content = "Run" }; // keep'));
  assert.ok(plan.text.includes(source.slice(source.indexOf('  // handwritten'))));
  assert.equal(compile(plan.text).success, true);
});

test('moving Canvas control to Grid removes inapplicable attached setters', () => {
  const analysis = readDesignSource(source);
  const document = new DesignDocument(analysis.document);
  document.move('action', 'target', 0);
  const plan = planDesignSourceUpdate(analysis, document.value, source, {requireCompilation: true});
  assert.ok(!plan.text.includes('Canvas.SetLeft(action'));
  assert.ok(!plan.text.includes('Canvas.SetTop(action'));
  assert.ok(plan.text.includes('target.Children.Add(action);'));
  assert.deepEqual(plan.document.nodes.find(node => node.id === 'target').children, ['action']);
});

test('deletion removes only dependent statements and refuses handwritten references', () => {
  const analysis = readDesignSource(source);
  const document = new DesignDocument(analysis.document);
  document.remove(['action']);
  const plan = planDesignSourceUpdate(analysis, document.value, source, {requireCompilation: true});
  assert.ok(!plan.text.includes('Button action'));
  assert.ok(plan.text.includes('// keep'));
  const fieldSource = source.replace('class View {', 'class View { static Button action;')
    .replace('Button action = new', 'action = new').replace('Console.WriteLine("keep")', 'Console.WriteLine(action.Content)');
  const fieldAnalysis = readDesignSource(fieldSource);
  const fieldDocument = new DesignDocument(fieldAnalysis.document);
  fieldDocument.remove(['action']);
  assert.throws(() => planDesignSourceUpdate(fieldAnalysis, fieldDocument.value), error => {
    assert.equal(error.code, 'SFSYNC_REFERENCE');
    assert.ok(error.details.references.length > 0);
    return true;
  });
});

test('Name edit renames all compiler-bound field references across partial files', () => {
  const files = [
    {uri: 'View.cs', text: `using Microsoft.UI.Xaml;using Microsoft.UI.Xaml.Controls;
partial class View { static Button action;
  static void First() { action.Content = "one"; }
  static void Second() { action.Width = 200; }
  static void Third() { action.Height = 40; }
}`},
    {uri: 'View.g.cs', text: `using Microsoft.UI.Xaml;using Microsoft.UI.Xaml.Controls;
partial class View { static Window Create() {
  Window window = new Window();
  action = new Button { Name = "Action", Width = 160 };
  window.Content = action;
  return window;
}}`}
  ];
  const analysis = analyzeDesignSources(files, {uri: 'View.g.cs'});
  const document = new DesignDocument(analysis.document);
  document.setProperty('Name', 'CommandButton', ['action']);
  const plan = planDesignSourceUpdate(analysis, document.value, files, {requireCompilation: true});
  assert.equal(plan.changes.length, 2);
  assert.ok(plan.sources.every(file => !/\baction\b/.test(file.text)));
  assert.equal(plan.analysis.bindings.action.name, 'CommandButton');
});

test('event handler generation uses delegate signature and repeated activation navigates', () => {
  const analysis = readDesignSource(source);
  const plan = planDesignEventHandler(analysis, 'action', 'Click', {requireCompilation: true});
  assert.equal(plan.handler, 'OnActionButtonClick');
  assert.ok(plan.text.includes('action.Click += OnActionButtonClick;'));
  assert.ok(plan.text.includes('Microsoft.UI.Xaml.RoutedEventArgs args'));
  assert.equal(plan.existing, false);
  const second = planDesignEventHandler(plan.analysis, 'action', 'Click');
  assert.equal(second.existing, true);
  assert.equal(second.text, plan.text);
  assert.equal(second.changes.length, 0);
});

test('cross-document styled clipboard paste de-duplicates controls and style resources', () => {
  const analysis = readDesignSource(source);
  const document = new DesignDocument(analysis.document);
  document.setStyle('Accent', {targetType: 'Button', setters: {FontSize: 19}});
  document.setReference('style', 'Accent', ['action']);
  const styled = planDesignSourceUpdate(analysis, document.value, source, {requireCompilation: true});
  const payload = copyDesignSelection(styled.document, ['action']);
  const pasted = planDesignPaste(analysis, payload, 'target');
  assert.equal(pasted.selection.length, 1);
  const copy = pasted.document.nodes.find(node => node.id === pasted.selection[0]);
  assert.notEqual(copy.properties.Name, 'ActionButton');
  assert.equal(pasted.document.styles[copy.style].setters.FontSize, 19);
  assert.equal(pasted.compilationSucceeded, true);
});

test('session rejects stale, foreign, changed-workspace and disposed plans', () => {
  const session = new CSharpDesignSession(source);
  const document = new DesignDocument(session.document);
  document.setProperty('Width', 180, ['action']);
  const first = session.plan(document.value);
  session.invalidate();
  assert.throws(() => session.commit(first), error => error.code === 'SFSYNC_CONFLICT');
  const second = session.plan(document.value);
  assert.throws(() => session.commit({...second}), error => error.code === 'SFSYNC_CONFLICT');
  assert.throws(() => session.commit(second, {currentSources: [{uri: session.analysis.uri, text: source + ' '}]}), /changed/);
  session.dispose();
  assert.throws(() => session.read(source), error => error.code === 'SFSYNC_CANCELLED');
});
