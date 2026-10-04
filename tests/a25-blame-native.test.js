import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNodeRepository } from '../packages/git/src/fs/node.js';
import { GitRepository } from '../packages/git/src/repository.js';
import { blame, blameIncremental } from '../packages/git/src/blame.js';

const alpha = 'const alphaValue = calculateAlphaResult();\nreturn transformAlphaResult(alphaValue);\n';
const beta = 'const betaValue = calculateBetaResult();\nreturn transformBetaResult(betaValue);\n';
const plain = 'first unique line\nsecond distinct line\nthird separate line\n';

function lineCase(name, before, after, options = {}, flags = []) {
  return { name, path: 'file.txt', states: [{ 'file.txt': before }, { 'file.txt': after }], options, flags };
}

function nativeCases() {
  const result = [
    lineCase('unchanged', plain, plain),
    lineCase('prepend', plain, `inserted start\n${plain}`),
    lineCase('append', plain, `${plain}inserted end\n`),
    lineCase('insert middle', plain, plain.replace('second', 'inserted middle\nsecond')),
    lineCase('remove first', plain, plain.split('\n').slice(1).join('\n')),
    lineCase('remove middle', plain, plain.replace('second distinct line\n', '')),
    lineCase('remove last', plain, plain.replace('third separate line\n', '')),
    lineCase('replace first', plain, plain.replace('first unique', 'replacement')),
    lineCase('replace middle', plain, plain.replace('second distinct', 'replacement')),
    lineCase('replace last', plain, plain.replace('third separate', 'replacement')),
    lineCase('no final newline', 'first\nlast', 'first\nchanged last'),
    lineCase('add final newline', 'first\nlast', 'first\nlast\n'),
    lineCase('remove final newline', 'first\nlast\n', 'first\nlast'),
    lineCase('empty lines', 'one\ntwo\n', 'one\n\ntwo\n'),
    lineCase('UTF-8 lines', 'zażółć gęślą jaźń\n東京\n', 'zażółć gęślą jaźń\n京都\n'),
    lineCase('CRLF edit', 'one\r\ntwo\r\n', 'one\r\nmodified\r\n'),
    lineCase('whitespace attributed normally', alpha + beta, (alpha + beta).replaceAll(' = ', '=')),
    lineCase('whitespace ignored', alpha + beta, (alpha + beta).replaceAll(' = ', '='), { ignoreWhitespace: true }, ['-w']),
    lineCase('tabs ignored', alpha + beta, (alpha + beta).split('\n').map(line => line ? `\t${line}` : '').join('\n'),
      { ignoreWhitespace: true }, ['-w']),
    lineCase('CRLF ignored', alpha, alpha.replaceAll('\n', '\r\n'), { ignoreWhitespace: true }, ['-w']),
    { name: 'exact rename', path: 'renamed.txt', states: [{ 'old.txt': plain }, { 'renamed.txt': plain }] },
    { name: 'edited rename', path: 'renamed.txt', states: [{ 'old.txt': plain }, { 'renamed.txt': `${plain}appended after rename\n` }] },
    lineCase('move both blocks', alpha + beta, beta + alpha, { detectMoves: true }, ['-M']),
    lineCase('copy within file', alpha + beta, alpha + beta + alpha, { detectMoves: true }, ['-M']),
    lineCase('move below score', 'a\nb\nc\nd\n', 'c\nd\na\nb\n', { detectMoves: true }, ['-M']),
    lineCase('move high threshold', alpha + beta, beta + alpha, { detectMoves: true, moveThreshold: 10000 }, ['-M10000']),
    { name: 'copy modified source', path: 'target.txt', options: { detectCopies: true }, flags: ['-C'],
      states: [{ 'source.txt': alpha, 'target.txt': beta }, { 'source.txt': `${alpha}sourceChanged();\n`, 'target.txt': beta + alpha }] },
    { name: 'copy new file from unchanged source', path: 'target.txt', options: { copyLevel: 2 }, flags: ['-C', '-C'],
      states: [{ 'source.txt': alpha }, { 'source.txt': alpha, 'target.txt': beta + alpha }] },
    { name: 'copy existing file from unchanged source', path: 'target.txt', options: { copyLevel: 3 }, flags: ['-C', '-C', '-C'],
      states: [{ 'source.txt': alpha, 'target.txt': beta }, { 'source.txt': alpha, 'target.txt': beta + alpha }] },
    { ...lineCase('ignore formatting commit', alpha + beta, (alpha + beta).replaceAll(' = ', '=')), ignore: [1] },
    { ...lineCase('ignore added unrelated lines', 'alpha\n', 'alpha\nXYZ\n\n'), ignore: [1] },
    { ...lineCase('ignore split statement', 'const result = calculateValue(alpha, beta);\n',
      'const result = calculateValue(\n  alpha, beta);\n'), ignore: [1] },
    { ...lineCase('ignore moved and edited line', alpha + beta,
      beta + alpha.replace('alphaValue =', 'alphaValue=')), ignore: [1] },
    { name: 'consecutive ignored commits', path: 'file.txt', ignore: [1, 2],
      states: [{ 'file.txt': alpha }, { 'file.txt': alpha.replaceAll(' = ', '=') },
        { 'file.txt': alpha.replaceAll(' = ', '=').split('\n').map(line => line ? `\t${line}` : '').join('\n') }] },
    { name: 'merge parent attribution', path: 'file.txt', parents: [[], [0], [0], [1, 2]],
      states: [{ 'file.txt': 'left\nright\n' }, { 'file.txt': 'changed left\nright\n' },
        { 'file.txt': 'left\nchanged right\n' }, { 'file.txt': 'changed left\nchanged right\n' }] },
    { name: 'merge first-parent attribution', path: 'file.txt', options: { firstParent: true }, flags: ['--first-parent'],
      parents: [[], [0], [0], [1, 2]], states: [{ 'file.txt': 'left\nright\n' }, { 'file.txt': 'changed left\nright\n' },
        { 'file.txt': 'left\nchanged right\n' }, { 'file.txt': 'changed left\nchanged right\n' }] }
  ];
  return result;
}

function gitAt(directory, environment) {
  return (args, input) => execFileSync('git', ['-C', directory, '-c', 'core.quotePath=false', ...args], {
    input, encoding: 'utf8', env: environment, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']
  });
}

function createCommit(git, files, parents, name) {
  const entries = [];
  for (const [path, content] of Object.entries(files)) {
    const oid = git(['hash-object', '-w', '--stdin'], content).trim();
    entries.push({ path, entry: `100644 blob ${oid}\t${path}\0` });
  }
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const tree = git(['mktree', '-z'], entries.map(entry => entry.entry).join('')).trim();
  return git(['commit-tree', tree, ...parents.flatMap(parent => ['-p', parent]), '-m', name]).trim();
}

function parsePorcelain(text) {
  const records = [];
  let current;
  for (const line of text.split('\n')) {
    const header = /^([0-9a-f]{40}|[0-9a-f]{64}) (\d+) (\d+)(?: (\d+))?$/.exec(line);
    if (header) {
      current = { oid: header[1], originalLine: Number(header[2]), finalLine: Number(header[3]), ignored: false, unblamable: false };
    } else if (line.startsWith('filename ')) {
      const filename = line.slice(9);
      current.path = filename.startsWith('"') ? JSON.parse(filename) : filename;
    } else if (line === 'ignored') current.ignored = true;
    else if (line === 'unblamable') current.unblamable = true;
    else if (line.startsWith('\t')) {
      current.text = line.slice(1).replace(/\r$/, '');
      records.push(current);
    }
  }
  return records;
}

function attribution(line) {
  return { oid: line.oid, originalLine: line.originalLine, finalLine: line.finalLine, path: line.path,
    text: line.text, ignored: !!line.ignored, unblamable: !!line.unblamable };
}

test('36 deterministic native Git porcelain fixtures cover blame, renames, moves, copies, ignored revisions and merges', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-blame-native-'));
  let repo;
  try {
    const config = join(directory, 'empty-global-config');
    await writeFile(config, '');
    const environment = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config,
      GIT_AUTHOR_NAME: 'Native Fixture', GIT_AUTHOR_EMAIL: 'native@example.test',
      GIT_COMMITTER_NAME: 'Native Fixture', GIT_COMMITTER_EMAIL: 'native@example.test',
      GIT_AUTHOR_DATE: '1700000000 +0000', GIT_COMMITTER_DATE: '1700000000 +0000' };
    const git = gitAt(directory, environment);
    git(['init', '-b', 'main']);
    t.diagnostic(git(['--version']).trim());
    const cases = nativeCases();
    assert.equal(cases.length, 36);
    const fixtures = [];
    let serial = 0;
    for (const fixture of cases) {
      const commits = [];
      for (let index = 0; index < fixture.states.length; index++) {
        const parents = fixture.parents?.[index]?.map(parent => commits[parent]) ?? (index ? [commits[index - 1]] : []);
        environment.GIT_AUTHOR_DATE = environment.GIT_COMMITTER_DATE = `${1700000000 + serial++} +0000`;
        commits.push(createCommit(git, fixture.states[index], parents, `${fixture.name} ${index}`));
      }
      fixtures.push({ ...fixture, commits });
    }
    git(['update-ref', 'refs/heads/main', fixtures.at(-1).commits.at(-1)]);
    repo = new GitRepository(await openNodeRepository({ directory }));
    for (const fixture of fixtures) {
      await t.test(fixture.name, async () => {
        const revision = fixture.commits.at(-1);
        const options = { ...fixture.options, revision };
        const flags = [...(fixture.flags ?? [])];
        if (fixture.ignore) {
          const path = '.git-blame-ignore-revs';
          const content = `# deterministic formatting fixture\n${fixture.ignore.map(index => fixture.commits[index]).join('\n')}\n`;
          await writeFile(join(directory, path), content);
          options.ignoreRevsFile = path;
          flags.push('--ignore-revs-file', path);
        }
        const expected = parsePorcelain(git(['-c', 'blame.markIgnoredLines=true', '-c', 'blame.markUnblamableLines=true',
          'blame', '--line-porcelain', ...flags, revision, '--', fixture.path]));
        const actual = await blame(repo, fixture.path, options);
        assert.deepEqual(actual.map(attribution), expected);
        const incremental = [];
        for await (const chunk of blameIncremental(repo, fixture.path, options)) {
          assert.equal(chunk.lineCount, chunk.lines.length);
          for (const line of chunk.lines) incremental.push(line);
        }
        incremental.sort((left, right) => left.finalLine - right.finalLine);
        assert.deepEqual(incremental.map(attribution), expected);
      });
    }
  } finally {
    await repo?.odb.close();
    await rm(directory, { recursive: true, force: true });
  }
});
