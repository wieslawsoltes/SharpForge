import {existsSync} from 'node:fs';
import {loadPlaywright} from './editor-benchmarks/browser.js';
import {environment, isMain, parseArguments, rootDirectory, writeReport} from './editor-benchmarks/common.js';
import {productionServer} from './workbench-overhead/server.js';
import {requireExactSource, verifyServedIdentity} from './workbench-overhead/identity.js';
import {assessmentPlaceholder, runEvaluation} from './workbench-lazy-evaluation/runner.js';
import {evaluationIdentity} from './workbench-lazy-evaluation/identity.js';
import {evaluationServer, verifyOverlays} from './workbench-lazy-evaluation/server.js';
import {protocol} from './workbench-lazy-evaluation/protocol.js';
import {assessEvaluation} from './workbench-lazy-evaluation/assessment.js';

/** Explicit Chromium-only controlled counterfactual. Missing identity, capture failures and no improvement fail closed. */
export async function benchmarkLazyEvaluation({output, url, browser = 'chromium'} = {}) {
  const {commit: driverCommit, ...host} = environment();
  const report = {format: 'sharpforge-lazy-evaluation', version: 1, protocol: protocol.id, workload: protocol,
    startedAt: new Date().toISOString(), captureStatus: 'incomplete', runs: [], overlays: [],
    environment: {...host, driverCommit, engine: browser, timeDomain: protocol.timeDomain,
      processes: '24 fresh browser processes/profiles, serial, 12 alternating pairs; no warm-ups or retries'},
    measurement: {scope: 'Same-source eager-entry counterfactual versus shipped lazy module graph with equal wrapper scaffolding',
      metric: 'CDP main-thread ScriptDuration in threadTicks seconds, baseline before navigation to synchronous entry console.timeStamp',
      excludes: 'Network/wall startup, worker CPU, compile duration (reported separately), layout, paint and first tool activation',
      controls: 'Unchanged production assets/settings/CSP; fixed overlays differ only by five static module imports before studio.js',
      limits: 'One shared-host point observation; unknown OS clock quantization, shared filesystem cache, no historical speedup claim'},
    assessment: assessmentPlaceholder()};
  const destination = output ?? 'artifacts/project16/lazy-evaluation-chromium.json';
  const deadline = Date.now() + protocol.totalTimeoutMs;
  const remaining = () => {
    const value = deadline - Date.now();
    if (value <= 0) throw new Error('Lazy-evaluation capture exceeded its 15-minute total limit');
    return value;
  };
  let production, server;
  try {
    if (browser !== 'chromium') throw new Error('Lazy evaluation requires Chromium CDP threadTicks; other engines are unsupported');
    const engine = loadPlaywright().chromium;
    const executablePath = process.env.CHROMIUM_EXECUTABLE;
    if (!existsSync(executablePath ?? engine.executablePath())) throw new Error('Missing Chromium executable; no measurement available');
    const identity = await evaluationIdentity(rootDirectory);
    report.identity = identity.report;
    requireExactSource(identity.report.source, identity.report.driver);
    if (!identity.report.artifact.stable) throw new Error('Source changed during the production build');
    production = await productionServer(url);
    server = await evaluationServer(production.url);
    report.environment.url = server.url;
    await verifyServedIdentity(identity, server.url, 'before', {signal: AbortSignal.timeout(Math.min(120000, remaining()))});
    report.overlays.push(await verifyOverlays(server, AbortSignal.timeout(Math.min(15000, remaining()))));
    await runEvaluation({engine, server, report, remaining, executablePath, save: () => writeReport(destination, report)});
    await verifyServedIdentity(identity, server.url, 'after', {signal: AbortSignal.timeout(Math.min(120000, remaining()))});
    report.overlays.push(await verifyOverlays(server, AbortSignal.timeout(Math.min(15000, remaining()))));
    report.captureStatus = 'completed';
    report.assessment = assessEvaluation(report);
  } catch (error) {
    report.error = {name: error.name, message: error.message, stack: error.stack};
  } finally {
    report.finishedAt = new Date().toISOString();
    try { await server?.stop(); }
    catch (error) { report.cleanupError = error.message; }
    try { await production?.stop(); }
    catch (error) { report.cleanupError = error.message; }
    if (report.cleanupError) report.assessment.passed = false;
    await writeReport(destination, report);
  }
  return report;
}

if (isMain(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  for (const key of Object.keys(args)) if (!['browser', 'output', 'url'].includes(key)) throw new Error('Unknown argument --' + key);
  const report = await benchmarkLazyEvaluation(args);
  console.log(JSON.stringify({captureStatus: report.captureStatus, assessment: report.assessment, error: report.error}, null, 2));
  if (report.error || !report.assessment.passed) process.exitCode = 1;
}
