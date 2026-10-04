import test from 'node:test';
import assert from 'node:assert/strict';
import { runGitCLI } from '../apps/cli/git.js';
import { GitError } from '../packages/git/src/errors.js';

async function invoke(args, repository = {}) {
  let stdout = '';
  let stderr = '';
  const code = await runGitCLI(args, {
    repository, stdout: { write: text => { stdout += text; } }, stderr: { write: text => { stderr += text; } }, env: {}
  });
  return { code, stdout, stderr };
}

test('Git CLI documents explicit origin grants and rejects unknown command options', async () => {
  const help = await invoke(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /--allow-origin/);
  for (const args of [['status', '--amend'], ['diff', '--unknown'], ['init', 'one', 'two'], ['add', '-u', '-A']]) {
    assert.equal((await invoke(args)).code, 1, args.join(' '));
  }
});

test('Git CLI keeps structured remote errors free of credentials', async () => {
  const result = await invoke(['status', '--json'], {
    status: async () => { throw new GitError('Network', 'Authorization: Bearer secret-fixture-token'); }
  });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).code, 'Network');
  assert.doesNotMatch(result.stderr, /secret-fixture-token|Bearer/);
});

test('Git CLI parses revisions without treating dash-prefixed pathspecs as options', async () => {
  let received;
  const result = await invoke(['diff', '--name-only', '--', '-dash.txt'], {
    diff: async options => { received = options; return [{ path: '-dash.txt', status: 'M' }]; }
  });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '-dash.txt\n');
  assert.deepEqual(received.pathspec, ['-dash.txt']);
});

test('Git CLI rejects malformed numeric and date boundaries with typed errors', async () => {
  assert.equal((await invoke(['log', '--max-count=-1'])).code, 1);
  assert.equal((await invoke(['log', '--max-count=999999999999999999999'])).code, 1);
  const repo = { config: { get: () => 'fixture' } };
  assert.equal((await invoke(['commit', '-m', 'message', '--date', 'not-a-date'], repo)).code, 1);
});
