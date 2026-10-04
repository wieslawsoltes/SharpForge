import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeIndex, encodeIndex } from '../packages/git/src/index-file.js';
import { IgnoreMatcher } from '../packages/git/src/ignore.js';
import { cleanEol } from '../packages/git/src/eol.js';
import { formatPatch } from '../packages/git/src/diff/patch.js';
import { mergeText } from '../packages/git/src/merge/diff3.js';
import { hashObject } from '../packages/git/src/hash.js';
import { verifySsh } from '../packages/git/src/sign.js';
import { repository, identity } from './a25-workflow-fixtures.js';

const probe = spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 10000 });
const available = probe.status === 0;
const version = probe.stdout?.trim() ?? 'Git unavailable';
const encoder = new TextEncoder();

function git(directory, args, input) {
  try {
    return execFileSync('git', args, { cwd: directory, input, timeout: 20000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C', TZ: 'UTC', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(directory, 'no-global-config'),
        GIT_AUTHOR_NAME: identity.name, GIT_AUTHOR_EMAIL: identity.email, GIT_COMMITTER_NAME: identity.name,
        GIT_COMMITTER_EMAIL: identity.email, GIT_AUTHOR_DATE: `@${identity.timestamp} ${identity.timezone}`,
        GIT_COMMITTER_DATE: `@${identity.timestamp} ${identity.timezone}` }, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    if (error.status === 1 && ['diff', 'merge-file', 'check-ignore'].includes(args[0])) return error.stdout;
    throw error;
  }
}

async function directory(context) {
  const path = await mkdtemp(join(tmpdir(), 'sharpforge-git-workflow-'));
  context.after(() => rm(path, { recursive: true, force: true }));
  git(path, ['init', '-q', '-b', 'main']);
  context.diagnostic(version);
  return path;
}

test('native DIRC v2/v3/v4 fixtures round-trip byte-identically', { skip: !available }, async context => {
  const path = await directory(context);
  await mkdir(join(path, 'nested'));
  for (const name of ['one.txt', 'nested/two.txt', 'nested/three.txt']) await writeFile(join(path, name), `${name}\n`);
  git(path, ['add', '.']);
  git(path, ['update-index', '--chmod=+x', 'one.txt']);
  for (const version of [2, 3, 4]) {
    if (version === 3) git(path, ['update-index', '--skip-worktree', 'nested/two.txt']);
    git(path, ['update-index', `--index-version=${version}`]);
    const bytes = new Uint8Array(await readFile(join(path, '.git/index')));
    const index = await decodeIndex(bytes);
    assert.equal(index.version, version);
    assert.deepEqual(await encodeIndex(index), bytes);
  }
});

test('native add and commit use the same EOL bytes and fixed-identity object ids', { skip: !available }, async context => {
  const path = await directory(context);
  const samples = ['a\nb\n', 'a\r\nb\r\n', 'a\nb\r\n', 'a\rb\r', 'no newline', 'a\0b\r\n'];
  for (const autocrlf of ['true', 'input', 'false']) {
    for (const sample of samples) {
      git(path, ['read-tree', '--empty']);
      await writeFile(join(path, 'file.txt'), sample);
      git(path, ['-c', `core.autocrlf=${autocrlf}`, 'add', '--', 'file.txt']);
      const native = git(path, ['show', ':file.txt']);
      assert.deepEqual(cleanEol(encoder.encode(sample), { autocrlf }), new Uint8Array(native), `${autocrlf} ${JSON.stringify(sample)}`);
    }
  }
  await writeFile(join(path, 'file.txt'), 'fixed content\n');
  git(path, ['read-tree', '--empty']);
  git(path, ['-c', 'core.autocrlf=false', 'add', 'file.txt']);
  git(path, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Subject']);
  const repo = await repository();
  await repo.worktree.write('file.txt', 'fixed content\n');
  await repo.add(['.']);
  const commit = await repo.commit({ message: 'Subject', author: identity, committer: identity });
  assert.equal(commit.oid, git(path, ['rev-parse', 'HEAD']).toString().trim());
});

test('300 native check-ignore decisions cover independent nested source scopes', { skip: !available }, async context => {
  const path = await directory(context);
  const matcher = new IgnoreMatcher();
  const rules = '*.tmp\n/root.log\nbuild/\n!build/keep.txt\ncache/**/data?.[ch]\n\\#literal\n\\!literal\n';
  const relative = ['a.tmp', 'deep/a.tmp', 'src/keep.tmp', 'other/keep.tmp', 'root.log', 'deep/root.log', 'build/a',
    'build/keep.txt', 'cache/data1.c', 'cache/a/b/data2.h', 'cache/data22.c', 'cache/data1.js', '#literal', '!literal',
    'src/local.txt', 'other/local.txt', 'a.txt', 'src/file.tmp', 'readme', 'cache/deep/data9.h'];
  const paths = [];
  for (let index = 0; index < 15; index++) {
    const base = `scope-${index}`;
    await mkdir(join(path, base, 'src'), { recursive: true });
    await writeFile(join(path, base, '.gitignore'), rules);
    await writeFile(join(path, base, 'src', '.gitignore'), '!keep.tmp\nlocal.txt\n');
    matcher.add(rules, { base, source: `${base}/.gitignore` });
    matcher.add('!keep.tmp\nlocal.txt\n', { base: `${base}/src`, source: `${base}/src/.gitignore` });
    paths.push(...relative.map(name => `${base}/${name}`));
  }
  const output = git(path, ['check-ignore', '--stdin', '-z', '-v', '--non-matching', '--no-index'], `${paths.join('\0')}\0`).toString().split('\0');
  assert.equal(paths.length, 300);
  for (let index = 0; index < paths.length; index++) {
    const pattern = output[index * 4 + 2];
    const ignored = !!pattern && !pattern.startsWith('!');
    assert.equal(matcher.test(paths[index]), ignored, paths[index]);
  }
});

test('150 native minimal/histogram patch pairs preserve exact unified output', { skip: !available }, async context => {
  const path = await directory(context);
  for (let fixture = 0; fixture < 150; fixture++) {
    const before = Array.from({ length: 30 }, (_, index) => `  fixture ${fixture} line ${index}\n`);
    const after = before.slice();
    const position = fixture % 25;
    const kind = fixture % 5;
    if (kind === 0) after[position] = `  replacement ${fixture}\n`;
    if (kind === 1) after.splice(position, 0, `  insertion ${fixture}\n`);
    if (kind === 2) after.splice(position, 1);
    if (kind === 3) { after[position] = `  first ${fixture}\n`; after[29] = `  last ${fixture}\n`; }
    if (kind === 4) after[29] = `  no final newline ${fixture}`;
    const oldText = before.join('');
    const newText = after.join('');
    await writeFile(join(path, 'old.txt'), oldText);
    await writeFile(join(path, 'new.txt'), newText);
    const oldOid = await hashObject('blob', encoder.encode(oldText));
    const newOid = await hashObject('blob', encoder.encode(newText));
    for (const algorithm of ['minimal', 'histogram']) {
      const native = git(path, ['diff', '--no-index', '--no-ext-diff', '--no-color', `--${algorithm}`, 'old.txt', 'new.txt']).toString();
      const actual = formatPatch(oldText, newText, { algorithm, oldPath: 'old.txt', newPath: 'new.txt', oldOid, newOid,
        oldMode: 0o100644, newMode: 0o100644 });
      assert.equal(actual, native, `${algorithm} fixture ${fixture}`);
    }
  }
});

test('100 native merge-file text fixtures agree for conflicts and independent edits', { skip: !available }, async context => {
  const path = await directory(context);
  for (let fixture = 0; fixture < 100; fixture++) {
    const base = Array.from({ length: 24 }, (_, index) => `line ${fixture}:${index}\n`);
    const ours = base.slice();
    const theirs = base.slice();
    const left = fixture % 18;
    const right = fixture % 4 === 0 ? left : fixture % 4 === 1 ? left + 1 : fixture % 4 === 2 ? left + 3 : left + 5;
    ours[left] = `ours ${fixture}\n`;
    theirs[right] = `theirs ${fixture}\n`;
    await writeFile(join(path, 'base.txt'), base.join(''));
    await writeFile(join(path, 'ours.txt'), ours.join(''));
    await writeFile(join(path, 'theirs.txt'), theirs.join(''));
    const style = fixture % 2 ? 'diff3' : 'merge';
    const args = ['merge-file', '-p', ...(style === 'diff3' ? ['--diff3'] : []), '-L', 'ours', '-L', 'base', '-L', 'theirs',
      'ours.txt', 'base.txt', 'theirs.txt'];
    const native = git(path, args).toString();
    const actual = mergeText(base.join(''), ours.join(''), theirs.join(''), { style, oursLabel: 'ours', baseLabel: 'base', theirsLabel: 'theirs' });
    assert.equal(actual.text, native, `merge fixture ${fixture}`);
  }
});

test('WebCrypto Ed25519 signed commit verifies with native Git allowed_signers', { skip: !available }, async context => {
  const path = await directory(context);
  const repo = await repository();
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const commit = await repo.commit({ allowEmpty: true, message: 'Signed', author: identity, committer: identity, sign: keys });
  for (const oid of [commit.tree, commit.oid]) {
    const object = await repo.odb.read(oid);
    assert.equal(git(path, ['hash-object', '-w', '-t', object.type, '--stdin'], object.data).toString().trim(), oid);
  }
  const parsed = await repo.readCommit(commit.oid);
  const signature = parsed.headers.find(header => header.key === 'gpgsig').value;
  const checked = await verifySsh(new Uint8Array(), signature);
  await writeFile(join(path, 'allowed_signers'), `${identity.email} ${checked.publicKey}\n`);
  git(path, ['-c', 'gpg.format=ssh', '-c', `gpg.ssh.allowedSignersFile=${join(path, 'allowed_signers')}`, 'verify-commit', commit.oid]);
});
