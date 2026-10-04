import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { git } from '../../../scripts/planning/lib/io.js';

/** Actual two-PR Git graph; each branch is compatible alone, together IDs collide. */
export function mergeGroupFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'sf-merge-group-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const command = args => git(args, root).trim();
  const write = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  };
  const commit = changes => {
    for (const [path, value] of Object.entries(changes)) write(path, value);
    command(['add', '.']); command(['commit', '-m', 'fixture']);
    return command(['rev-parse', 'HEAD']);
  };
  command(['init', '-b', 'main']);
  command(['config', 'user.name', 'Fixture']); command(['config', 'user.email', 'fixture@example.test']);
  command(['config', 'commit.gpgsign', 'false']);
  const contract = 'planning/contracts/framework-ids.lock.json';
  const baseline = [{ id: 0, name: 'existing' }];
  const leftIds = [...baseline, { id: 1, name: 'Left' }];
  const rightIds = [...baseline, { id: 1, name: 'Right' }];
  const base = commit({
    [contract]: baseline,
    'planning/contracts/ownership.json': { areas: { A29: { write: ['planning/**', 'scripts/**'], evidence: ['tests/**'] } } },
    'planning/contracts/ownership-exceptions.json': { docsOnly: [], generated: [], areaGenerated: [] },
    'planning/contracts/locks.json': {},
    'planning/contracts/versions.json': { framework: 1 },
  });
  command(['checkout', '-b', 'codex/left']);
  const left = commit({ [contract]: leftIds });
  command(['checkout', '-b', 'codex/right', base]);
  const right = commit({ [contract]: rightIds });
  const first = command(['commit-tree', `${left}^{tree}`, '-p', base, '-p', left, '-m', 'first queue contribution']);
  write(contract, [...leftIds, rightIds[1]]); command(['add', '.']);
  const tree = command(['write-tree']);
  const head = command(['commit-tree', tree, '-p', first, '-p', right, '-m', 'second queue contribution']);
  command(['reset', '--hard', head]);
  command(['checkout', '--detach', head]);
  const repository = 'fixture/repository';
  const headRef = 'refs/heads/gh-readonly-queue/main/pr-999-not-an-identity';
  const baseRef = 'refs/heads/main';
  const requests = [left, right].map((sha, index) => ({
    number: index + 11, state: 'open', body: `Task: SF-A29-T${index + 13}`,
    head: { sha, ref: `codex/${index ? 'right' : 'left'}`, repo: { full_name: repository } },
    base: { sha: base, ref: 'main', repo: { full_name: repository } }, labels: [],
  }));
  const calls = [];
  const client = {
    ref: async name => { calls.push(['ref', name]); return { object: { sha: head } }; },
    api: async (method, path) => {
      calls.push([method, path]);
      const associated = path.match(/^commits\/([a-f0-9]{40})\/pulls\?per_page=100&page=1$/);
      if (associated) return structuredClone(requests.filter(request => request.head.sha === associated[1]));
      const request = requests.find(request => path === `pulls/${request.number}`);
      if (method !== 'GET' || !request) throw new Error(`Unexpected API operation ${method} ${path}`);
      return structuredClone(request);
    },
  };
  return { root, repository, head, base, headRef, baseRef, left, right, first, contract, baseline, leftIds, rightIds,
    command, commit, write, requests, calls, client };
}
