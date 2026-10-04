import { execFileSync } from 'node:child_process';
import { appendFile, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activateBaselineProfile, baselineProfileRequest } from './project16-baseline-profiles.js';

const prefix = 'codex/project16/qualify-';
const branchPattern = new RegExp(
  '^codex/project16/qualify-(ubuntu|windows|macos)-(chromium|firefox|webkit)-' +
  '(all|node|browser|performance|standalone)-([a-z0-9][a-z0-9-]{6,62}[a-z0-9])$'
);
const runners = new Map([
  ['ubuntu-latest', 'Linux'], ['windows-latest', 'Windows'], ['macos-latest', 'macOS']
]);
const engines = new Set(['chromium', 'firefox', 'webkit']);
const stages = new Set(['all', 'node', 'browser', 'performance', 'standalone']);
const maximumEventBytes = 256 * 1024;

function singleLine(value, label, maximum = 4096) {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} must be bounded text without control characters`);
  }
  return value;
}

function immutableSha(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value) || /^0+$/.test(value)) {
    throw new Error(`${label} must be an immutable 40-character Git object SHA`);
  }
  return value;
}

function validRef(value) {
  singleLine(value, 'GitHub ref', 256);
  const parts = value.split('/');
  const forbidden = [...value].some(character => character.charCodeAt(0) <= 32 || '~^:?*[\\'.includes(character));
  if (!['refs/heads/', 'refs/tags/'].some(start => value.startsWith(start)) || parts.length < 3 || forbidden ||
      value.includes('..') || value.includes('@{') || parts.some(part => !part || part.startsWith('.') ||
        part.endsWith('.') || part.endsWith('.lock'))) {
    throw new Error('GitHub ref must be an explicit valid branch or tag ref');
  }
  return value;
}

function manualSelection(event, ref) {
  const inputs = event.inputs ?? {};
  if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs)) throw new Error('Invalid dispatch inputs');
  if (event.ref !== undefined && event.ref !== ref && event.ref !== ref.replace(/^refs\/(?:heads|tags)\//, '')) {
    throw new Error('Dispatch event ref does not match the GitHub ref');
  }
  return {
    runner: inputs.runner ?? 'ubuntu-latest', engine: inputs.engine ?? 'chromium', stage: inputs.stage ?? 'all',
    editorBaseline: singleLine(inputs.editor_baseline ?? '', 'Editor baseline'),
    workbenchBaseline: singleLine(inputs.workbench_baseline ?? '', 'Workbench baseline'), nonce: '', baselineProfile: null
  };
}

function createdBranchSelection(event, ref) {
  if (event.ref_type !== 'branch' || typeof event.ref !== 'string' || !event.ref.startsWith(prefix)) {
    throw new Error('Only an explicitly named Project16 qualification branch may use the create trigger');
  }
  const match = branchPattern.exec(event.ref);
  if (!match) throw new Error('Malformed Project16 qualification branch name');
  if (ref !== 'refs/heads/' + event.ref) throw new Error('Created branch does not match the GitHub ref');
  const selected = {
    runner: match[1] + '-latest', engine: match[2], stage: match[3], nonce: match[4],
    editorBaseline: '', workbenchBaseline: ''
  };
  return { ...selected, baselineProfile: baselineProfileRequest(selected) };
}

/** Pure trigger validation; this function never installs dependencies or starts a qualification capture. */
export function resolveQualificationTrigger({ eventName, event, ref, sha, checkoutSha, runnerOS }) {
  immutableSha(sha, 'GitHub SHA');
  immutableSha(checkoutSha, 'Checked-out SHA');
  if (sha !== checkoutSha) throw new Error('Checked-out HEAD does not match the immutable GitHub SHA');
  validRef(ref);
  if (typeof event !== 'object' || event === null || Array.isArray(event)) throw new Error('Invalid GitHub event');
  let selected;
  if (eventName === 'workflow_dispatch') selected = manualSelection(event, ref);
  else if (eventName === 'create') selected = createdBranchSelection(event, ref);
  else throw new Error('Only workflow_dispatch and the explicit create trigger are supported');
  if (!runners.has(selected.runner)) throw new Error('Unsupported qualification runner');
  if (!engines.has(selected.engine)) throw new Error('Unsupported qualification browser');
  if (!stages.has(selected.stage)) throw new Error('Unsupported qualification stage');
  if (runners.get(selected.runner) !== runnerOS) throw new Error('Allocated runner does not match the requested platform');
  return Object.freeze({ ...selected, eventName, ref, sha,
    captureOnly: !selected.baselineProfile && !selected.editorBaseline && !selected.workbenchBaseline });
}

/** Fixed-key, single-line records prevent a baseline path from injecting a second Actions environment value. */
export function qualificationEnvironment(selected, treeSha) {
  immutableSha(treeSha, 'Checked-out tree SHA');
  if (selected.baselineProfile && selected.baselineProfileVerified !== true) {
    throw new Error('A requested baseline profile must be verified before writing qualification environment');
  }
  const values = {
    QUALIFICATION_TRIGGER_EVENT: selected.eventName,
    QUALIFICATION_TRIGGER_REF: selected.ref,
    QUALIFICATION_TRIGGER_NONCE: selected.nonce,
    QUALIFICATION_SOURCE_SHA: selected.sha,
    QUALIFICATION_SOURCE_TREE: treeSha,
    QUALIFICATION_RUNNER: selected.runner,
    QUALIFICATION_STAGE: selected.stage,
    QUALIFICATION_CAPTURE_ONLY: String(selected.captureOnly),
    QUALIFICATION_BASELINE_PROFILE: selected.baselineProfile ?? '',
    SHARPFORGE_BROWSER_ENGINE: selected.engine,
    SHARPFORGE_EDITOR_BASELINE: selected.editorBaseline,
    SHARPFORGE_WORKBENCH_BASELINE: selected.workbenchBaseline
  };
  return Object.entries(values).map(([key, value]) => `${key}=${singleLine(value, key)}\n`).join('');
}

async function readEvent(path) {
  if (!path) throw new Error('GITHUB_EVENT_PATH is required');
  const handle = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(maximumEventBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > maximumEventBytes) throw new Error('GitHub event exceeds the 256 KiB resolver limit');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
  } finally {
    await handle.close();
  }
}

export async function resolveTriggerEnvironment(env = process.env) {
  if (!env.GITHUB_ENV) throw new Error('GITHUB_ENV is required');
  const cwd = env.GITHUB_WORKSPACE || fileURLToPath(new URL('../', import.meta.url));
  const git = value => execFileSync('git', ['rev-parse', '--verify', value], {
    cwd, encoding: 'utf8', maxBuffer: 1024, timeout: 10000
  }).trim();
  const requested = resolveQualificationTrigger({
    eventName: env.GITHUB_EVENT_NAME, event: await readEvent(env.GITHUB_EVENT_PATH),
    ref: env.GITHUB_REF, sha: env.GITHUB_SHA, checkoutSha: git('HEAD'), runnerOS: env.RUNNER_OS
  });
  const selected = await activateBaselineProfile(requested, { root: cwd });
  const output = qualificationEnvironment(selected, git('HEAD^{tree}'));
  await appendFile(env.GITHUB_ENV, output, 'utf8');
  return selected;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const selected = await resolveTriggerEnvironment();
    process.stdout.write(`Resolved ${selected.eventName}: ${selected.runner}/${selected.engine}/${selected.stage} at ${selected.sha}\n`);
  } catch (error) {
    process.stderr.write(`Qualification trigger rejected: ${error.message}\n`);
    process.exitCode = 1;
  }
}
