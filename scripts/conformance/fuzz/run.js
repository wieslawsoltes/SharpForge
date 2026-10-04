import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checkoutIdentity } from '../build-identity.js';
import { normalizeBudgets } from './budgets.js';
import { runCampaign, replayCorpus } from './harness.js';
import { targetIds, requireTargetId } from './target-ids.js';
import { campaignStatus, campaignExitCode, writeCampaignReport } from './campaign-report.js';
import { reproductionCommands } from './reproduction.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));

function integer(text, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!/^(?:0|[1-9]\d*)$/.test(text ?? '')) throw new Error(`${label} must be an unsigned decimal integer`);
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value > maximum) throw new Error(`${label} exceeds its supported range`);
  return value;
}

/** Parse a closed CLI contract before any output or child process is created. */
export function campaignArguments(args) {
  const { values } = parseArgs({ args, options: {
    target: { type: 'string', default: 'all' },
    seed: { type: 'string', default: '1' },
    cases: { type: 'string', default: '32' },
    'case-ms': { type: 'string', default: '1000' },
    'campaign-ms': { type: 'string', default: '30000' },
    output: { type: 'string' },
    replay: { type: 'string' },
    help: { type: 'boolean' },
  } });
  if (values.help) return { help: true };
  const selected = values.target === 'all' ? [...targetIds] : [requireTargetId(values.target)];
  if (!values.output?.trim()) throw new Error('--output must name a new output directory');
  if (values.replay && values.target !== 'all') throw new Error('--replay uses target identities from the corpus');
  return {
    selected,
    seed: integer(values.seed, '--seed', 0xffffffff),
    output: resolve(values.output),
    replay: values.replay ? resolve(values.replay) : null,
    budgets: normalizeBudgets({
      maxCases: integer(values.cases, '--cases'),
      caseTimeoutMs: integer(values['case-ms'], '--case-ms'),
      campaignTimeoutMs: integer(values['campaign-ms'], '--campaign-ms'),
    }),
  };
}

function failure(targetId, error) {
  return { schemaVersion: 1, targetId, status: 'failed', completedCases: 0,
    error: { name: error.name, message: String(error.message).slice(0, 2048) } };
}

async function captureTargets(options, signal, sourceIdentity) {
  const results = [];
  const reports = [];
  for (const targetId of options.selected) {
    const directory = join(options.output, targetId);
    await mkdir(directory);
    let result;
    if (signal.aborted) result = { targetId, status: 'cancelled', completedCases: 0, reason: 'Campaign cancelled before target' };
    else {
      try {
        result = await runCampaign({ targetId, seed: options.seed, budgets: options.budgets, signal, sourceIdentity,
          artifactRoot: join(directory, 'findings') });
      } catch (error) { result = failure(targetId, error); }
    }
    const asset = await writeCampaignReport(directory, result);
    reports.push({ ...asset, path: `${targetId}/${asset.path}` });
    results.push(result);
  }
  return { results, reports };
}

/** Execute one serial offline campaign and retain source-bound results even when targets fail. */
export async function run(args = process.argv.slice(2)) {
  const options = campaignArguments(args);
  if (options.help) {
    console.log('node scripts/conformance/fuzz/run.js --target all|NAME --seed 1 --cases 32 ' +
      '--case-ms 1000 --campaign-ms 30000 --output artifacts/fuzz/new-run [--replay DIRECTORY]');
    console.log('--campaign-ms is the deadline per target; --target all executes the eight targets serially.');
    return 0;
  }
  const sourceBefore = checkoutIdentity(repository);
  await mkdir(dirname(options.output), { recursive: true });
  await mkdir(options.output);
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('Campaign interrupted'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  const started = new Date().toISOString();
  try {
    let captured;
    if (options.replay) {
      const result = await replayCorpus({ directory: options.replay, budgets: options.budgets,
        signal: controller.signal, sourceIdentity: sourceBefore });
      const asset = await writeCampaignReport(options.output, result, 'replay.json');
      captured = { results: [{ ...result, targetId: 'corpus-replay' }], reports: [asset] };
    } else captured = await captureTargets(options, controller.signal, sourceBefore);
    const sourceAfter = checkoutIdentity(repository);
    const expected = options.replay ? ['corpus-replay'] : options.selected;
    const status = campaignStatus(captured.results, expected, sourceBefore, sourceAfter);
    const report = {
      schemaVersion: 1,
      kind: 'sharpforge-offline-fuzz-campaign',
      status,
      qualified: status === 'passed',
      qualification: 'bounded-node-offline-adapters',
      sourceBefore, sourceAfter,
      environment: { node: process.version, platform: process.platform, arch: process.arch },
      started, finished: new Date().toISOString(), seed: options.seed, budgets: options.budgets,
      targets: captured.results.map(result => ({ targetId: result.targetId, status: result.status,
        requestedCases: result.requestedCases, completedCases: result.completedCases, counts: result.counts })),
      reports: captured.reports,
      reproduction: reproductionCommands(options, repository, captured.results),
      limitations: [
        'Only the recorded cases and Node adapter profiles were exercised; mutation campaigns cannot prove parser safety.',
        'V8 heap limits and sampled RSS guards are not an operating-system memory or network sandbox.',
        'Provider authentication, archive extraction, physical devices, CLR and Rust/Wasm were not exercised.',
      ],
    };
    await writeCampaignReport(options.output, report, 'summary.json');
    console.log(JSON.stringify({ status, qualified: report.qualified, source: sourceBefore.commit,
      targets: report.targets, output: options.output }, null, 2));
    return campaignExitCode(status);
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await run(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
