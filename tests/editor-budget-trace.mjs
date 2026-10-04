import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

export const editorBudgetCounts = Object.freeze({
  definition: {first: 1, warmup: 2, measured: 15}, overview: {first: 1, warmup: 3, measured: 31}
});
export const editorBrowserBudgets = Object.freeze({definition: 300, overview: 16});
const cases = {definition: ['source-alpha', 'source-beta', 'framework-metadata'], overview: ['narrow', 'medium', 'wide']};
const widths = {narrow: 40, medium: 70, wide: 110};
const annotations = [
  ['error', 0, [239, 113, 132, 255]], ['warning', 1371, [232, 204, 117, 255]],
  ['breakpoint', 2731, [239, 113, 132, 255]], ['bookmark', 4095, [97, 182, 239, 255]],
  ['saved', 5461, [101, 174, 113, 255]], ['unsaved', 6827, [232, 204, 117, 255]],
  ['find', 8191, [223, 174, 72, 255]], ['caret', 9999, [222, 222, 222, 255]]
];
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const nonempty = value => typeof value === 'string' && value.length > 0;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const ensure = (condition, message) => { if (!condition) throw new TypeError(message); };

function sortedKeys(value) {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedKeys(value[key])]));
}

export function fixtureDigest(fixture) {
  const {sha256, ...contents} = fixture;
  return createHash('sha256').update(JSON.stringify(sortedKeys(contents))).digest('hex');
}

export function summarizeEditorSamples(samples) {
  const keys = [...new Set(samples.map(sample => sample.case + ':' + sample.phase))].sort();
  return keys.map(key => {
    const [name, phase] = key.split(':');
    const values = samples.filter(sample => sample.case === name && sample.phase === phase)
      .map(sample => sample.durationMs).sort((left, right) => left - right);
    return {case: name, phase, count: values.length, max: values.at(-1),
      p50: values[Math.ceil(values.length * .5) - 1], p95: values[Math.ceil(values.length * .95) - 1],
      p99: values[Math.ceil(values.length * .99) - 1]};
  });
}

function validateEnvironment(stage, name) {
  const value = stage.environment;
  ensure(value && ['chromium', 'firefox', 'webkit'].includes(value.engine) && nonempty(value.browserVersion) &&
    nonempty(value.operatingSystem) && nonempty(value.architecture) && value.headless === true &&
    value.clock === 'performance.now' && value.visibility === 'visible' && value.deviceScaleFactor === 1 &&
    value.viewport?.width === 1440 && value.viewport?.height === 1000 && integer(value.hardwareConcurrency) &&
    value.hardwareConcurrency > 0 && value.physicalFrameRateCertified === false && value.safariCertified === false &&
    value.servingMode === (name === 'definition' ? 'production-studio-http' : 'built-editor-fixture-http'),
  'Invalid actual-browser environment: ' + name);
  const directives = Object.fromEntries((stage.policy?.value ?? '').split(';').filter(value => value.trim()).map(value => {
    const [key, ...values] = value.trim().split(/\s+/u);
    return [key, values];
  }));
  ensure(stage.policy?.transport === 'header' && directives['script-src']?.includes("'self'") &&
    !directives['script-src'].includes("'unsafe-eval'") && !directives['script-src'].includes("'unsafe-inline'") &&
    directives['object-src']?.includes("'none'"), 'Missing production CSP: ' + name);
  const required = name === 'definition' ? ['workbench/tools/code-definition.js', 'workbench/tools/code-definition-provider.js',
    'workbench/metadata/catalog.js', 'compiler.worker.js', 'studio.css'] : ['packages/editor/src/view/overview-ruler.js',
    'packages/editor/src/view/virtual-view.js', 'packages/editor/src/view/virtual.css'];
  ensure(required.every(path => hash(stage.assets?.[path])), 'Missing verified served asset digests: ' + name);
}

function validateDefinition(sample, fixture) {
  const target = fixture.targets.find(target => target.id === sample.case);
  ensure(target && sample.focusPreserved === true && sample.readOnly === true && sample.visible === true &&
    Array.isArray(sample.focusEvents) && sample.focusEvents.length === 0 && integer(sample.sourceVersion) &&
    sample.sourceVersion > 0 && sample.offset === target.offset && finite(sample.observedDomMs) &&
    sample.observedDomMs <= sample.durationMs, 'Definition focus, version or DOM observation failed');
  if (target.kind === 'source') {
    ensure(sample.title === target.uri && sample.text === target.text && sample.selection === target.name,
      'Definition did not show the exact source target and selection');
  } else {
    ensure(sample.title.includes('SharpForge Framework ABI') && sample.title.includes('metadata version') &&
      sample.text.startsWith('// Read-only registered framework contracts') && sample.selection.includes('WriteLine('),
    'Actual framework metadata target/selection is absent');
  }
}

function validateOverview(sample) {
  const canvas = sample.canvas;
  ensure(canvas?.width === widths[sample.case] && canvas.cssWidth === canvas.width && integer(canvas.height) &&
    canvas.height > 0 && canvas.height < 4096 && finite(canvas.cssHeight) && canvas.cssHeight > 0 &&
    finite(sample.renderMs) && sample.renderMs <= sample.durationMs && finite(sample.followingRafMs) &&
    sample.followingRafMs > 0 && integer(sample.mapPixels) && sample.mapPixels > 0,
  'Invalid rendered map geometry, raster pixels or browser clocks');
  ensure(Array.isArray(sample.marks) && sample.marks.length === annotations.length, 'Missing annotation pixel observations');
  for (const [kind, line, rgba] of annotations) {
    const matches = sample.marks.filter(mark => mark.kind === kind);
    const mark = matches[0];
    ensure(matches.length === 1 && mark.correct === true && mark.line === line &&
      mark.expectedY === Math.round(line / 9999 * (canvas.height - 1)) && isDeepStrictEqual(mark.rgba, rgba),
    'Annotation is not at the expected logical-line pixel: ' + kind);
  }
}

function validateStage(stage, name, fixture) {
  ensure(stage?.status === 'captured' && !stage.error, 'Stage did not complete: ' + name);
  validateEnvironment(stage, name);
  ensure(Array.isArray(stage.samples), 'Missing raw samples: ' + name);
  const seen = new Set();
  for (const sample of stage.samples) {
    const count = editorBudgetCounts[name][sample.phase];
    const key = sample.case + ':' + sample.phase + ':' + sample.index;
    ensure(cases[name].includes(sample.case) && count && integer(sample.index) && sample.index < count &&
      finite(sample.durationMs) && sample.correct === true && !seen.has(key), 'Invalid, failed or duplicate raw sample: ' + key);
    seen.add(key);
    if (name === 'definition') validateDefinition(sample, fixture);
    else validateOverview(sample);
  }
  const expected = cases[name].length * Object.values(editorBudgetCounts[name]).reduce((sum, count) => sum + count, 0);
  ensure(seen.size === expected, 'Missing first, warmup or measured observations: ' + name);
  ensure(isDeepStrictEqual(stage.summary, summarizeEditorSamples(stage.samples)), 'Summary disagrees with raw observations: ' + name);
}

/** Synthetic unit fixtures exercise this validator; only an actual browser driver can produce qualifying evidence. */
export function validateEditorBudgetTrace(trace) {
  ensure(trace?.format === 'sharpforge-editor-ui-budgets' && trace.version === 1 && trace.units === 'milliseconds',
    'Expected version 1 editor UI millisecond capture');
  ensure(trace.captureStatus === 'completed' && Array.isArray(trace.browserErrors) && !trace.browserErrors.length &&
    Array.isArray(trace.cspViolations) && !trace.cspViolations.length, 'Incomplete or erroneous browser capture');
  ensure(/^[a-f0-9]{40}$/u.test(trace.source?.revision ?? '') &&
    ['sourceFiles', 'harnessFiles'].every(key => Object.keys(trace.source[key] ?? {}).length > 0 &&
      Object.values(trace.source[key]).every(hash)), 'Missing source or harness identity');
  const fixture = trace.fixture;
  ensure(fixture?.id === 'editor-ui-budgets-v1' && fixture.lineCount === 10000 &&
    isDeepStrictEqual(fixture.counts, editorBudgetCounts) && fixtureDigest(fixture) === fixture.sha256 &&
    Array.isArray(fixture.targets) && isDeepStrictEqual(fixture.targets.map(target => target.id), cases.definition),
  'Fixture, raw sample counts or fixture digest changed');
  ensure(isDeepStrictEqual(Object.keys(trace.stages ?? {}).sort(), Object.keys(cases).sort()), 'Missing or unknown capture stage');
  for (const name of Object.keys(cases)) validateStage(trace.stages?.[name], name, fixture);
  const definition = trace.stages.definition;
  ensure(definition.setup?.uri === fixture.callerUri && nonempty(definition.setup.projectId) &&
    definition.setup.workspaceRecords === 4 && definition.boundaries?.neutralClears === true &&
    definition.boundaries.rapidCaretUsesLatest === true, 'Missing actual workspace or definition boundary checks');
  const overview = trace.stages.overview;
  ensure(overview.setup?.lineCount === 10000 && overview.setup.largeFileActive === false &&
    isDeepStrictEqual(overview.setup.annotationKinds, annotations.map(([kind]) => kind)) &&
    Array.isArray(overview.pointers) && overview.pointers.length === 3 &&
    cases.overview.every(name => overview.pointers.filter(pointer => pointer.case === name && pointer.previewMatches === true &&
      pointer.navigationMatches === true && integer(pointer.expectedLine) && pointer.expectedLine === pointer.actualLine).length === 1),
  'Missing real overview setup, tooltip or pointer navigation');
  return trace;
}

/** Gate every observed first/warmup/measured sample; no relative-regression or physical refresh-rate verdict is inferred. */
export function assessEditorBudgetTrace(trace) {
  validateEditorBudgetTrace(trace);
  const failures = Object.entries(trace.stages).flatMap(([name, stage]) => stage.samples
    .filter(sample => sample.durationMs > editorBrowserBudgets[name])
    .map(sample => ({stage: name, case: sample.case, phase: sample.phase, index: sample.index,
      durationMs: sample.durationMs, budgetMs: editorBrowserBudgets[name]})));
  return {absolutePassed: failures.length === 0, failures, regressionVerdict: null,
    physicalFrameRateCertified: false, safariCertified: false};
}

if (process.argv[1]?.endsWith('editor-budget-trace.mjs')) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node tests/editor-budget-trace.mjs editor-ui-budgets.json');
    const assessment = assessEditorBudgetTrace(JSON.parse(await readFile(process.argv[2], 'utf8')));
    process.stdout.write(JSON.stringify(assessment, null, 2) + '\n');
    process.exitCode = assessment.absolutePassed ? 0 : 1;
  } catch (error) {
    process.stdout.write(JSON.stringify({absolutePassed: false, error: error.message, regressionVerdict: null}, null, 2) + '\n');
    process.exitCode = 1;
  }
}
