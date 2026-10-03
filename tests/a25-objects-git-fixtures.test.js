import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  encodeTree, decodeTree, encodeCommit, decodeCommit, encodeTag, decodeTag,
  serializeObject, parseObject, hashObject, encodeLooseObject, decodeLooseObject
} from '../packages/git/src/objects.js';

const encoder = new TextEncoder();
const identity = 'Fixture Author <fixture@example.test> 1234567890 +0530';

function replaceFixtureObject(path, bytes) {
  // Native Git makes loose objects read-only; only this test-owned copy is rewritten for the reverse codec comparison.
  const permissions = statSync(path).mode & 0o777;
  chmodSync(path, permissions | 0o200);
  try { writeFileSync(path, bytes); }
  finally { chmodSync(path, permissions); }
}

test('200 command-line Git objects round-trip byte-identically under SHA-1 and SHA-256', async context => {
  const root = mkdtempSync(join(tmpdir(), 'sharpforge-git-objects-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  context.diagnostic(execFileSync('git', ['--version'], { encoding: 'utf8' }).trim());
  let fixtures = 0;
  for (const algorithm of ['sha1', 'sha256']) {
    const directory = join(root, algorithm);
    mkdirSync(directory);
    const git = (args, input) => execFileSync('git', args, {
      cwd: directory, input, encoding: null, maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
        GIT_AUTHOR_NAME: 'Fixture Author', GIT_AUTHOR_EMAIL: 'fixture@example.test',
        GIT_COMMITTER_NAME: 'Fixture Committer', GIT_COMMITTER_EMAIL: 'committer@example.test',
        GIT_AUTHOR_DATE: '@1234567890 +0530', GIT_COMMITTER_DATE: '@1234567891 -0700'
      }
    });
    const oidOf = (args, input) => git(args, input).toString('ascii').trim();
    git(['init', '-q', `--object-format=${algorithm}`]);
    let parent;
    for (let index = 0; index < 25; index++) {
      const blob = oidOf(['hash-object', '-w', '--stdin'], encoder.encode(`fixture ${index}\0日本語\n${'x'.repeat(index * 71)}`));
      const treeInput = `100755 blob ${blob}\texecutable-${index}\n100644 blob ${blob}\tfile-${index}\n`
        + `120000 blob ${blob}\tlink-${index}\n`;
      const tree = oidOf(['mktree'], treeInput);
      const commit = oidOf(['commit-tree', tree, ...(parent ? ['-p', parent] : [])], `message ${index}\n\nbody Żółć\n`);
      const tag = oidOf(['mktag'], `object ${commit}\ntype commit\ntag fixture-${index}\ntagger ${identity}\n\ntag ${index}\n`);
      parent = commit;
      for (const [type, oid] of [['blob', blob], ['tree', tree], ['commit', commit], ['tag', tag]]) {
        const data = new Uint8Array(git(['cat-file', type, oid]));
        const options = { algorithm, backend: 'portable' };
        let roundtrip = data;
        if (type === 'tree') roundtrip = encodeTree(decodeTree(data, options), options);
        if (type === 'commit') roundtrip = encodeCommit(decodeCommit(data, options), options);
        if (type === 'tag') roundtrip = encodeTag(decodeTag(data, options), options);
        assert.deepEqual(roundtrip, data, `${algorithm}:${type}:${index}`);
        assert.deepEqual(parseObject(serializeObject(type, data)).data, data);
        assert.equal(await hashObject(type, roundtrip, options), oid);
        const objectPath = join(directory, '.git', 'objects', oid.slice(0, 2), oid.slice(2));
        const fromGit = await decodeLooseObject(new Uint8Array(readFileSync(objectPath)), { ...options, oid });
        assert.equal(fromGit.type, type);
        assert.deepEqual(fromGit.data, data);
        replaceFixtureObject(objectPath, await encodeLooseObject(type, data, options));
        assert.deepEqual(new Uint8Array(git(['cat-file', type, oid])), data);
        fixtures++;
      }
    }
    git(['fsck', '--strict', '--no-reflogs']);
  }
  assert.equal(fixtures, 200);
});
