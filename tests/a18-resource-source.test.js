import test from 'node:test';
import assert from 'node:assert/strict';
import {MEDIA, XAML} from '@sharpforge/framework';
import {
  DesignDocument, createDesignerResourceDocument, generateDesignerResourceClass, readDesignerResourceSource,
  analyzeDesignerResourceSources, probeDesignerResourceSource, planDesignerResourceSourceUpdate,
  renameDesignerResource, normalizeDesignerBrush
} from '@sharpforge/designer';

const uri = 'Resources.cs';
const gradient = normalizeDesignerBrush({valueType: MEDIA + 'LinearGradientBrush',
  GradientStops: [{Color: '#ff0000', Offset: 0}, {Color: '#0000ff', Offset: 1}]});

function fixture() {
  const document = createDesignerResourceDocument({name: 'Resources', resources: {
    Accent: {type: MEDIA + 'Brush', value: gradient},
    ThemeBrush: {kind: 'theme', type: MEDIA + 'Brush', variants: {default: '#ffffff', dark: '#000000'}},
    Text: {type: 'string', value: 'A < B & "quoted" 🎨'}, Count: {type: 'int', value: 7},
    Ratio: {type: 'double', value: 2.5}, Enabled: {type: 'bool', value: false},
    Padding: {type: XAML + 'Thickness', value: '1,2,3,4'},
    Corners: {type: XAML + 'CornerRadius', value: 4}, Track: {type: XAML + 'GridLength', value: '2*'}
  }, styles: {
    Base: {targetType: 'Button', setters: {Width: 120, HorizontalAlignment: 0, Padding: 8}},
    AccentStyle: {targetType: 'Button', basedOn: 'Base', implicit: true, setters: {Background: gradient, IsEnabled: true}}
  }, templates: {Card: {targetType: 'Button', root: {
    id: 'frame', type: 'Border', properties: {Padding: 4}, resourceReferences: {Background: {kind: 'static', key: 'Accent'}},
    children: [{id: 'label', type: 'ContentPresenter', properties: {}, bindings: {Content: 'Content'}, children: []}]
  }, states: [{name: 'CommonStates', states: [
    {name: 'Normal', setters: []}, {name: 'PointerOver', setters: [{target: 'frame', property: 'Opacity', value: 0.5}]}
  ], transitions: [{from: 'Normal', to: 'PointerOver', duration: 200}]}]}}});
  try { return generateDesignerResourceClass(document.value); }
  finally { document.dispose(); }
}

function sources(text = fixture()) { return [{uri, text, version: 3}]; }
function analysis(text = fixture()) { return analyzeDesignerResourceSources(sources(text), {uri}); }

test('resource generated class is recognized and decoded through public compiler/syntax contracts without a native claim', () => {
  const text = fixture();
  const probe = probeDesignerResourceSource(text, uri);
  assert.equal(probe.compatible, true);
  assert.equal(probe.kind, 'resources');
  const result = analysis(text);
  assert.equal(result.previewReady, true);
  assert.equal(result.compilationSucceeded, false);
  assert.equal(result.canApply, false);
  assert.equal(result.targets.nativeWinUI.status, 'unavailable');
  assert.equal(result.targets.source.status, 'unsupported');
  assert.ok(result.compilerDiagnostics.some(item => item.severity === 'error'));
  assert.equal(result.diagnostics[0].code, 'SFD1884');
  assert.equal(result.document.documentKind, 'resources');
  assert.deepEqual(result.document.resources.Accent.value, gradient);
  assert.equal(result.document.resources.Text.value, 'A < B & "quoted" 🎨');
  assert.equal(result.document.resources.Enabled.value, false);
  assert.equal(result.document.resources.Track.value.GridUnitType, 2);
  assert.equal(result.document.styles.AccentStyle.implicit, true);
  assert.equal(result.document.styles.AccentStyle.basedOn, 'Base');
  const template = result.document.templates.Card;
  assert.equal(template.root.resourceReferences.Background.key, 'Accent');
  assert.equal(template.root.children[0].bindings.Content, 'Content');
  assert.equal(template.states[0].states[1].setters[0].target, template.root.id);
  assert.equal(template.states[0].transitions[0].duration, 200);
});

test('no-op round-trip preserves every byte including CRLF, comments and unrelated C#', () => {
  const text = ('// handwritten prefix\n' + fixture() + '\nclass Keep { static string Value() { return "Accent"; } }').replaceAll('\n', '\r\n');
  const base = analysis(text);
  const before = JSON.stringify(base);
  const plan = planDesignerResourceSourceUpdate(base, base.document);
  assert.equal(plan.noOp, true);
  assert.deepEqual(Buffer.from(plan.text), Buffer.from(text));
  assert.deepEqual(plan.edits, []);
  assert.deepEqual(plan.changes, []);
  assert.equal(JSON.stringify(base), before);
});

test('resource rename updates every owned reference and produces a literal-only export candidate with a blocked native gate', () => {
  const text = '// retain before\n' + fixture() + '// retain after\n';
  const base = analysis(text);
  const document = new DesignDocument(base.document);
  renameDesignerResource(document, 'Accent', 'Renamed');
  renameDesignerResource(document, 'Base', 'RenamedBase');
  const plan = planDesignerResourceSourceUpdate(base, document.value);
  assert.equal(plan.canApply, false);
  assert.equal(plan.compilationSucceeded, false);
  assert.equal(plan.edits.length, 1);
  assert.equal(plan.changes.length, 1);
  const edit = plan.edits[0];
  assert.equal(plan.text.slice(0, edit.start), text.slice(0, edit.start));
  assert.equal(plan.text.slice(edit.start + edit.text.length), text.slice(edit.end));
  assert.equal(plan.analysis.document.templates.Card.root.resourceReferences.Background.key, 'Renamed');
  assert.equal(plan.analysis.document.styles.AccentStyle.basedOn, 'RenamedBase');
  assert.ok(plan.analysis.document.resources.Renamed);
  assert.ok(!plan.analysis.document.resources.Accent);
  assert.equal(document.undoStack.length, 2);
  document.undo();
  document.undo();
  assert.deepEqual(document.value, base.document);
  document.dispose();
});

for (const kind of ['verbatim', 'raw']) test(`${kind} C# literal spelling survives a resource value edit`, () => {
  const original = fixture();
  const probe = probeDesignerResourceSource(original, uri);
  const literal = original.slice(probe.span.start, probe.span.start + probe.span.length);
  const markup = JSON.parse(literal);
  const replacement = kind === 'verbatim' ? '@"' + markup.replaceAll('"', '""') + '"' : '"""' + markup + '"""';
  const text = original.slice(0, probe.span.start) + replacement + original.slice(probe.span.start + probe.span.length);
  const base = analysis(text);
  const document = structuredClone(base.document);
  document.resources.Count.value = 9;
  const plan = planDesignerResourceSourceUpdate(base, document);
  assert.ok(plan.edits[0].text.startsWith(kind === 'verbatim' ? '@"' : '"""'));
  assert.equal(plan.analysis.document.resources.Count.value, 9);
});

for (const access of ['resources["Accent"]', 'resources.Lookup("Accent")', 'resources[key]']) {
  test(`unowned ${access} blocks rename with its exact C# span`, () => {
    const consumer = `class Consumer { object Read(Microsoft.UI.Xaml.ResourceDictionary resources, string key) { return ${access}; } }`;
    const files = [...sources(), {uri: 'Consumer.cs', text: consumer, version: 1}];
    const base = analyzeDesignerResourceSources(files, {uri});
    const document = new DesignDocument(base.document);
    renameDesignerResource(document, 'Accent', 'Renamed');
    assert.throws(() => planDesignerResourceSourceUpdate(base, document.value), error => {
      assert.equal(error.code, 'SFD1883');
      assert.equal(error.diagnostic.uri, 'Consumer.cs');
      const span = error.diagnostic.span;
      assert.equal(consumer.slice(span.start, span.start + span.length), access.includes('[key]') ? 'key' : '"Accent"');
      return true;
    });
    assert.equal(files[0].text, base.text);
    assert.ok(document.value.resources.Renamed);
    document.dispose();
  });
}

test('stale versions, changed source sets and read-only files reject atomically', () => {
  const base = analysis();
  const document = structuredClone(base.document);
  document.resources.Count.value = 10;
  assert.throws(() => planDesignerResourceSourceUpdate(base, document, [{...base.sources[0], version: 4}]), {code: 'SFD1882'});
  assert.throws(() => planDesignerResourceSourceUpdate(base, document, []), {code: 'SFD1882'});
  assert.throws(() => planDesignerResourceSourceUpdate(base, document, [{...base.sources[0], readOnly: true}]), {code: 'SFD1885'});
  document.width = 700;
  assert.throws(() => planDesignerResourceSourceUpdate(base, document), {code: 'SFD1880'});
});

test('dynamic loaders, additional statements and ambiguous generated classes are not treated as owned resource sources', () => {
  const text = fixture();
  const span = probeDesignerResourceSource(text, uri).span;
  const dynamic = text.slice(0, span.start) + 'LoadMarkup()' + text.slice(span.start + span.length);
  assert.equal(probeDesignerResourceSource(dynamic, uri).compatible, false);
  assert.equal(probeDesignerResourceSource(text.replace('return (', 'System.Console.WriteLine("keep"); return ('), uri).compatible, false);
  const duplicate = text + text.replace('class Resources', 'class OtherResources');
  assert.equal(probeDesignerResourceSource(duplicate, uri).compatible, false);
  assert.equal(readDesignerResourceSource(duplicate, {uri, className: 'Resources'}).className, 'Resources');
});

for (const markup of [
  '<!DOCTYPE x [<!ENTITY external SYSTEM "https://example.invalid/secret">]><ResourceDictionary/>',
  '<?xml version="1.0"?><ResourceDictionary/>',
  '<ResourceDictionary xmlns="http://foreign.invalid" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"/>',
  '<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">' +
    '<ObjectDataProvider x:Key="Injected"/></ResourceDictionary>'
]) test('unsupported or executable resource markup is rejected without evaluating it: ' + markup.slice(0, 24), () => {
  const text = fixture();
  const span = probeDesignerResourceSource(text, uri).span;
  const changed = text.slice(0, span.start) + JSON.stringify(markup) + text.slice(span.start + span.length);
  assert.throws(() => analysis(changed), error => error.code === 'SFD1887' && error.diagnostic.uri === uri
    && error.diagnostic.span.start === span.start);
});

test('malformed source, cancellation and exact source-size boundary are explicit', () => {
  const text = fixture();
  assert.equal(probeDesignerResourceSource(text, uri, {maxCharacters: text.length}).compatible, true);
  assert.equal(probeDesignerResourceSource(text, uri, {maxCharacters: text.length - 1}).diagnostic.code, 'SFD1881');
  assert.equal(probeDesignerResourceSource(text + '{', uri).compatible, false);
  assert.throws(() => analyzeDesignerResourceSources([]), {code: 'SFD1881'});
  const controller = new AbortController();
  const reason = new Error('cancelled by caller');
  controller.abort(reason);
  assert.throws(() => analyzeDesignerResourceSources(sources(text), {uri, signal: controller.signal}), error => error === reason);
});

test('a dynamic key through an alias of the generated resource dictionary blocks rename', () => {
  const consumer = 'class Consumer { object Read(string key) { var catalog = Resources.Create(); var alias = catalog; return alias[key]; } }';
  const base = analyzeDesignerResourceSources([...sources(), {uri: 'Consumer.cs', text: consumer}], {uri});
  const document = new DesignDocument(base.document);
  renameDesignerResource(document, 'Accent', 'Renamed');
  assert.throws(() => planDesignerResourceSourceUpdate(base, document.value), error => {
    const span = error.diagnostic?.span;
    return error.code === 'SFD1883' && error.diagnostic.uri === 'Consumer.cs' && consumer.slice(span.start, span.start + span.length) === 'key';
  });
  document.dispose();
});
