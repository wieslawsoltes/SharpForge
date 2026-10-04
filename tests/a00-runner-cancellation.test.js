import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
