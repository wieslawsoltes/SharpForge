import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeDesignSources, planDesignSourceUpdate, generateDesignProject, generateDesignCode} from '@sharpforge/designer';
import {compileToIL} from '@sharpforge/compiler';
import {viewportDesign, viewportSources, viewportOptions, viewportUri} from './fixtures/a18-adaptive-viewport.js';

function analyze(sources) {
  const analysis = analyzeDesignSources(sources, viewportOptions);
  assert.equal(analysis.compilationSucceeded, true, JSON.stringify(analysis.compilerDiagnostics));
  return analysis;
}

function edit(analysis, update) {
  const document = structuredClone(analysis.document);
  update(document);
  const plan = planDesignSourceUpdate(analysis, document, analysis.sources, {requireCompilation: true});
  assert.equal(plan.compilationSucceeded, true, JSON.stringify(plan.diagnostics));
  return plan;
}

test('generated viewport ownership round-trips without taking a user event or changing a no-op source snapshot', () => {
  const sources = viewportSources().map(file => ({...file, text: file.text
    .replace('ApplyAdaptive(800.0);', 'v_window.SizeChanged += OtherResize;\n        ApplyAdaptive(800.0);')
    .replace('    private static void OnAdaptiveSizeChanged',
      '    private static void OtherResize(object sender, Microsoft.UI.Xaml.WindowSizeChangedEventArgs args) { }\n'
      + '    private static void OnAdaptiveSizeChanged')}));
  const analysis = analyze(sources);
  assert.equal(analysis.structuralEditable, true);
  assert.equal(analysis.responsiveSource.viewport.windowId, 'window');
  assert.equal(analysis.document.nodes.find(node => node.id === 'window').events.SizeChanged, 'OtherResize');
  assert.equal(analysis.bindings.window.events.SizeChanged.subscriptions.length, 1);
  assert.equal(analysis.warnings.some(item => item.code === 'SFD_RESPONSIVE_HOST_RESIZE'), false);
  const unchanged = edit(analysis, () => {});
  assert.deepEqual(unchanged.changes, []);
  assert.deepEqual(unchanged.sources, sources);
  const revised = edit(analysis, document => { document.responsive.states[0].overrides.action.Width = 112; });
  assert.equal(revised.analysis.responsiveSource.viewport.handlerName, 'OnAdaptiveSizeChanged');
  assert.match(revised.sources[0].text, /v_action.Width = 112.0;/);
  const removed = edit(revised.analysis, document => { delete document.responsive; });
  assert.doesNotMatch(removed.sources[0].text, /OnAdaptiveSizeChanged|ApplyAdaptive|SharpForge adaptive/);
  assert.match(removed.sources[0].text, /SizeChanged \+= OtherResize/);
  assert.equal(removed.analysis.document.nodes.find(node => node.id === 'window').events.SizeChanged, 'OtherResize');
});

test('first adaptive authoring owns a named adapter only for static fields; construction-local targets stay explicit', () => {
  const design = viewportDesign();
  delete design.responsive;
  const initial = analyze(viewportSources(design));
  const added = edit(initial, document => { document.responsive = viewportDesign().responsive; });
  assert.equal(added.analysis.responsiveSource.viewport.handlerName, 'OnAdaptiveSizeChanged');
  assert.match(added.sources[0].text, /v_window.SizeChanged \+= OnAdaptiveSizeChanged;/);
  const local = `class DesignedView {
    public static Microsoft.UI.Xaml.Window Create() {
      Microsoft.UI.Xaml.Window window = new Microsoft.UI.Xaml.Window();
      Microsoft.UI.Xaml.Controls.Button action = new Microsoft.UI.Xaml.Controls.Button { Name = "Action", Width = 160 };
      window.Content = action;
      return window;
    }
  }`;
  const localAnalysis = analyze([{uri: viewportUri, text: local}]);
  const manual = edit(localAnalysis, document => {
    document.responsive = {version: 1, states: [{id: 'Wide', minWidth: 600, maxWidth: null, overrides: {action: {Width: 240}}}]};
  });
  assert.equal(manual.analysis.responsiveSource.viewport, null);
  assert.doesNotMatch(manual.sources[0].text, /SizeChanged \+=/);
  assert.ok(manual.analysis.warnings.some(item => item.code === 'SFD_RESPONSIVE_HOST_RESIZE'));
  assert.deepEqual(edit(manual.analysis, () => {}).changes, []);
});

test('edited or duplicate adapters are rejected; external references, cancellation and stale snapshots remain protected', () => {
  const sources = viewportSources();
  for (const replace of [text => text.replace('ApplyAdaptive(args.Size.Width)', 'ApplyAdaptive(args.Size.Height)'),
    text => text.replace('ApplyAdaptive(args.Size.Width);', 'ApplyAdaptive(args.Size.Width); System.Console.WriteLine(1);'),
    text => text.replace('v_window.SizeChanged += OnAdaptiveSizeChanged;',
      'v_window.SizeChanged += OnAdaptiveSizeChanged; v_window.SizeChanged += OnAdaptiveSizeChanged;')]) {
    assert.throws(() => analyzeDesignSources(sources.map(file => ({...file, text: replace(file.text)})), viewportOptions),
      {code: 'SFSYNC_OWNERSHIP'});
  }
  const referenced = sources.map(file => ({...file, text: file.text.replace('    public static Microsoft.UI.Xaml.Window Create()',
    '    static void UserReference() { OnAdaptiveSizeChanged(null, null); }\n    public static Microsoft.UI.Xaml.Window Create()')}));
  assert.throws(() => edit(analyze(referenced), document => { delete document.responsive; }), {code: 'SFSYNC_REFERENCE'});
  const analysis = analyze(sources);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => planDesignSourceUpdate(analysis, analysis.document, sources, {signal: controller.signal}), {code: 'SFSYNC_CANCELLED'});
  assert.throws(() => planDesignSourceUpdate(analysis, analysis.document, sources.map(file => ({...file, version: 2}))),
    {code: 'SFSYNC_CONFLICT'});
  assert.deepEqual(analysis.sources, sources);
});

test('adding a construction-local adaptive target removes only the automatic adapter and preserves an executable explicit helper', () => {
  const sources = viewportSources().map(file => ({...file, text: file.text.replace('ApplyAdaptive(800.0);',
    'Microsoft.UI.Xaml.Controls.Button other = new Microsoft.UI.Xaml.Controls.Button { Name = "Other", Width = 80 };\n'
    + '        v_canvas.Children.Add(other);\n        ApplyAdaptive(800.0);')}));
  const analysis = analyze(sources);
  const changed = edit(analysis, document => { document.responsive.states[0].overrides.other = {Width: 120}; });
  assert.equal(changed.analysis.responsiveSource.viewport, null);
  assert.deepEqual(changed.analysis.responsiveSource.targets.map(target => target.id), ['other']);
  assert.doesNotMatch(changed.sources[0].text, /OnAdaptiveSizeChanged|SizeChanged \+=/);
  assert.match(changed.sources[0].text, /ApplyAdaptive\(800.0, other\)/);
  assert.ok(changed.analysis.warnings.some(item => item.code === 'SFD_RESPONSIVE_HOST_RESIZE'));
});

test('WinUI markup export and generated project event stubs retain the native resize signature', () => {
  const design = viewportDesign();
  design.nodes.find(node => node.id === 'window').events.SizeChanged = 'Program.Resize';
  const project = generateDesignProject(design);
  const compilation = compileToIL(project.filter(file => file.path.endsWith('.cs')).map(file => ({uri: file.path, text: file.text})));
  assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));
  assert.match(project.find(file => file.path === 'Program.cs').text, /Resize\(object sender, Microsoft.UI.Xaml.WindowSizeChangedEventArgs args\)/);
  design.resources = {Accent: {kind: 'value', type: 'Microsoft.UI.Xaml.Media.Brush', value: '#ff0000'}};
  const exported = generateDesignCode(design, {target: 'winui'});
  assert.match(exported, /Markup.XamlReader.Load/);
  assert.match(exported, /v_window.SizeChanged \+= OnAdaptiveSizeChanged;/);
  assert.match(exported, /ApplyAdaptive\(args.Size.Width\)/);
});
