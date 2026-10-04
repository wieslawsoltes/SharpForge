import { GitRepository } from '@sharpforge/git';
import { openNodeRepository } from '@sharpforge/git/node';
import { historyFixture } from './fixture.js';

function blameRecords(text) {
  const records = [];
  let pending;
  for (const line of text.split('\n')) {
    const header = /^([0-9a-f]{40,64}) ([0-9]+) ([0-9]+)(?: [0-9]+)?$/.exec(line);
    if (header) pending = { oid: header[1], originalLine: Number(header[2]), finalLine: Number(header[3]) };
    else if (line.startsWith('\t')) { records.push({ ...pending, text: line.slice(1) }); pending = undefined; }
  }
  return records;
}

function scalarExpressions(fixture) {
  const names = ['HEAD', '@', 'main', 'refs/heads/main', 'base', 'refs/tags/base', 'side', 'refs/heads/side', 'origin/main'];
  const typed = ['HEAD^{commit}', 'HEAD^{tree}', 'HEAD^{object}', 'v1', 'v1^{}', 'v1^0', 'v1^{commit}', 'v1^{tree}', 'v1^{tag}'];
  const parents = ['HEAD^', 'HEAD^1', 'HEAD^0', 'HEAD^^', 'HEAD~2^', 'HEAD~3^2', 'HEAD~3^2^', 'v1^1', 'v1^2'];
  const ancestors = Array.from({ length: 7 }, (_, index) => `HEAD~${index}`);
  const reflogs = ['HEAD@{0}', 'HEAD@{1}', 'HEAD@{5}', 'main@{0}', 'main@{1}', 'main@{2}', '@{0}', '@{upstream}', 'main@{u}', 'main@{push}'];
  const paths = fixture.paths.slice(1, 11).flatMap(path => [`HEAD:${path}`, `:${path}`]);
  return [...names, ...typed, ...parents, ...ancestors, ...reflogs, ...paths, fixture.head, fixture.head.slice(0, 12), 'HEAD:'];
}

async function revisions(repo, fixture, report) {
  for (const expression of scalarExpressions(fixture)) {
    const expected = (await fixture.git(['rev-parse', '--verify', expression])).text;
    report.equal('rev-parse', `${fixture.algorithm} ${expression}`, await repo.revParse(expression), expected);
  }
  for (const expression of ['base..HEAD', 'side...HEAD', 'HEAD^!', 'HEAD^@', 'HEAD^-', 'v1^-2', '^side']) {
    const value = await repo.revParse(expression);
    const actual = [...value.include, ...value.exclude.map(oid => `^${oid}`)].sort();
    const expected = (await fixture.git(['rev-parse', expression])).text.split('\n').sort();
    report.equal('rev-parse', `${fixture.algorithm} ${expression}`, actual, expected);
  }
}

async function histories(repo, fixture, report) {
  for (const path of fixture.paths) {
    const native = await fixture.git(['blame', '--line-porcelain', 'HEAD', '--', path]);
    const actual = (await repo.blame(path, { revision: 'HEAD' })).map(({ oid, originalLine, finalLine, text }) => ({
      oid, originalLine, finalLine, text
    }));
    report.equal('blame', `${fixture.algorithm} ${path}`, actual, blameRecords(native.text));
  }
  const whitespacePath = fixture.paths[7];
  report.equal('blame', `${fixture.algorithm} ignore whitespace`,
    (await repo.blame(whitespacePath, { ignoreWhitespace: true })).map(line => line.oid),
    blameRecords((await fixture.git(['blame', '-w', '--line-porcelain', '--', whitespacePath])).text).map(line => line.oid));
  const scenarios = [
    { options: {}, flags: ['--topo-order'] },
    { options: { firstParent: true }, flags: ['--first-parent', '--topo-order'] },
    { options: { reverse: true }, flags: ['--reverse', '--topo-order'] },
    { options: { maxCount: 3, skip: 1 }, flags: ['--max-count=3', '--skip=1', '--topo-order'] },
    { options: { search: 'addition' }, flags: ['--grep=addition', '--topo-order'] },
    { options: { path: fixture.paths[0], follow: true }, flags: ['--follow', '--topo-order'], path: fixture.paths[0] }
  ];
  for (const { options, flags, path } of scenarios) {
    const expected = (await fixture.git(['log', '--format=%H', ...flags, 'HEAD', ...(path ? ['--', path] : [])])).text;
    report.equal('log', `${fixture.algorithm} ${flags.join(' ')}`, (await repo.log(options)).map(commit => commit.oid),
      expected ? expected.split('\n') : []);
  }
}

export async function runHistoryConformance(workspace, report, algorithm = 'sha1') {
  const fixture = await historyFixture(workspace, algorithm);
  const descriptor = await openNodeRepository({ directory: fixture.directory });
  const repo = new GitRepository(descriptor);
  try {
    await repo.init();
    await revisions(repo, fixture, report);
    await histories(repo, fixture, report);
  } finally {
    repo.dispose();
    repo.history?.dispose();
    await descriptor.store.close();
  }
}
