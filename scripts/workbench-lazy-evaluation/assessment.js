import {requireExactSource} from '../workbench-overhead/identity.js';
import {sha256} from '../conformance/build-identity.js';
import {deferredModules, entryDurations, entryModule, entryPath, pagePath, pairOrder, protocol} from './protocol.js';

const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function validateIdentity(report) {
  const identity = report.identity;
  requireExactSource(identity?.source, identity?.driver);
  if (!identity.artifact?.stable || !digest(identity.artifact.assetsSha256) || !digest(identity.artifact.manifestSha256)
    || !digest(identity.harness?.sha256) || !Number.isSafeInteger(identity.artifact.assetCount) || identity.artifact.assetCount < 1) {
    throw new Error('Missing stable artifact/harness identity');
  }
  const served = identity.served;
  if (served?.length !== 2 || served[0].phase !== 'before' || served[1].phase !== 'after'
    || served.some(item => !item.matched || item.expectedManifestSha256 !== identity.artifact.manifestSha256)
    || !digest(served[0].assetsSha256) || served[0].assetsSha256 !== served[1].assetsSha256) {
    throw new Error('Incomplete or inconsistent served production identity');
  }
  for (const phase of served) {
    if (phase.assets?.length !== identity.artifact.assetCount || sha256(JSON.stringify(phase.assets)) !== phase.assetsSha256) {
      throw new Error('Served asset inventory differs from its retained digest');
    }
  }
  if (report.overlays?.length !== 2 || !same(report.overlays[0], report.overlays[1]) || report.overlays[0].length !== 4) {
    throw new Error('Incomplete or inconsistent served overlay identity');
  }
  for (const variant of ['lazy', 'eager']) {
    const rows = report.overlays[0];
    const entry = rows.find(row => row.path === entryPath(variant));
    if (entry?.sha256 !== sha256(entryModule(variant)) || !rows.some(row => row.path === pagePath(variant) && digest(row.sha256))) {
      throw new Error('Entry overlay differs from the fixed counterfactual');
    }
  }
}

function validateRun(run, index, report) {
  const pair = Math.floor(index / 2), order = index % 2;
  if (run.pair !== pair || run.order !== order || run.variant !== pairOrder(pair)[order] || !run.completed
    || run.timeDomain !== 'threadTicks' || run.browserVersion !== report.environment.browserVersion
    || run.artifactSha256 !== report.identity.artifact.assetsSha256 || !run.productReady
    || !Array.isArray(run.errors) || run.errors.length) {
    throw new Error('Incomplete, invalid, or product-failing capture at index ' + index);
  }
  const markers = run.metricEvents?.filter(event => event.title === protocol.marker);
  if (markers?.length !== 1 || !same(markers[0], run.entryEvent)) throw new Error('Missing or inconsistent exact entry marker');
  const duration = entryDurations(run.baselineMetrics, run.entryEvent);
  if (duration.scriptDurationMs !== run.scriptDurationMs || duration.compileDurationMs !== run.compileDurationMs) {
    throw new Error('Reported duration differs from retained raw CDP metrics');
  }
  const expected = run.variant === 'lazy' ? [] : deferredModules;
  if (!same(run.deferredRequests, expected)) throw new Error('Observed module graph does not match the entry variant');
  return duration.scriptDurationMs;
}

/** Signed point observation, not a significance test or historical before/after speedup. */
export function assessEvaluation(report) {
  if (report.captureStatus !== 'completed' || report.protocol !== protocol.id || report.runs?.length !== protocol.pairs * 2) {
    throw new Error('Expected the complete fixed 12-pair protocol');
  }
  if (report.environment?.engine !== 'chromium' || report.environment.timeDomain !== 'threadTicks'
    || typeof report.environment.browserVersion !== 'string' || !report.environment.browserVersion
    || !Array.isArray(report.serverErrors) || report.serverErrors.length) throw new Error('Invalid browser/server capture');
  validateIdentity(report);
  const samples = report.runs.map((run, index) => validateRun(run, index, report));
  const pairs = [];
  for (let pair = 0; pair < protocol.pairs; pair++) {
    const first = pair * 2, lazyIndex = report.runs[first].variant === 'lazy' ? first : first + 1;
    const eagerIndex = lazyIndex === first ? first + 1 : first;
    const lazyMs = samples[lazyIndex], eagerMs = samples[eagerIndex];
    pairs.push({pair, lazyMs, eagerMs, savedMs: eagerMs - lazyMs, reductionPercent: (eagerMs - lazyMs) / eagerMs * 100});
  }
  const lazyMs = pairs.reduce((sum, pair) => sum + pair.lazyMs, 0);
  const eagerMs = pairs.reduce((sum, pair) => sum + pair.eagerMs, 0);
  const signed = pairs.map(pair => pair.savedMs).sort((left, right) => left - right);
  const mean = (eagerMs - lazyMs) / pairs.length;
  return {passed: eagerMs > lazyMs, gate: 'paired aggregate eager ScriptDuration is strictly greater than lazy ScriptDuration',
    eagerMs, lazyMs, savedMs: eagerMs - lazyMs, reductionPercent: (eagerMs - lazyMs) / eagerMs * 100, pairs,
    dispersion: {positivePairs: signed.filter(value => value > 0).length, zeroPairs: signed.filter(value => value === 0).length,
      negativePairs: signed.filter(value => value < 0).length, minMs: signed[0], maxMs: signed.at(-1), meanMs: mean,
      medianMs: (signed[5] + signed[6]) / 2,
      populationStandardDeviationMs: Math.sqrt(signed.reduce((sum, value) => sum + (value - mean) ** 2, 0) / signed.length)},
    uncertainty: 'Untrimmed single shared-host observation; positive aggregate is not statistical proof. CDP/OS clock quantization '
      + 'is unknown; no zero/noise observations are discarded. No historical, worker CPU, paint, or wall-startup speedup claim.'};
}
