import test from 'node:test';
import assert from 'node:assert/strict';
import { checkQuarantine, detect } from '../../../scripts/conformance/flaky/detect.js';
const quarantine = { schemaVersion: 1, entries: [] };
const files = ['tests/fixture.test.js'];
const child = status => ({ status, stdout: 'TAP version 13\n1..1\n# tests 1\n# pass ' + (status ? 0 : 1) +
  '\n# fail ' + (status ? 1 : 0) + '\n# cancelled 0\n# skipped 0\n# todo 0\n', stderr: '' });
test('failure then pass is flaky with raw attempts and never silent green', () => {
  let attempt = 0;
  const report = detect({ files, quarantine, execute: () => child(attempt++ === 0 ? 1 : 0) });
  assert.equal(report.passed, false);
  assert.equal(report.results[0].status, 'flaky');
  assert.equal(report.results[0].failureRate, 0.5);
  assert.equal(report.results[0].attempts.length, 2);
});
test('passing files are not retried, persistent failures retain bounded attempts', () => {
  assert.equal(detect({ files, quarantine, execute: () => child(0) }).results[0].attempts.length, 1);
  const report = detect({ files, quarantine, retries: 2, execute: () => child(1) });
  assert.equal(report.results[0].status, 'failed');
  assert.equal(report.results[0].attempts.length, 3);
});
test('expired quarantine and invalid inputs fail before commands; active quarantine does not hide failures', () => {
  const entry = { file: files[0], reason: 'Tracked fixture', issue: 'https://github.com/test/repo/issues/1', expires: '2026-10-04T00:00:00Z' };
  assert.throws(() => checkQuarantine({ schemaVersion: 1, entries: [entry] }, new Date('2026-10-05')), /Expired/);
  const report = detect({ files, quarantine: { schemaVersion: 1, entries: [entry] }, now: new Date('2026-10-03'), execute: () => child(1) });
  assert.equal(report.passed, false);
  assert.equal(report.results[0].quarantine.reason, entry.reason);
  assert.throws(() => detect({ files: ['../outside.test.js'], quarantine }), /Unsafe/);
  assert.throws(() => detect({ files, quarantine, retries: 6 }), /retries/);
});
test('cancellation and timeout cannot produce passing evidence', () => {
  const controller = new AbortController(); controller.abort();
  assert.equal(detect({ files, quarantine, signal: controller.signal, execute: () => { throw Error('must not run'); } }).cancelled, true);
  const timed = detect({ files, quarantine, retries: 0, execute: () => ({ status: null, error: Error('ETIMEDOUT'), signal: 'SIGTERM' }) });
  assert.equal(timed.passed, false);
  assert.match(timed.results[0].attempts[0].error, /ETIMEDOUT/);
});

test('empty successful subprocess output is not passing test evidence', () => {
  const report = detect({ files, quarantine, retries: 0, execute: () => ({ status: 0, stdout: '' }) });
  assert.equal(report.passed, false);
  assert.match(report.results[0].attempts[0].error, /complete passing test evidence/);
});

test('real Node subprocess failure then pass retains both exact TAP attempts', async t => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'sf-flake-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'tests/fixture.test.mjs'), `
    import test from 'node:test';
    import {existsSync, writeFileSync} from 'node:fs';
    test('deliberate retry fixture', () => {
      if (!existsSync('attempt')) { writeFileSync('attempt', '1'); throw Error('first attempt'); }
    });
  `);
  const report = detect({ root, files: ['tests/fixture.test.mjs'], quarantine });
  assert.equal(report.results[0].status, 'flaky', JSON.stringify(report));
  assert.equal(report.results[0].attempts.length, 2);
  assert.equal(report.results[0].attempts[1].summary.passed, 1);
  assert.equal(report.passed, false);
});
