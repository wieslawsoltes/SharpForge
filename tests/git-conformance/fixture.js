import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';

function lines(index) {
  return [`file ${index} header`, `stable alpha ${index}`, `stable beta ${index}`, `tail ${index}`];
}

/** Thirty histories include edits, a merge, a rename, whitespace and unchanged-line attribution. */
export async function historyFixture(workspace, algorithm = 'sha1') {
  const directory = join(workspace.root, `history-${algorithm}`);
  await mkdir(directory);
  const git = (args, options) => workspace.git(args, { cwd: directory, ...options });
  await git(['init', '-q', '--initial-branch=main', `--object-format=${algorithm}`]);
  const contents = new Map();
  const paths = [];
  for (let index = 0; index < 30; index++) {
    const path = `text/file-${String(index).padStart(2, '0')}.txt`;
    contents.set(path, lines(index));
    paths.push(path);
  }
  const commit = async (message, sequence) => {
    for (const [path, value] of contents) await workspace.write(directory, path, `${value.join('\n')}\n`);
    await git(['add', '-A']);
    await git(['commit', '-q', '-m', message], {
      env: { GIT_AUTHOR_DATE: `${1700000000 + sequence * 60} +0000`, GIT_COMMITTER_DATE: `${1700000000 + sequence * 60} +0000` }
    });
    return (await git(['rev-parse', 'HEAD'])).text;
  };
  const base = await commit('base thirty files', 0);
  await git(['tag', 'base']);
  await git(['branch', 'side', base]);
  for (let index = 0; index < paths.length; index += 2) contents.get(paths[index])[1] = `edited alpha ${index}`;
  await commit('edit even files', 1);
  for (let index = 0; index < paths.length; index += 3) contents.get(paths[index]).push(`main addition ${index}`);
  await commit('main additions', 2);
  await git(['switch', '-q', 'side']);
  await workspace.write(directory, 'side.txt', 'side branch content\n');
  await git(['add', 'side.txt']);
  await git(['commit', '-q', '-m', 'side addition'], {
    env: { GIT_AUTHOR_DATE: '1700000180 +0000', GIT_COMMITTER_DATE: '1700000180 +0000' }
  });
  await git(['switch', '-q', 'main']);
  await git(['merge', '-q', '--no-ff', 'side', '-m', 'merge side'], {
    env: { GIT_AUTHOR_DATE: '1700000240 +0000', GIT_COMMITTER_DATE: '1700000240 +0000' }
  });
  await git(['tag', '-a', 'v1', '-m', 'annotated fixture tag']);
  const previous = paths[0];
  paths[0] = 'text/renamed-00.txt';
  contents.set(paths[0], contents.get(previous));
  contents.delete(previous);
  await rename(join(directory, previous), join(directory, paths[0]));
  await commit('rename first file', 5);
  contents.get(paths[7])[1] = `  ${contents.get(paths[7])[1]}  `;
  await commit('whitespace edit', 6);
  contents.get(paths[3]).push('last line');
  const head = await commit('final line', 7);
  await git(['update-ref', 'refs/remotes/origin/main', head]);
  await git(['config', 'branch.main.remote', 'origin']);
  await git(['config', 'branch.main.merge', 'refs/heads/main']);
  await git(['config', 'remote.origin.url', 'https://fixture.invalid/repository.git']);
  await git(['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
  return { directory, git, paths, base, head, algorithm };
}
