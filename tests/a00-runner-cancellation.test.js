import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runProcess} from '../scripts/planning/run-tests.js';

const runnerUrl = new URL('../scripts/planning/run-tests.js', import.meta.url).href;

// Signals belong to this isolated driver, never to the test runner or another validation process.
function runDriver(t, {signals = [], timeout, code, missing = false}) {
  const cwd = mkdtempSync(join(tmpdir(), 'sharpforge-runner-cancellation-'));
  t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const child = code === undefined ? `
    const {writeFileSync} = require('node:fs');
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      setTimeout(() => {writeFileSync('cleaned', signal); process.exit(0);}, 100);
    });
    writeFileSync('ready', '');
    setTimeout(() => process.exit(99), 6000);
  ` : `process.exit(${code});`;
  const source = `
    import {existsSync, readFileSync} from 'node:fs';
    import {runProcess} from ${JSON.stringify(runnerUrl)};
    const signals = ${JSON.stringify(signals)};
    const names = ['SIGINT', 'SIGTERM'];
    const before = names.map(name => process.listenerCount(name));
    let poll, status, error;
    try {
      const running = runProcess(${missing ? JSON.stringify(join(cwd, 'missing-executable')) : 'process.execPath'},
        ['-e', ${JSON.stringify(child)}], {cwd: process.cwd(), timeout: ${JSON.stringify(timeout)}});
      if (signals.length) poll = setInterval(() => {
        if (!existsSync('ready')) return;
        clearInterval(poll);
        for (const signal of signals) process.emit(signal);
      }, 10);
      status = await running;
    } catch (caught) {error = caught.code;}
    finally {clearInterval(poll);}
    console.log(JSON.stringify({status, error,
      listeners: names.map((name, index) => process.listenerCount(name) - before[index]),
      cleaned: existsSync('cleaned') ? readFileSync('cleaned', 'utf8') : null}));
    process.exitCode = status ?? 1;
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd, encoding: 'utf8', timeout: 5000, env: {...process.env, NODE_TEST_CONTEXT: undefined},
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, report.status ?? 1, result.stderr);
  assert.deepEqual(report.listeners, [0, 0]);
  return {status: result.status, ...report};
}

for (const [signal, status] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`A00 runner preserves ${signal} failure after graceful zero exit`, t => {
    const result = runDriver(t, {signals: [signal]});
    assert.equal(result.status, status);
    if (process.platform !== 'win32') assert.equal(result.cleaned, signal);
  });
}

test('A00 runner timeout remains a failure after graceful zero exit', t => {
  const result = runDriver(t, {timeout: 1500});
  assert.equal(result.status, 124);
  if (process.platform !== 'win32') assert.equal(result.cleaned, 'SIGTERM');
});

test('A00 runner preserves the first cancellation when later signals arrive', t => {
  assert.equal(runDriver(t, {signals: ['SIGINT', 'SIGTERM']}).status, 130);
  assert.equal(runDriver(t, {signals: ['SIGTERM', 'SIGINT']}).status, 143);
});

test('A00 runner preserves normal exits and clears its pending deadline', t => {
  // A leaked ten-second timer would keep the driver alive beyond its five-second test deadline.
  assert.equal(runDriver(t, {code: 0, timeout: 10000}).status, 0);
  assert.equal(runDriver(t, {code: 7, timeout: 10000}).status, 7);
  for (const timeout of [undefined, null, 0]) assert.equal(runDriver(t, {code: 0, timeout}).status, 0);
});

test('A00 runner spawn errors clear listeners and pending deadlines', t => {
  const result = runDriver(t, {missing: true, timeout: 10000});
  assert.equal(result.error, 'ENOENT');
});

test('A00 runner rejects invalid timeouts before starting a child', async () => {
  for (const timeout of [-1, 0.5, NaN, Infinity, '1', false]) {
    await assert.rejects(runProcess(process.execPath, ['-e', 'process.exit(0)'], {timeout}),
      {name: 'RangeError', code: 'ERR_OUT_OF_RANGE'});
  }
});

function manifestFixture(t, shortDelay = 0) {
  const cwd = mkdtempSync(join(tmpdir(), 'sharpforge-runner-areas-'));
  t.after(() => rmSync(cwd, {recursive: true, force: true}));
  for (const directory of ['planning/contracts', 'tests/manifests']) mkdirSync(join(cwd, directory), {recursive: true});
  const writeJson = (path, value) => writeFileSync(join(cwd, path), JSON.stringify(value));
  writeJson('package.json', {type: 'module'});
  writeJson('planning/catalog.json', {areas: [{id: 'A00'}, {id: 'A20'}]});
  writeFileSync(join(cwd, 'planning/contracts/test-manifest.schema.json'),
    readFileSync(new URL('../planning/contracts/test-manifest.schema.json', import.meta.url)));
  for (const [area, timeout, delay] of [['A00', 500, shortDelay], ['A20', 2500, 600]]) {
    writeJson(`tests/manifests/${area}.json`, {schemaVersion: 1, area, nodeGlobs: [`tests/${area}.test.js`],
      browserScripts: [], requiredServices: [], timeout, tags: []});
    writeFileSync(join(cwd, `tests/${area}.test.js`), `
      import test from 'node:test';
      import {writeFileSync} from 'node:fs';
      test('${area} fixture', async () => {
        writeFileSync('${area}-started', '');
        await new Promise(resolve => setTimeout(resolve, ${delay}));
      });
    `);
  }
  return {cwd, run: (...args) => spawnSync(process.execPath,
    [fileURLToPath(runnerUrl), '--root', cwd, ...args],
    // The outer test runner already owns the local run slot; these fixture commands execute serially within it.
    {cwd, encoding: 'utf8', timeout: 10000,
      env: {...process.env, NODE_TEST_CONTEXT: undefined, CI: '1', SHARPFORGE_MAX_PARALLEL_RUNS: undefined}})};
}

test('A00 runner keeps a short area deadline when a slower area is also selected', t => {
  const {cwd, run} = manifestFixture(t, 1000);
  const result = run('--', '--test-reporter=tap');
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /testTimeoutFailure|timed out/);
  assert.equal(existsSync(join(cwd, 'A00-started')), true);
  assert.equal(existsSync(join(cwd, 'A20-started')), false, 'stop before the next area after failure');
});

test('A00 runner preserves each successful area timeout and serial reporter output', t => {
  const {cwd, run} = manifestFixture(t);
  const result = run('--', '--test-reporter=tap');
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Discovered 2 Node test files/);
  assert.match(result.stderr, /Running Node tests for A00\.[\s\S]*Running Node tests for A20\./);
  assert.match(result.stdout, /A00 fixture[\s\S]*A20 fixture/);
  assert.equal(existsSync(join(cwd, 'A20-started')), true);
});

test('A00 runner keeps separate reporter files for multiple areas', t => {
  const {cwd, run} = manifestFixture(t);
  const result = run('--', '--test-reporter=tap', '--test-reporter-destination=report-{area}.tap');
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const area of ['A00', 'A20']) {
    const report = readFileSync(join(cwd, `report-${area}.tap`), 'utf8');
    assert.match(report, new RegExp(`${area} fixture`));
    assert.match(report, /# pass 1/);
  }
});

test('A00 runner rejects shared reporter files before running or truncating them', t => {
  const {cwd, run} = manifestFixture(t);
  writeFileSync(join(cwd, 'report.tap'), 'previous report');
  const result = run('--', '--test-reporter=tap', '--test-reporter-destination', 'report.tap');
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must include \{area\}/);
  assert.equal(readFileSync(join(cwd, 'report.tap'), 'utf8'), 'previous report');
  assert.equal(existsSync(join(cwd, 'A00-started')), false);
});

test('A00 runner preserves ordinary reporter destinations for a single selected area', t => {
  const {cwd, run} = manifestFixture(t, 1000);
  const result = run('--area', 'A20', '--', '--test-reporter=tap', '--test-reporter-destination', 'report.tap');
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(readFileSync(join(cwd, 'report.tap'), 'utf8'), /A20 fixture/);
  assert.equal(existsSync(join(cwd, 'A00-started')), false);
});

test('A00 runner rejects area placeholders that normalize to a shared reporter file', t => {
  const {cwd, run} = manifestFixture(t);
  for (const area of ['A00', 'A20']) mkdirSync(join(cwd, area));
  writeFileSync(join(cwd, 'report.tap'), 'previous report');
  const result = run('--', '--test-reporter=tap', '--test-reporter-destination={area}/../report.tap');
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Reporter destination is shared by A00 and A20/);
  assert.equal(readFileSync(join(cwd, 'report.tap'), 'utf8'), 'previous report');
  assert.equal(existsSync(join(cwd, 'A00-started')), false);
});

test('A00 runner rejects missing reporter destinations before starting suites', t => {
  const {cwd, run} = manifestFixture(t);
  for (const option of ['--test-reporter-destination', '--test-reporter-destination=']) {
    const result = run('--', '--test-reporter=tap', option);
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing value for --test-reporter-destination/);
    assert.equal(existsSync(join(cwd, 'A00-started')), false);
  }
});
