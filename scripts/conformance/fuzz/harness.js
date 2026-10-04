import { fileURLToPath } from 'node:url';
import { normalizeBudgets, PROTOCOL, validateInput, validateTargetId, validateUint32 } from './budgets.js';
import { inputDigest, normalizeSourceIdentity, readCorpus, writeFinding } from './corpus.js';
import { mutateBytes } from './mutations.js';
import { runIsolated } from './process.js';

const defaultArtifacts = fileURLToPath(new URL('../../../artifacts/fuzz/findings/', import.meta.url));
const environment = () => ({ node: process.version, platform: process.platform, arch: process.arch });
const finding = (kind, detail) => ({ status: 'finding', finding: { kind, detail: String(detail).slice(0, 2048) } });

function decodeResult(processResult, budgets) {
  const isolation = { v8OldSpaceMb: budgets.v8HeapMb, rssGuard: processResult.rssGuard ?? 'not-observed', osMemorySandbox: false };
  const metrics = { processElapsedMs: processResult.elapsedMs, sampledRssBytes: processResult.sampledRssBytes ?? 0 };
  if (processResult.termination) {
    return { ...(processResult.termination === 'cancelled' ? { status: 'cancelled' }
      : finding(processResult.termination, processResult.detail)), metrics, isolation };
  }
  if (processResult.exitCode !== 0) {
    return { ...finding('abnormal-exit', `Child exit ${processResult.exitCode}, signal ${processResult.signal}`), metrics, isolation };
  }
  try {
    const rows = processResult.stdout.trimEnd().split('\n').map(line => JSON.parse(line));
    if (rows.length !== 2 || rows.some(row => row.protocol !== PROTOCOL)
      || rows[0].type !== 'ready' || rows[1].type !== 'result' || processResult.stderr) throw new Error('Unexpected child output');
    const result = rows[1].result;
    if (!result || !['accepted', 'rejected', 'unsupported', 'finding'].includes(result.status)) throw new Error('Invalid child status');
    const combined = { ...metrics, ...result.metrics };
    if (Object.values(combined).some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid child measurement');
    if (Math.max(combined.peakRssBytes ?? 0, combined.sampledRssBytes) > budgets.rssBytes) {
      return { ...finding('rss-limit', 'Observed peak resident memory exceeds limit'), metrics: combined, isolation };
    }
    return { ...result, metrics: combined, isolation };
  } catch (error) {
    return { ...finding('invalid-protocol', error.message), metrics, isolation };
  }
}

/** One fixed target, literal bytes, and a freshly reaped process. Self checks require explicit test-only mode. */
export async function runCase({ targetId, input, seed = 1, caseIndex = 0, budgets = {}, signal, selfTest = false,
  sourceIdentity = null }) {
  const limits = normalizeBudgets(budgets);
  validateTargetId(targetId, selfTest);
  validateUint32(seed);
  validateUint32(caseIndex, 'caseIndex');
  validateInput(input, limits.maxInputBytes);
  const source = normalizeSourceIdentity(sourceIdentity);
  const bytes = new Uint8Array(input);
  const request = { protocol: PROTOCOL, mode: 'run', targetId, selfTest, budgets: limits, inputBase64: Buffer.from(bytes).toString('base64') };
  const result = decodeResult(await runIsolated(request, { signal }), limits);
  return {
    targetId, seed, caseIndex, inputBytes: bytes.length, inputSHA256: inputDigest(bytes), sourceIdentity: source, budgets: limits,
    qualification: selfTest ? 'harness-self-check' : 'node-offline-parser', ...result,
  };
}

function campaignDeadline(signal, timeoutMs) {
  const controller = new AbortController();
  let expired = false;
  const abort = () => controller.abort(signal.reason);
  const timer = setTimeout(() => { expired = true; controller.abort(new Error('Campaign deadline')); }, timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  return {
    signal: controller.signal, get expired() { return expired; },
    dispose() { clearTimeout(timer); signal?.removeEventListener('abort', abort); },
  };
}

function createReport(limits, requestedCases, extra = {}) {
  return {
    schemaVersion: 1, status: 'incomplete', requestedCases, completedCases: 0,
    counts: { accepted: 0, rejected: 0, unsupported: 0, findings: 0, cancelled: 0 },
    cases: [], artifacts: [], budgets: limits, environment: environment(), ...extra,
  };
}

function appendCase(report, result) {
  report.cases.push(result);
  report.counts[result.status === 'finding' ? 'findings' : result.status]++;
  if (result.status !== 'cancelled') report.completedCases++;
}

function finishReport(report, deadline) {
  if (report.counts.findings || report.error) report.status = 'failed';
  else if (deadline.expired) { report.status = 'incomplete'; report.reason = 'Campaign time limit reached'; }
  else if (deadline.signal.aborted) report.status = 'cancelled';
  else if (report.counts.unsupported) report.status = 'unsupported';
  else if (report.completedCases === report.requestedCases && report.requestedCases > 0) report.status = 'passed';
  else { report.status = 'incomplete'; report.reason ??= 'No cases or case limit reached'; }
  return report;
}

async function acquireSeeds(targetId, budgets, signal) {
  const processResult = await runIsolated({ protocol: PROTOCOL, mode: 'seeds', targetId, budgets }, { signal });
  const result = decodeResult(processResult, budgets);
  if (result.status !== 'accepted') return { result, seeds: [] };
  if (!Array.isArray(result.seeds) || !result.seeds.length) throw new Error('Target did not provide owned seeds');
  const seeds = result.seeds.map(seed => ({ name: seed.name, input: new Uint8Array(Buffer.from(seed.inputBase64, 'base64')) }));
  const { seeds: ignored, ...summary } = result;
  return { result: summary, seeds };
}

/** Finite, serial variations of owned seeds only; every finding is retained or persistence explicitly fails. */
export async function runCampaign({ targetId, seed = 1, budgets = {}, signal, artifactRoot = defaultArtifacts, sourceIdentity = null }) {
  const limits = normalizeBudgets(budgets);
  validateTargetId(targetId);
  validateUint32(seed);
  const source = normalizeSourceIdentity(sourceIdentity);
  const report = createReport(limits, limits.maxCases, { targetId, seed, sourceIdentity: source });
  const deadline = campaignDeadline(signal, limits.campaignTimeoutMs);
  try {
    const acquired = await acquireSeeds(targetId, limits, deadline.signal);
    report.seedAcquisition = acquired.result;
    if (acquired.result.status !== 'accepted') {
      report.counts[acquired.result.status === 'finding' ? 'findings' : acquired.result.status]++;
      return finishReport(report, deadline);
    }
    for (let caseIndex = 0; caseIndex < limits.maxCases && !deadline.signal.aborted; caseIndex++) {
      const original = acquired.seeds[caseIndex % acquired.seeds.length];
      const variation = caseIndex < acquired.seeds.length ? { input: original.input, operation: 'seed' }
        : mutateBytes(original.input, { seed, caseIndex, maxInputBytes: limits.maxInputBytes });
      const result = await runCase({ targetId, input: variation.input, seed, caseIndex, budgets: limits,
        signal: deadline.signal, sourceIdentity: source });
      appendCase(report, { ...result, seedName: original.name, mutation: variation.operation });
      if (result.status === 'finding') {
        report.artifacts.push(await writeFinding(artifactRoot, result, variation.input, { budgets: limits, sourceIdentity: source }));
      }
      if (result.status === 'cancelled') break;
    }
  } catch (error) {
    report.error = String(error.message).slice(0, 2048);
  } finally {
    deadline.dispose();
  }
  return finishReport(report, deadline);
}

/** Regression replay never mutates inputs or writes the committed corpus; original findings remain failures. */
export async function replayCorpus({ directory, budgets = {}, signal, sourceIdentity = null }) {
  const limits = normalizeBudgets(budgets);
  const source = normalizeSourceIdentity(sourceIdentity);
  const report = createReport(limits, 0, { sourceIdentity: source });
  const deadline = campaignDeadline(signal, limits.campaignTimeoutMs);
  try {
    const records = await readCorpus({ directory, budgets: limits });
    report.requestedCases = records.length;
    for (const record of records.slice(0, limits.maxCases)) {
      if (deadline.signal.aborted) break;
      const narrowed = Object.fromEntries(Object.keys(limits).map(key => [key, Math.min(limits[key], record.budgets[key])]));
      const result = await runCase({ targetId: record.targetId, input: record.input, seed: record.seed,
        caseIndex: record.caseIndex, budgets: narrowed, signal: deadline.signal, sourceIdentity: source });
      appendCase(report, { ...result, corpusRecord: record.recordSHA256, originalSourceIdentity: record.sourceIdentity });
    }
  } catch (error) {
    report.error = String(error.message).slice(0, 2048);
  } finally {
    deadline.dispose();
  }
  return finishReport(report, deadline);
}
