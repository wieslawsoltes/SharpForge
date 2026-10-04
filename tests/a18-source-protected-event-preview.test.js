import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeDesignSources, designProtectedEventPreviewCapability, planDesignSourceUpdate} from '@sharpforge/designer';
import {partialSources, studioHarness, sourceState, ownerUri, constructionUri} from './fixtures/a18-studio-harness.js';

const subscription = 'action.Click += (sender, args) => { action.Content = "Lambda"; };';
const files = () => partialSources({subscription}).filter(file => file.uri.startsWith('App/'));
const analyze = sources => analyzeDesignSources(sources, {uri: constructionUri, className: 'View', methodName: 'Create'});

test('only owned lowered-event profile errors grant a read-only preview without changing compiler results', () => {
  const source = files();
  const analysis = analyze(source);
  const diagnostics = structuredClone(analysis.compilerDiagnostics);
  const owned = analysis.bindings.action.events.Click.subscriptions[0];
  assert.equal(owned.expression.kind, 'ParenthesizedLambdaExpression');
  assert.equal(owned.protected, true);
  const capability = designProtectedEventPreviewCapability(analysis);
  assert.equal(analysis.compilationSucceeded, false);
  assert.equal(capability.previewAvailable, true, capability.reason);
  assert.equal(capability.kind, 'events');
  assert.equal(capability.readOnly, true);
  assert.equal(capability.sourceWrites, false);
  assert.equal(capability.subscriptions[0].nodeId, 'action');
  assert.equal(capability.subscriptions[0].event, 'Click');
  const span = capability.subscriptions[0];
  assert.equal(source.find(file => file.uri === span.uri).text.slice(span.start, span.end), subscription);
  assert.deepEqual(analysis.compilerDiagnostics, diagnostics);
  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'SF2200' && diagnostic.severity === 'error'));
  assert.throws(() => planDesignSourceUpdate(analysis, analysis.document, source, {requireCompilation: true}), {code: 'SFSYNC_COMPILE'});
});

test('other profile errors, ordinary C# errors, and unowned diagnostic spans never qualify for event preview', () => {
  const analysis = analyze(files());
  const errors = analysis.compilerDiagnostics.filter(diagnostic => diagnostic.severity === 'error');
  const replace = compilerDiagnostics => ({...analysis, context: analysis.context, compilerDiagnostics});
  for (const changes of [{message: 'Some other runtime profile error'}, {code: 'CS0103'},
    {uri: ownerUri}, {start: 0, length: 1}, {length: 0}]) {
    const candidate = replace(errors.map(diagnostic => ({...diagnostic, ...changes})));
    assert.equal(designProtectedEventPreviewCapability(candidate).previewAvailable, false);
  }
  assert.equal(designProtectedEventPreviewCapability(replace([...errors,
    {code: 'CS0103', severity: 'error', message: 'Unknown symbol', uri: constructionUri, start: 0, length: 1}])).previewAvailable, false);
  assert.equal(designProtectedEventPreviewCapability(replace([])).previewAvailable, false);
  const invalidSources = files().map(file => ({...file, text: file.text.replace('action.Width = 240', 'missingTarget.Width = 240')}));
  const invalid = analyze(invalidSources);
  assert.ok(invalid.compilerDiagnostics.some(diagnostic => diagnostic.severity === 'error' && diagnostic.code !== 'SF2200'));
  assert.equal(designProtectedEventPreviewCapability(invalid).previewAvailable, false);
  assert.throws(() => planDesignSourceUpdate(invalid, invalid.document, invalidSources, {requireCompilation: true}),
    {code: 'SFSYNC_COMPILE'});
});

test('dynamic properties and handwritten construction work retain the last valid preview instead of receiving the event exception', () => {
  const dynamic = files().map(file => ({...file, text: file.uri === ownerUri
    ? file.text.replace('static Window window;', 'static double GetWidth() { return 160; }\n    static Window window;')
    : file.text.replace('Width = 160', 'Width = GetWidth()')}));
  const dynamicAnalysis = analyze(dynamic);
  assert.ok(dynamicAnalysis.warnings.some(warning => warning.code === 'SFSYNC_DYNAMIC'));
  assert.equal(designProtectedEventPreviewCapability(dynamicAnalysis).previewAvailable, false);
  const custom = files().map(file => ({...file, text: file.text.replace('return window;',
    'System.Console.WriteLine("Construction side effect"); return window;')}));
  const customAnalysis = analyze(custom);
  assert.ok(customAnalysis.unmanaged.length > 0);
  assert.equal(designProtectedEventPreviewCapability(customAnalysis).previewAvailable, false);
});

test('Studio navigates a protected lambda through the worker with errors retained, then unlocks after a supported source repair', async context => {
  const harness = await studioHarness(context, {subscription});
  const connected = await harness.connect();
  assert.equal(connected.state, 'blocked');
  assert.equal(connected.canApply, false);
  assert.equal(harness.document.readOnly, true);
  assert.match(connected.message, /framework events with lowered delegates/);
  assert.throws(() => harness.document.setProperty('Width', 180, ['action']), {code: 'SFD1865'});
  const before = sourceState(harness);
  const navigation = await harness.sync.navigateEvent('action', 'Click');
  assert.equal(navigation.ok, true);
  assert.equal(navigation.navigationAvailable, true);
  assert.equal(navigation.existing, true);
  assert.equal(navigation.success, false);
  assert.equal(navigation.compilationSucceeded, false);
  assert.deepEqual(navigation.changes, []);
  assert.deepEqual(sourceState(harness), before);
  assert.equal(harness.sync.protocol.state, 'blocked');
  assert.ok(harness.sync.diagnostics.some(diagnostic => diagnostic.code === 'SF2200' && diagnostic.severity === 'error'));
  assert.ok(harness.compiler.requests.some(request => request.operation === 'event'));
  assert.throws(() => harness.sync.createEventHandler({nodeId: 'action', event: 'Click'}), {code: 'SFSYNC_COMPILE'});
  harness.type(constructionUri, harness.file(constructionUri).text.replace(subscription, 'action.Click += OnClick;'));
  await harness.sync.read();
  assert.equal(harness.sync.session.analysis.compilationSucceeded, true);
  assert.equal(harness.document.readOnly, false);
  assert.equal(harness.sync.protocol.state, 'synced');
});
