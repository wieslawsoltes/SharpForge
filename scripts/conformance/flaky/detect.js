import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { safePath } from '../../planning/lib/paths.js';
import { tapSummary } from '../../planning/lib/evidence.js';
import { isMain, git } from '../../planning/lib/io.js';

export function checkQuarantine(document, now = new Date()) {
  if (document?.schemaVersion !== 1 || !Array.isArray(document.entries)) throw new Error('Invalid quarantine document');
  const seen = new Set();
  for (const entry of document.entries) {
    safePath(entry.file);
    if (seen.has(entry.file)) throw new Error(`Duplicate quarantine ${entry.file}`);
    seen.add(entry.file);
    if (!entry.reason?.trim() || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(entry.issue ?? '')) {
      throw new Error(`Quarantine needs a reason and owning issue: ${entry.file}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(entry.expires ?? '') ||
        !Number.isFinite(Date.parse(entry.expires)) || Date.parse(entry.expires) <= now.getTime()) {
      throw new Error(`Expired or invalid quarantine: ${entry.file}`);
    }
  }
  return document.entries;
}

/** Retry only failed files. A later pass is explicitly flaky and never silently green, including quarantined files. */
export function detect({ files, quarantine, root = process.cwd(), retries = 2, timeout = 120000, now = new Date(),
  execute = spawnSync, signal } = {}) {
  if (!Number.isInteger(retries) || retries < 0 || retries > 5) throw new Error('retries must be 0..5');
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 3600000) throw new Error('timeout must be 1..3600000 milliseconds');
  const entries = checkQuarantine(quarantine, now);
  if (!Array.isArray(files) || !files.length || files.length > 1000 || new Set(files).size !== files.length) {
    throw new Error('Provide 1..1000 distinct test files');
  }
  for (const file of files) {
    safePath(file);
    if (!/^tests\/.*\.test\.(?:js|mjs)$/.test(file)) throw new Error(`Not a supported Node test file: ${file}`);
  }
  const childEnvironment = { ...process.env };
  delete childEnvironment.NODE_TEST_CONTEXT;
  const results = [];
  let cancelled = false;
  for (const file of files) {
    const attempts = [];
    for (let retry = 0; retry <= retries; retry++) {
      if (signal?.aborted) { cancelled = true; break; }
      const started = Date.now();
      let child;
      try {
        child = execute(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', file], {
          cwd: root, env: childEnvironment, encoding: 'utf8', timeout, signal, maxBuffer: 16 * 1024 * 1024,
        });
      } catch (error) { child = { status: null, error }; }
      const summary = tapSummary(child.stdout ?? '', child.status);
      const passed = child.status === 0 && summary.complete && summary.passed > 0 && !summary.failed && !summary.cancelled;
      attempts.push({ exitCode: child.status, signal: child.signal ?? null, milliseconds: Date.now() - started,
        error: child.error?.message ?? (child.status === 0 && !passed ? 'No complete passing test evidence' : null),
        stdout: child.stdout ?? '', stderr: child.stderr ?? '', summary, passed });
      if (signal?.aborted || child.signal === 'SIGINT') { cancelled = true; break; }
      if (passed) break;
    }
    const failures = attempts.filter(attempt => !attempt.passed).length;
    const status = cancelled ? 'cancelled' : failures ? attempts.some(attempt => attempt.passed) ? 'flaky' : 'failed' : 'passed';
    results.push({ file, status, quarantine: entries.find(entry => entry.file === file) ?? null, attempts,
      failureRate: attempts.length ? failures / attempts.length : null });
    if (cancelled) break;
  }
  return { schemaVersion: 1, capturedAt: now.toISOString(), results, cancelled, passed: !cancelled && results.every(row => row.status === 'passed') };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: {
    files: { type: 'string' }, retries: { type: 'string', default: '2' }, timeout: { type: 'string', default: '120000' },
    quarantine: { type: 'string', default: 'planning/qualification/quarantine.json' },
    output: { type: 'string', default: 'planning/qualification/flaky.json' }, 'check-quarantine': { type: 'boolean' },
  } });
  try {
    const quarantine = JSON.parse(readFileSync(values.quarantine, 'utf8'));
    if (values['check-quarantine']) console.log(JSON.stringify({ passed: true, active: checkQuarantine(quarantine).length }));
    else {
      const result = detect({ files: values.files?.split(',').filter(Boolean), quarantine,
        retries: Number(values.retries), timeout: Number(values.timeout) });
      result.commit = git(['rev-parse', 'HEAD']).trim();
      mkdirSync(dirname(resolve(values.output)), { recursive: true });
      writeFileSync(values.output, JSON.stringify(result, null, 2) + '\n');
      console.log(JSON.stringify({ passed: result.passed, files: result.results.map(({ file, status, failureRate }) => ({ file, status, failureRate })) }));
      process.exitCode = result.passed ? 0 : 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
