import test from 'node:test';
import assert from 'node:assert/strict';
import {assessOverhead} from '../scripts/workbench-overhead/assessment.js';
import {protocol, operations, pairOrder, settingsState, workspaceFixture} from '../scripts/workbench-overhead/protocol.js';
import {WorkbenchPerformance} from '../apps/studio/workbench/perf.js';
import {productionServer} from '../scripts/workbench-overhead/server.js';

/** Synthetic durations test the assessment only; these fixtures are never benchmark evidence. */
function capture(enabledDuration = 100, disabledDuration = 100) {
  const runs = [];
  for (let pair = 0; pair < protocol.pairs; pair++) for (const [order, enabled] of pairOrder(pair).entries()) {
    const metrics = new WorkbenchPerformance({enabled, clock: () => 100});
    const samples = Object.entries(operations).flatMap(([operation, count]) => Array.from({length: count}, (_, ordinal) => {
      metrics.record(operation === 'trusted-key-input' ? 'input-delay' : operation, 1);
      return {operation, ordinal, durationMs: enabled ? enabledDuration : disabledDuration};
    }));
    runs.push({pair, order, enabled, observedEnabled: enabled, samples, trace: JSON.parse(metrics.export()),
      verified: {documentSwitches: protocol.documentSwitches, commands: protocol.commands,
        insertedCharacters: protocol.inputs, trustedInputs: protocol.inputs, coldTools: protocol.tools.length}});
  }
  return {format: 'sharpforge-instrumentation-overhead', version: 1, protocol: protocol.id, captureStatus: 'completed',
    identity: {driver: {commit: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true},
      source: {commit: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true}, harness: {sha256: 'c'.repeat(64)},
      artifact: {manifestSha256: 'd'.repeat(64), assetCount: 1, stable: true},
      served: ['before', 'after'].map(phase => ({phase, matched: true, expectedManifestSha256: 'd'.repeat(64),
        assetsSha256: 'e'.repeat(64), assets: [{path: 'synthetic'}]}))},
    environment: {engine: 'chromium', browserVersion: 'synthetic-unit-fixture', servingMode: 'http-production'}, workload: protocol,
    fixture: {sha256: workspaceFixture().sha256, sourceFiles: protocol.sourceFiles, projectFiles: 1}, browserErrors: [], runs};
}

test('whole workload gates strictly below one percent, retaining positive and negative observations', () => {
  for (const [duration, passed] of [[99, true], [100, true], [100.5, true], [101, false], [102, false]]) {
    const report = capture(duration), result = assessOverhead(report);
    assert.equal(result.passed, passed);
    assert(Math.abs(result.overheadPercent - (duration - 100)) < 1e-9);
    assert.equal(result.pairs.length, 12);
    assert.deepEqual(result.diagnostics.map(row => row.operation), Object.keys(operations));
    assert.equal(report.runs[0].samples[0].durationMs, 100);
    assert.equal(report.runs[1].samples[0].durationMs, duration);
  }
});

test('individual operation regressions remain diagnostic while the identical aggregate determines acceptance', () => {
  const report = capture(99);
  for (const run of report.runs.filter(run => run.enabled)) run.samples.find(sample => sample.operation === 'startup').durationMs = 110;
  const result = assessOverhead(report);
  assert.equal(result.passed, true);
  assert.equal(result.diagnostics.find(row => row.operation === 'startup').overheadPercent, 10);
});

test('assessment rejects missing pairs, wrong order, altered counts, nonfinite data and incomplete effects', () => {
  for (const mutate of [report => report.runs.pop(), report => { report.runs[0].enabled = true; },
    report => { report.runs[0].order = 1; }, report => { report.runs[0].observedEnabled = true; },
    report => report.runs[0].samples.pop(), report => { report.runs[0].samples[0].durationMs = Infinity; },
    report => { report.runs[0].samples[0].durationMs = -1; }, report => { report.runs[0].samples[1].ordinal = 3; },
    report => { report.runs[0].verified.insertedCharacters--; }, report => { report.runs[0].verified.trustedInputs--; },
    report => { report.captureStatus = 'incomplete'; }, report => { report.environment.servingMode = 'in-memory'; },
    report => { report.fixture.sha256 = '0'.repeat(64); }, report => { report.workload = {...protocol, inputs: 1}; },
    report => { report.identity.source.commit = 'f'.repeat(40); }, report => { report.identity.source.clean = false; },
    report => { report.identity.served[1].matched = false; }, report => { report.identity.served[1].assetsSha256 = '0'.repeat(64); },
    report => { report.identity.artifact.stable = false; },
    report => report.browserErrors.push('uncaught')]) {
    const report = capture(); mutate(report);
    assert.throws(() => assessOverhead(report));
  }
});

test('driver rejects non-HTTP or remote application origins without starting a server', async () => {
  for (const url of ['file:///tmp/index.html', 'https://example.com', 'data:text/html,Studio']) {
    await assert.rejects(productionServer(url), /local production HTTP/);
  }
});

test('assessment recomputes product p50/p95/p99 and rejects absent or active disabled instrumentation', () => {
  for (const mutate of [report => { report.runs[1].trace.summary[0].p95++; },
    report => report.runs[1].trace.samples.pop(), report => report.runs[1].trace.summary.pop(),
    report => { report.runs[0].trace = report.runs[1].trace; }]) {
    const report = capture(); mutate(report);
    assert.throws(() => assessOverhead(report), /trace|instrumentation|tracing/);
  }
});

test('clock-quantized zero operation spans are preserved but a zero aggregate denominator is rejected', () => {
  const report = capture();
  for (const run of report.runs) for (const sample of run.samples) if (sample.operation === 'command') sample.durationMs = 0;
  const commands = assessOverhead(report).diagnostics.find(row => row.operation === 'command');
  assert.equal(commands.disabled.p50Ms, 0);
  assert.equal(commands.overheadPercent, null);
  assert.equal(commands.zeroDenominator, true);
  assert.throws(() => assessOverhead(capture(0, 0)), /Unmeasurable/);
});

test('pre-navigation storage states differ only by explicit tracing mode; workload and order are deterministic', () => {
  const disabled = settingsState('http://127.0.0.1:1234', false), enabled = settingsState('http://127.0.0.1:1234', true);
  const read = state => JSON.parse(state.origins[0].localStorage[0].value);
  const settings = read(enabled);
  settings.user.environment.performanceTracing = false;
  assert.deepEqual(settings, read(disabled));
  assert.deepEqual([pairOrder(0), pairOrder(1), pairOrder(2)], [[false, true], [true, false], [false, true]]);
  assert.deepEqual(workspaceFixture(), workspaceFixture());
  assert.equal(workspaceFixture().records.length, 18);
});
