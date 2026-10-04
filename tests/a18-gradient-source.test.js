import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeDesignSources, planDesignSourceUpdate, CSharpDesignSession, normalizeDesignerBrush, csharpValue,
  DesignDocument, generateDesignCode
} from '@sharpforge/designer';
import {MEDIA} from '@sharpforge/framework';
import {gradientUri, gradientOptions, gradientBrush, gradientDesign, gradientSources, compileGradient,
  runGradient, gradientVisual} from './fixtures/a18-gradients.js';

function analyze(sources) {
  const analysis = analyzeDesignSources(sources, gradientOptions);
  assert.equal(analysis.compilationSucceeded, true, JSON.stringify(analysis.compilerDiagnostics));
  return analysis;
}

function changeBrush(analysis, brush) {
  const document = structuredClone(analysis.document);
  document.nodes.find(node => node.id === 'action').properties.Background = brush;
  return document;
}

function background(analysis) {
  return analysis.document.nodes.find(node => node.id === 'action').properties.Background;
}

function verify(sources, expected, body) {
  const effective = normalizeDesignerBrush({...expected, Opacity: expected.Opacity ?? 1});
  runGradient(compileGradient(sources, body), machine => {
    assert.deepEqual(normalizeDesignerBrush(gradientVisual(machine).properties.Background), effective, machine.constructor.name);
    machine.heap.collect();
    assert.deepEqual(normalizeDesignerBrush(gradientVisual(machine).properties.Background), effective);
  });
}

function executableSources(source) {
  return [source, {uri: 'App/Program.cs', version: 1,
    text: 'class Program { static void Main() { DesignedView.Create(); } }'}];
}

test('A18 generated relative gradients compile, reopen and execute with exact points, alpha and equal-offset order', () => {
  const sources = gradientSources();
  const analysis = analyze(sources);
  assert.deepEqual(background(analysis), gradientBrush());
  assert.equal(analysis.bindings.action.properties.Background.dynamic, undefined);
  assert.match(sources[0].text, /GradientStops = new Microsoft\.UI\.Xaml\.Media\.GradientStopCollection\(\)/);
  verify(sources, gradientBrush());
});

test('A18 gradient source no-ops preserve line endings and surrounding comments byte for byte', () => {
  const source = gradientSources()[0];
  for (const text of [source.text, source.text.replaceAll('\n', '\r\n')]) {
    const sources = [{...source, text: '// handwritten preface\n' + text + '\n// handwritten suffix'}];
    const analysis = analyze(sources);
    const plan = planDesignSourceUpdate(analysis, analysis.document, sources, {requireCompilation: true});
    assert.deepEqual(plan.sources, sources);
    assert.deepEqual(plan.changes, []);
  }
});

test('A18 gradient edits preserve source identity, compile and round-trip solid-to-gradient-to-solid', () => {
  const solid = normalizeDesignerBrush('#ff203040');
  let sources = gradientSources(solid);
  for (const brush of [gradientBrush(), gradientBrush({StartPoint: {X: 0.3, Y: -1}, Opacity: 0.25}), solid]) {
    const analysis = analyze(sources);
    const baseline = structuredClone(analysis.document);
    const before = structuredClone(sources);
    const plan = planDesignSourceUpdate(analysis, changeBrush(analysis, brush), sources, {requireCompilation: true});
    assert.equal(plan.compilationSucceeded, true, JSON.stringify(plan.diagnostics));
    assert.equal(plan.changes.length, 1);
    assert.deepEqual(analysis.document, baseline);
    assert.deepEqual(sources, before);
    assert.deepEqual(background(plan.analysis), brush);
    assert.deepEqual(background(analyze(plan.sources)), brush);
    verify(plan.sources, brush);
    sources = plan.sources;
  }
});

test('A18 gradient source honors aliased framework types and compiler-proven integral division and casts', () => {
  const source = gradientSources()[0];
  const text = 'using Paint = Microsoft.UI.Xaml.Media.LinearGradientBrush;\n'
    + 'using Stops = Microsoft.UI.Xaml.Media.GradientStopCollection;\nusing ColorValue = Windows.UI.Color;\n'
    + source.text.replaceAll('new Microsoft.UI.Xaml.Media.LinearGradientBrush()', 'new Paint()')
      .replaceAll('new Microsoft.UI.Xaml.Media.GradientStopCollection()', 'new Stops()')
      .replaceAll('Windows.UI.Color.FromArgb', 'ColorValue.FromArgb')
      .replace('Offset = 1', 'Offset = 3 / 2').replace('Opacity = 0.75', 'Opacity = (int)0.75');
  const sources = executableSources({...source, text});
  const expected = gradientBrush({Opacity: 0});
  const analysis = analyze(sources);
  assert.deepEqual(background(analysis), expected);
  verify(sources, expected, null);
  const changed = planDesignSourceUpdate(analysis, changeBrush(analysis, gradientBrush()),
    sources, {requireCompilation: true});
  assert.deepEqual(background(changed.analysis), gradientBrush());
  assert.equal(changed.sources.find(file => file.uri === 'App/Program.cs').text, sources[1].text);
  verify(changed.sources, gradientBrush(), null);
});

test('A18 source owns the authoring stop boundaries and rejects unsupported modes without dropping fields', () => {
  for (const count of [2, 64]) {
    const brush = gradientBrush({GradientStops: Array.from({length: count}, (_, index) => ({
      Offset: index / (count - 1), Color: index % 2 ? '#ffffffff' : '#ff000000'
    }))});
    const sources = gradientSources(brush);
    assert.deepEqual(background(analyze(sources)), brush);
    verify(sources, brush);
  }
  for (const additions of [{MappingMode: 1}, {SpreadMethod: 2}, {ColorInterpolationMode: 1}, {Transform: {}}]) {
    assert.throws(() => normalizeDesignerBrush({...gradientBrush(), ...additions}), error => error.code === 'SFD1811');
  }
  assert.throws(() => normalizeDesignerBrush(gradientBrush({GradientStops: []})), /at least two/);
});

test('A18 gradients in style setters and template factories compile and reopen through the existing owned resource path', () => {
  const document = new DesignDocument(gradientDesign());
  document.setProperty('Background', undefined, ['action']);
  document.setStyle('Paint', {targetType: 'Button', setters: {Background: gradientBrush()}});
  document.setReference('style', 'Paint', ['action']);
  document.setTemplate('Frame', {targetType: 'Button', root: {id: 'frame', type: 'Border',
    properties: {Name: 'Frame', Background: gradientBrush({Opacity: 0.25})}, children: []}});
  document.setReference('template', 'Frame', ['action']);
  const sources = [{uri: gradientUri, version: 1, text: generateDesignCode(document.value)}];
  const analysis = analyze(sources);
  assert.deepEqual(analysis.document.styles.Paint.setters.Background, gradientBrush());
  assert.deepEqual(analysis.document.templates.Frame.root.properties.Background, gradientBrush({Opacity: 0.25}));
  runGradient(compileGradient(sources), machine => {
    assert.deepEqual(normalizeDesignerBrush(gradientVisual(machine).properties.Background), gradientBrush());
    assert.deepEqual(normalizeDesignerBrush(gradientVisual(machine, 'Frame').properties.Background), gradientBrush({Opacity: 0.25}));
  });
  const changed = structuredClone(analysis.document);
  changed.styles.Paint.setters.Background = gradientBrush({Opacity: 0.4});
  changed.templates.Frame.root.properties.Background = gradientBrush({Opacity: 0.6});
  const plan = planDesignSourceUpdate(analysis, changed, sources, {requireCompilation: true});
  assert.deepEqual(plan.document.styles.Paint.setters.Background, gradientBrush({Opacity: 0.4}));
  assert.deepEqual(plan.document.templates.Frame.root.properties.Background, gradientBrush({Opacity: 0.6}));
  runGradient(compileGradient(plan.sources), machine => {
    assert.deepEqual(normalizeDesignerBrush(gradientVisual(machine).properties.Background), gradientBrush({Opacity: 0.4}));
    assert.deepEqual(normalizeDesignerBrush(gradientVisual(machine, 'Frame').properties.Background), gradientBrush({Opacity: 0.6}));
  });
  document.dispose();
});

test('A18 dynamic gradient arguments stay protected instead of being evaluated or overwritten', () => {
  const source = gradientSources()[0];
  for (const expression of ['System.Math.Abs(-0.75)', 'amount']) {
    const text = source.text.replace('Opacity = 0.75', 'Opacity = ' + expression);
    const withLocal = expression === 'amount' ? text.replace('{\n', '{\n    static double amount = 0.75;\n') : text;
    const sources = [{...source, text: withLocal}];
    compileGradient(sources);
    const analysis = analyze(sources);
    assert.equal(analysis.bindings.action.properties.Background.dynamic, true);
    assert.equal(background(analysis), undefined);
    assert.throws(() => planDesignSourceUpdate(analysis, changeBrush(analysis, gradientBrush()), sources),
      error => error.code === 'SFSYNC_DYNAMIC' || error.code === 'SFSYNC_OWNERSHIP');
    assert.equal(sources[0].text, withLocal);
  }
});

test('A18 a source-defined Color.FromArgb cannot impersonate the registered closed color operation', () => {
  const source = gradientSources()[0];
  const text = source.text.replaceAll('Windows.UI.Color.FromArgb', 'Color.FromArgb') + `
    class Color {
      public static Windows.UI.Color FromArgb(byte a, byte r, byte g, byte b) { return Microsoft.UI.Colors.Blue; }
    }`;
  const sources = executableSources({...source, text});
  runGradient(compileGradient(sources, null), machine => {
    const value = normalizeDesignerBrush(gradientVisual(machine).properties.Background);
    assert(value.GradientStops.every(stop => stop.Color.B === 255 && stop.Color.R === 0 && stop.Color.G === 0));
  });
  const analysis = analyze(sources);
  assert.equal(analysis.bindings.action.properties.Background.dynamic, true);
  assert.equal(background(analysis), undefined);
  const noOp = planDesignSourceUpdate(analysis, analysis.document, sources, {requireCompilation: true});
  assert.equal(noOp.text, text);
});

test('A18 inner gradient comments remain protected during composite edits and outer trivia remains intact', () => {
  const source = gradientSources()[0];
  const sources = [{...source, text: source.text.replace('Opacity = 0.75', 'Opacity = /* retain this */ 0.75')}];
  const analysis = analyze(sources);
  assert.deepEqual(background(analysis), gradientBrush());
  assert.throws(() => planDesignSourceUpdate(analysis, changeBrush(analysis, gradientBrush({Opacity: 0.5})), sources),
    error => error.code === 'SFSYNC_DYNAMIC');
  assert.match(sources[0].text, /retain this/);
});

test('A18 gradient plans retain stale, read-only, cancellation and immutable session boundaries', () => {
  const sources = gradientSources();
  const session = new CSharpDesignSession(sources[0].text, {...gradientOptions, sources});
  const before = session.document;
  const document = changeBrush(session.analysis, gradientBrush({Opacity: 0.2}));
  const plan = session.plan(document, sources, {requireCompilation: true});
  const stale = sources.map(file => ({...file, version: file.version + 1}));
  assert.throws(() => session.commit(plan, {currentSources: stale, requireCompilation: true}), {code: 'SFSYNC_CONFLICT'});
  assert.deepEqual(session.document, before);
  const readOnly = analyze(sources.map(file => ({...file, readOnly: true})));
  assert.throws(() => planDesignSourceUpdate(readOnly, document, readOnly.sources), {code: 'SFSYNC_OWNERSHIP'});
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => session.plan(document, sources, {signal: controller.signal}), {code: 'SFSYNC_CANCELLED'});
  assert.deepEqual(session.document, before);
  session.commit(plan, {currentSources: sources, requireCompilation: true});
  assert.deepEqual(background(session.analysis), document.nodes.find(node => node.id === 'action').properties.Background);
  verify(plan.sources, background(session.analysis));
  session.dispose();
});

test('A18 the legacy nested GradientStops form remains lossless when merely inspected', () => {
  const source = gradientSources()[0];
  const text = source.text.replace('GradientStops = new Microsoft.UI.Xaml.Media.GradientStopCollection()', 'GradientStops =');
  const analysis = analyzeDesignSources([{...source, text}], gradientOptions);
  assert.deepEqual(background(analysis), gradientBrush());
  const plan = planDesignSourceUpdate(analysis, analysis.document, analysis.sources);
  assert.equal(plan.text, text);
  assert.deepEqual(plan.changes, []);
  assert.match(csharpValue(background(analysis), MEDIA + 'Brush'), /new Microsoft\.UI\.Xaml\.Media\.GradientStopCollection/);
});
