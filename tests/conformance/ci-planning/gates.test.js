import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { claimedIdentity, runGates } from '../../../scripts/conformance/ci-planning/gates.js';
import { normalizePlanningContext } from '../../../scripts/conformance/ci-planning/context.js';

const task = 'SF-A29-T13';
const pr = { head: { ref: 'codex/planning' }, body: `Task: ${task}`, base: { sha: 'a'.repeat(40) } };
function client() {
  return {
    items: async () => [{ fields: { 'Work ID': task, Branch: pr.head.ref }, content: { title: `[${task}] task` } }],
    ref: async name => ({ object: { sha: name } }),
    readRecord: async name => name.startsWith('agent-locks/') ? { task, generation: 'generation', paths: ['packages/other/**'] } :
      { task, branch: pr.head.ref, expires: '2099-01-01T00:00:00Z', generation: 'generation', locks: ['fixture'] },
  };
}
test('PR identity binds project branch and authoritative claim/lock generation', async () => {
  assert.equal((await claimedIdentity(client(), pr)).area, 'A29');
  await assert.rejects(claimedIdentity({ ...client(), ref: async () => null }, pr), /no authoritative claim/);
  await assert.rejects(claimedIdentity(client(), { ...pr, body: 'Task: SF-A29-T14' }), /exactly one/);
  await assert.rejects(claimedIdentity(client(), pr, Date.parse('2100-01-01')), /expired/);
  const mismatch = client();
  const read = mismatch.readRecord;
  mismatch.readRecord = async name => ({ ...await read(name), generation: name.startsWith('agent-locks/') ? 'wrong' : 'generation' });
  await assert.rejects(claimedIdentity(mismatch, pr), /Unverified lock/);
});
test('context-free planning qualification fails before executing repository commands', async () => {
  const commands = [];
  const report = await runGates({ execute: (command, args) => {
    commands.push(args);
    return { status: args.includes('scripts/planning/dag.js') ? 1 : 0, stdout: '', stderr: 'Duplicate work ID: fixture' };
  } });
  assert.equal(report.passed, false);
  assert.equal(report.results.length, 1);
  assert.match(report.errors[0], /Missing authoritative PR qualification context/);
  assert.deepEqual(commands, []);
});
test('cross-area actual Git diff fails ownership and the matching authoritative lock passes', async t => {
  const root = mkdtempSync(join(tmpdir(), 'sf-ci-gates-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '-b', 'main']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.test']);
  mkdirSync(join(root, 'planning/contracts'), { recursive: true });
  const write = (name, value) => writeFileSync(join(root, 'planning/contracts', name), JSON.stringify(value));
  write('ownership.json', { areas: { A29: { write: ['scripts/conformance/**'], evidence: ['tests/**'] } } });
  write('ownership-exceptions.json', { docsOnly: [], generated: [], areaGenerated: [] });
  write('locks.json', { fixture: ['packages/other/**'] });
  git(['add', '.']); git(['commit', '-m', 'base']);
  const request = { ...pr, base: { sha: git(['rev-parse', 'HEAD']) } };
  mkdirSync(join(root, 'packages/other'), { recursive: true });
  writeFileSync(join(root, 'packages/other/index.js'), 'export const n=1;\n');
  git(['add', '.']); git(['commit', '-m', 'cross-area']);
  const repository = 'fixture/repository', head = git(['rev-parse', 'HEAD']);
  const context = normalizePlanningContext({ repository, number: 1, head, base: request.base.sha,
    request: { ...request, number: 1, state: 'open', labels: [],
      base: { ...request.base, repo: { full_name: repository } },
      head: { ...request.head, sha: head, repo: { full_name: repository } } } });
  const execute = (command, args, options) => {
    if (command !== 'git') return { status: 0, stdout: '', stderr: '' };
    try { return { status: 0, stdout: execFileSync(command, args, options) }; }
    catch { return { status: 1, stdout: '' }; }
  };
  const noLock = client();
  const read = noLock.readRecord;
  noLock.readRecord = async name => ({ ...await read(name), locks: [] });
  assert.equal((await runGates({ root, context, client: noLock, execute })).passed, false);
  assert.equal((await runGates({ root, context, client: client(), execute })).passed, true);
  const commands = [];
  const failed = await runGates({ root, context, client: client(), execute: (command, args, options) => {
    commands.push(args);
    if (command === 'git') return execute(command, args, options);
    return { status: args.includes('scripts/planning/dag.js') ? 1 : 0, stdout: '', stderr: 'Duplicate work ID: fixture' };
  } });
  assert.equal(failed.passed, false);
  assert.equal(failed.results.length, 5);
  assert.match(failed.errors[0], /Duplicate work ID/);
  assert(commands.some(args => args.includes('planning/contracts/tests/merge-pair.test.js')));
});
