import {existsSync} from 'node:fs';
import {loadPlaywright} from './editor-benchmarks/browser.js';
import {environment, isMain, parseArguments, rootDirectory, writeReport} from './editor-benchmarks/common.js';
import {assessOverhead} from './workbench-overhead/assessment.js';
import {captureRun} from './workbench-overhead/capture.js';
import {pairOrder, protocol, viewport, workspaceFixture} from './workbench-overhead/protocol.js';
import {productionServer} from './workbench-overhead/server.js';
import {prepareIdentity, requireExactSource, verifyServedIdentity} from './workbench-overhead/identity.js';

/** Explicit serial real-browser measurement; unavailable browsers and >1% overhead both fail closed. */
export async function benchmarkWorkbenchOverhead({browser: engineName = 'chromium', output, url} = {}) {
  const fixture = workspaceFixture();
  const {commit: driverCommit, ...hostEnvironment} = environment();
  const report = {format: 'sharpforge-instrumentation-overhead', version: 1, protocol: protocol.id,
    captureStatus: 'incomplete', startedAt: new Date().toISOString(), environment: {
      ...hostEnvironment, driverCommit, engine: engineName, servingMode: 'http-production', viewport, deviceScaleFactor: 1,
      clock: 'browser PerformanceNavigationTiming and performance.now',
      contexts: 'fresh isolated context per capture; browser process shared; serial alternating order'
    }, fixture: {sha256: fixture.sha256, sourceFiles: protocol.sourceFiles, projectFiles: 1},
    workload: protocol, runs: [], browserErrors: [], assessment: null,
    measurement: {
      startup: 'navigation start through DOMContentLoaded end; synchronous module/application bootstrap, excludes async workspace readiness',
      laterOperations: 'actual product API invocation to resolution; trusted keydown capture through beforeinput bubble after editor insertion',
      exclusions: 'fixture import, readiness polling, Playwright transport, frame settling and report export are outside all measured spans',
      input: 'trusted browser input dispatch and model insertion; not input-to-paint or OS latency',
      limitations: 'fixed small C# workspace, one shared-host observation; no statistical proof or claim for every workload/platform'
    }};
  const destination = output ?? `artifacts/project16/instrumentation-overhead-${engineName}.json`;
  let server, browser, identity;
  try {
    if (!['chromium', 'firefox', 'webkit'].includes(engineName)) throw new Error('Unsupported browser engine');
    const engine = loadPlaywright()[engineName];
    const executablePath = process.env[`${engineName.toUpperCase()}_EXECUTABLE`];
    if (!existsSync(executablePath ?? engine.executablePath())) throw new Error(`Missing ${engineName} executable; no measurement available`);
    identity = await prepareIdentity(rootDirectory);
    report.identity = identity.report;
    requireExactSource(identity.report.source, identity.report.driver);
    if (!identity.report.artifact.stable) throw new Error('Source changed while production artifact was built');
    server = await productionServer(url);
    await verifyServedIdentity(identity, server.url, 'before');
    browser = await engine.launch({headless: true, timeout: 30000, ...(executablePath ? {executablePath} : {})});
    report.environment.browserVersion = browser.version();
    report.environment.url = server.url;
    const deadline = Date.now() + 900000;
    for (let pair = 0; pair < protocol.pairs; pair++) {
      for (const [order, enabled] of pairOrder(pair).entries()) {
        const run = {pair, order, enabled, samples: []};
        report.runs.push(run);
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('Instrumentation capture exceeded its 15-minute total limit');
        try { await captureRun(browser, server.url, run, fixture.records, report.browserErrors, Math.min(60000, remaining)); }
        finally { await writeReport(destination, report); }
        if (report.browserErrors.length) throw new Error('Browser errors invalidate instrumentation capture');
      }
    }
    await verifyServedIdentity(identity, server.url, 'after');
    report.captureStatus = 'completed';
    report.assessment = assessOverhead(report);
  } catch (error) {
    report.error = {name: error.name, message: error.message, stack: error.stack};
  } finally {
    report.finishedAt = new Date().toISOString();
    try { await writeReport(destination, report); }
    finally {
      try { await browser?.close(); }
      finally { await server?.stop(); }
    }
  }
  return report;
}

if (isMain(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  for (const key of Object.keys(args)) if (!['browser', 'output', 'url'].includes(key)) throw new Error('Unknown argument --' + key);
  const report = await benchmarkWorkbenchOverhead(args);
  console.log(JSON.stringify({captureStatus: report.captureStatus, assessment: report.assessment, error: report.error}, null, 2));
  if (report.error || !report.assessment?.passed) process.exitCode = 1;
}
