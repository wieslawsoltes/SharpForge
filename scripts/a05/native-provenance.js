import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';

async function optionalFile(path, maximum) {
  try {
    if ((await stat(path)).size > maximum) throw new Error('Provenance input exceeds its byte limit: ' + path);
    return await readFile(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function workflowIdentity(environment) {
  const fields = {runId: 'GITHUB_RUN_ID', runAttempt: 'GITHUB_RUN_ATTEMPT', eventName: 'GITHUB_EVENT_NAME',
    repository: 'GITHUB_REPOSITORY', sha: 'GITHUB_SHA', ref: 'GITHUB_REF', headRef: 'GITHUB_HEAD_REF',
    baseRef: 'GITHUB_BASE_REF', workflowRef: 'GITHUB_WORKFLOW_REF', workflowSha: 'GITHUB_WORKFLOW_SHA'};
  const workflow = Object.fromEntries(Object.entries(fields).map(([key, variable]) => [key, environment[variable] ?? null]));
  workflow.pullRequest = null;
  if (!environment.GITHUB_EVENT_PATH) return workflow;
  const bytes = await optionalFile(environment.GITHUB_EVENT_PATH, 5 * 1024 * 1024);
  if (!bytes) return workflow;
  const event = JSON.parse(bytes.toString('utf8')), request = event.pull_request;
  if (request) workflow.pullRequest = {number: request.number ?? event.number ?? null,
    headSha: request.head?.sha ?? null, baseSha: request.base?.sha ?? null,
    headRepository: request.head?.repo?.full_name ?? null, baseRepository: request.base?.repo?.full_name ?? null};
  return workflow;
}

/** Record tested code and SDK selection separately; the generated untracked global.json is intentional. */
export async function nativeCheckoutProvenance({root, environment = process.env, probe}) {
  probe ??= (command, args) => execFileSync(command, args,
    {cwd: root, env: environment, encoding: 'utf8', timeout: 10000}).trim();
  const revision = probe('git', ['rev-parse', 'HEAD']);
  const tree = probe('git', ['rev-parse', 'HEAD^{tree}']);
  const trackedChanges = probe('git', ['status', '--porcelain', '--untracked-files=no']);
  const trackedGlobalJson = probe('git', ['ls-files', '--', 'global.json']) !== '';
  const bytes = await optionalFile(join(root, 'global.json'), 100 * 1024);
  return {revision, tree, trackedChanges, cleanTrackedTree: trackedChanges === '',
    globalJson: {path: 'global.json', present: bytes !== null, tracked: trackedGlobalJson,
      content: bytes?.toString('utf8') ?? null,
      sha256: bytes ? createHash('sha256').update(bytes).digest('hex') : null},
    workflow: await workflowIdentity(environment),
    nativeRuntimeObservation: 'dotnetRuntimes is the installed runtime inventory; it does not identify the guest process runtime patch.'};
}

/** A passing native report must describe the unmodified tested tree and, in CI, the event's checkout SHA. */
export function requireNativeCheckout(provenance) {
  if (!provenance.cleanTrackedTree || provenance.trackedChanges !== '') {
    throw new Error('Native qualification requires a clean tracked checkout; generated untracked global.json is permitted.');
  }
  if (provenance.workflow?.sha && provenance.workflow.sha !== provenance.revision) {
    throw new Error('Native qualification checkout differs from GITHUB_SHA');
  }
}
