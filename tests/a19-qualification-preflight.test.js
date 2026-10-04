import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from '../scripts/project16-qualification.js';
import { loadPerformanceBaselines } from '../scripts/project16-baselines.js';
import { distribution } from '../scripts/editor-benchmarks/common.js';

const host = { node: 'v24.0.0', platform: 'linux', arch: 'x64', cpu: 'fixture-runner' };

function editorReport() {
  return {
    schemaVersion: 1, kind: 'sharpforge-editor-latency', correctness: { passed: true },
    environment: { ...host, browser: 'chromium', browserVersion: 'fixture-1' },
    rows: [{ backend: 'browser-chromium', sizeBytes: 209_715_200, operation: 'browser.keystrokeToPaint',
      rawSamplesMs: [10, 10, 10], ...distribution([10, 10, 10]), correctness: { passed: true }, measurement: 'fixture' }]
  };
}

function workbenchReport() {
  const names = ['cold-app-startup', 'workspace-startup', 'document-switch', 'tool-activation'];
  return {
    format: 'sharpforge-workbench-trace', version: 2, units: 'milliseconds', captureStatus: 'completed', browserErrors: [],
    environment: { engine: 'chromium', browserVersion: 'fixture-1', operatingSystem: 'Linux fixture', architecture: 'x86_64',
      servingMode: 'http-static', timingProtocol: 'fresh-context-paint-v2', viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1, hardwareConcurrency: 4 },
    fixture: { id: 'workbench-501-csharp-v2', sha256: 'a'.repeat(64), sourceFiles: 501, projectFiles: 1,
      rounds: 3, documentSwitches: 1, tools: ['output'], toolPasses: 1 },
    summary: names.map(name => ({ name, sessionId: 'workbench', count: 3, p50: 100, p95: 100, p99: 100 })),
    samples: names.flatMap(name => [0, 1, 2].map(round => ({ name, sessionId: 'workbench', round, duration: 100 })))
  };
}

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), 'sharpforge-qualification-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const captures = [];
  const reads = [];
  const writes = [];
  const env = { SHARPFORGE_EDITOR_BASELINE: '', SHARPFORGE_WORKBENCH_BASELINE: '' };
  await writeFile(join(root, 'editor-browser.json'), JSON.stringify(editorReport()));
  return {
    root, captures, reads, writes, env,
    async baseline(kind, report) {
      const name = kind + '-baseline.json';
      await writeFile(join(root, name), typeof report === 'string' ? report : JSON.stringify(report));
      env['SHARPFORGE_' + kind.toUpperCase() + '_BASELINE'] = name;
      return join(root, name);
    },
    options: {
      host, env, selectedEngine: 'chromium', checkoutRoot: root, outputDirectory: root,
      runCapture: async (...args) => { captures.push(args); },
      read: async (...args) => { reads.push(args[0]); return readFile(...args); },
      write: async (...args) => { writes.push(args); }
    }
  };
}

test('malformed editor JSON fails before any capture starts', async context => {
  const scope = await fixture(context);
  await scope.baseline('editor', '{');
  await assert.rejects(performance(scope.options), SyntaxError);
  assert.equal(scope.captures.length, 0);
});

test('both baseline schemas are checked before any capture starts', async context => {
  const scope = await fixture(context);
  const editor = editorReport();
  editor.rows[0].p95Ms = 1;
  await scope.baseline('editor', editor);
  await assert.rejects(performance(scope.options), /Percentile differs/);
  await scope.baseline('editor', editorReport());
  const workbench = workbenchReport();
  workbench.samples.pop();
  await scope.baseline('workbench', workbench);
  await assert.rejects(performance(scope.options), /Missing or duplicate metric samples/);
  assert.equal(scope.captures.length, 0);
});

test('known editor browser, OS, architecture, Node and CPU mismatches fail before capture', async context => {
  const scope = await fixture(context);
  for (const [key, value] of [['browser', 'firefox'], ['platform', 'win32'], ['arch', 'arm64'],
    ['node', 'v25.0.0'], ['cpu', 'another-runner']]) {
    const report = editorReport();
    report.environment[key] = value;
    await scope.baseline('editor', report);
    await assert.rejects(performance(scope.options), /Performance baseline environment mismatch/, key);
  }
  assert.equal(scope.captures.length, 0);
});

test('model-only or another browser backend cannot be used as the editor baseline', async context => {
  const scope = await fixture(context);
  for (const backend of ['node-model', 'browser-firefox']) {
    const report = editorReport();
    report.rows[0].backend = backend;
    await scope.baseline('editor', report);
    await assert.rejects(performance(scope.options), /only measurements from browser-chromium/);
  }
  assert.equal(scope.captures.length, 0);
});

test('known workbench runner mismatches fail before editor captures', async context => {
  const scope = await fixture(context);
  for (const [key, value] of [['engine', 'firefox'], ['operatingSystem', 'Windows 10'], ['architecture', 'arm64'],
    ['node', 'v25.0.0'], ['cpu', 'another-runner']]) {
    const report = workbenchReport();
    report.environment[key] = value;
    await scope.baseline('workbench', report);
    await assert.rejects(performance(scope.options), /Performance baseline environment mismatch/, key);
  }
  assert.equal(scope.captures.length, 0);
});

test('Python OS and architecture aliases match corresponding known Node runner facts', async context => {
  const scope = await fixture(context);
  for (const [operatingSystem, architecture, platform, arch] of [
    ['Windows 10', 'AMD64', 'win32', 'x64'], ['Darwin 25', 'aarch64', 'darwin', 'arm64']
  ]) {
    const report = workbenchReport();
    Object.assign(report.environment, { operatingSystem, architecture });
    await scope.baseline('workbench', report);
    const loaded = await loadPerformanceBaselines({ root: scope.root, engine: 'chromium', host: { ...host, platform, arch },
      workbenchPath: scope.env.SHARPFORGE_WORKBENCH_BASELINE });
    assert.deepEqual(loaded.workbench.report, report);
  }
});

test('missing and outside-checkout baseline files fail before capture', async context => {
  const scope = await fixture(context);
  scope.env.SHARPFORGE_EDITOR_BASELINE = 'missing.json';
  await assert.rejects(performance(scope.options), { code: 'ENOENT' });
  scope.env.SHARPFORGE_EDITOR_BASELINE = '../outside.json';
  await assert.rejects(performance(scope.options), /inside the checkout/);
  assert.equal(scope.captures.length, 0);
  assert.deepEqual(scope.reads, []);
});

test('empty inputs retain capture mode and the 22-minute outer browser deadline', async context => {
  const scope = await fixture(context);
  const assessment = await performance(scope.options);
  assert.equal(assessment.mode, 'capture');
  assert.equal(assessment.regressionVerdict, null);
  assert.deepEqual(scope.reads, [join(scope.root, 'editor-browser.json')]);
  assert.equal(scope.captures.length, 4);
  assert.equal(scope.captures.at(-1)[2], 1_320_000);
  assert.equal(scope.env.SHARPFORGE_WORKBENCH_BASELINE, '');
});

test('compatible baselines are read once before capture and reused for comparison', async context => {
  const scope = await fixture(context);
  const editorPath = await scope.baseline('editor', editorReport());
  const workbenchPath = await scope.baseline('workbench', workbenchReport());
  const runCapture = scope.options.runCapture;
  scope.options.runCapture = async (...args) => {
    assert(scope.reads.includes(editorPath));
    assert(scope.reads.includes(workbenchPath));
    await runCapture(...args);
  };
  const assessment = await performance(scope.options);
  assert.equal(assessment.mode, 'compare');
  assert.equal(assessment.regressionVerdict, true);
  assert.equal(scope.reads.filter(path => path === editorPath).length, 1);
  assert.equal(scope.env.SHARPFORGE_WORKBENCH_BASELINE, workbenchPath);
  assert.equal(scope.captures.length, 4);
  assert.equal(scope.writes[0][1], assessment);
});
