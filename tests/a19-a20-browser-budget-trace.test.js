import test from 'node:test';
import assert from 'node:assert/strict';
import {editorBudgetCounts, fixtureDigest, summarizeEditorSamples,
  validateEditorBudgetTrace, assessEditorBudgetTrace} from './editor-budget-trace.mjs';

// Format fixtures are synthetic. Passing these Node tests is never evidence that the browser met a budget.
const digest = 'a'.repeat(64);
const colors = [
  ['error', 0, [239, 113, 132, 255]], ['warning', 1371, [232, 204, 117, 255]],
  ['breakpoint', 2731, [239, 113, 132, 255]], ['bookmark', 4095, [97, 182, 239, 255]],
  ['saved', 5461, [101, 174, 113, 255]], ['unsaved', 6827, [232, 204, 117, 255]],
  ['find', 8191, [223, 174, 72, 255]], ['caret', 9999, [222, 222, 222, 255]]
];

function fixture() {
  const result = {id: 'editor-ui-budgets-v1', callerUri: 'Calls.cs', lineCount: 10000, counts: editorBudgetCounts,
    targets: [{id: 'source-alpha', kind: 'source', uri: 'Alpha.cs', text: 'void RunAlpha() {}', name: 'RunAlpha', offset: 10},
      {id: 'source-beta', kind: 'source', uri: 'Beta.cs', text: 'void RunBeta() {}', name: 'RunBeta', offset: 20},
      {id: 'framework-metadata', kind: 'metadata', offset: 30}]};
  return {...result, sha256: fixtureDigest(result)};
}

function sample(name, target, phase, index) {
  const value = {case: target.id, phase, index, durationMs: name === 'definition' ? 140 + index : 2 + index / 100, correct: true};
  if (name === 'definition') return {...value, observedDomMs: 130, focusPreserved: true, focusEvents: [], sourceVersion: 1,
    offset: target.offset, readOnly: true, visible: true, title: target.uri ?? 'SharpForge Framework ABI · metadata version 1',
    text: target.text ?? '// Read-only registered framework contracts\nvoid WriteLine();', selection: target.name ?? 'void WriteLine();'};
  const width = {narrow: 40, medium: 70, wide: 110}[target.id];
  return {...value, renderMs: 1, followingRafMs: 16.7, mapPixels: 100, canvas: {width, cssWidth: width, height: 600, cssHeight: 600},
    marks: colors.map(([kind, line, rgba]) => ({kind, line, rgba, expectedY: Math.round(line / 9999 * 599), correct: true}))};
}

function stage(name, value) {
  const targets = name === 'definition' ? value.targets : ['narrow', 'medium', 'wide'].map(id => ({id}));
  const samples = targets.flatMap(target => Object.entries(editorBudgetCounts[name]).flatMap(([phase, count]) =>
    Array.from({length: count}, (_, index) => sample(name, target, phase, index))));
  const assets = name === 'definition' ? ['workbench/tools/code-definition.js', 'workbench/tools/code-definition-provider.js',
    'workbench/metadata/catalog.js', 'compiler.worker.js', 'studio.css'] : ['packages/editor/src/view/overview-ruler.js',
    'packages/editor/src/view/virtual-view.js', 'packages/editor/src/view/virtual.css'];
  return {status: 'captured', samples, summary: summarizeEditorSamples(samples), assets: Object.fromEntries(assets.map(path => [path, digest])),
    policy: {transport: 'header', value: "script-src 'self'; object-src 'none'"},
    environment: {engine: 'chromium', browserVersion: 'synthetic-format-test', operatingSystem: 'Test', architecture: 'Test',
      headless: true, clock: 'performance.now', visibility: 'visible', deviceScaleFactor: 1,
      viewport: {width: 1440, height: 1000}, hardwareConcurrency: 4, physicalFrameRateCertified: false, safariCertified: false,
      servingMode: name === 'definition' ? 'production-studio-http' : 'built-editor-fixture-http'}};
}

function trace() {
  const value = fixture();
  const definition = stage('definition', value);
  const overview = stage('overview', value);
  definition.setup = {uri: 'Calls.cs', projectId: 'Budget.csproj', workspaceRecords: 4};
  definition.boundaries = {neutralClears: true, rapidCaretUsesLatest: true};
  overview.setup = {lineCount: 10000, largeFileActive: false, annotationKinds: colors.map(([kind]) => kind)};
  overview.pointers = ['narrow', 'medium', 'wide'].map(name => ({case: name, previewMatches: true, navigationMatches: true,
    expectedLine: 4210, actualLine: 4210}));
  return {format: 'sharpforge-editor-ui-budgets', version: 1, units: 'milliseconds', captureStatus: 'completed',
    source: {revision: 'b'.repeat(40), sourceFiles: {fixture: digest}, harnessFiles: {fixture: digest}}, fixture: value,
    browserErrors: [], cspViolations: [], stages: {definition, overview}};
}

test('complete format fixture recomputes raw percentiles without claiming a relative or physical-frame pass', () => {
  const assessment = assessEditorBudgetTrace(trace());
  assert.equal(assessment.absolutePassed, true);
  assert.equal(assessment.regressionVerdict, null);
  assert.equal(assessment.physicalFrameRateCertified, false);
  assert.equal(assessment.safariCertified, false);
});

test('first-visit and warmup budget violations remain failures even when all measured percentiles pass', () => {
  const value = trace();
  value.stages.definition.samples[0].durationMs = 301;
  value.stages.overview.samples.find(sample => sample.phase === 'warmup').durationMs = 16.01;
  for (const stage of Object.values(value.stages)) stage.summary = summarizeEditorSamples(stage.samples);
  const assessment = assessEditorBudgetTrace(value);
  assert.equal(assessment.absolutePassed, false);
  assert.deepEqual(assessment.failures.map(failure => failure.budgetMs), [300, 16]);
});

for (const [name, mutate, message] of [
  ['empty partial capture', value => { value.captureStatus = 'failed'; value.stages.definition.samples = []; }, /Incomplete/u],
  ['missing first observation', value => { value.stages.overview.samples.shift(); }, /Missing first/u],
  ['duplicate sample', value => { value.stages.definition.samples[1] = value.stages.definition.samples[0]; }, /duplicate/u],
  ['tampered percentile', value => { value.stages.definition.summary[0].p95 = 0; }, /Summary/u],
  ['focus stolen and restored', value => { value.stages.definition.samples[0].focusEvents.push({tag: 'TEXTAREA'}); }, /focus/u],
  ['stale source target', value => { value.stages.definition.samples[0].text = 'wrong source'; }, /exact source/u],
  ['model-only clock', value => { value.stages.overview.environment.clock = 'Node performance.now'; }, /actual-browser/u],
  ['hidden tab', value => { value.stages.definition.environment.visibility = 'hidden'; }, /actual-browser/u],
  ['missing compiler artifact', value => { delete value.stages.definition.assets['compiler.worker.js']; }, /asset digests/u],
  ['CSP violation', value => { value.cspViolations.push({directive: 'script-src'}); }, /erroneous/u],
  ['changed annotation line', value => { value.stages.overview.samples[0].marks[0].line = 1; }, /logical-line/u],
  ['empty map pixels', value => { value.stages.overview.samples[0].mapPixels = 0; }, /raster pixels/u],
  ['wrong annotation color', value => { value.stages.overview.samples[0].marks[0].rgba = [0, 0, 0, 255]; }, /logical-line/u],
  ['wrong pointer destination', value => { value.stages.overview.pointers[0].actualLine++; }, /pointer navigation/u]
]) test('rejects ' + name + ' instead of qualifying incomplete or incorrect evidence', () => {
  const value = trace();
  mutate(value);
  assert.throws(() => validateEditorBudgetTrace(value), message);
});
