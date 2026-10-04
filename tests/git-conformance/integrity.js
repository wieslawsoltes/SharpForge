import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyRepositoryIntegrity } from '@sharpforge/git';
import { openNodeRepository } from '@sharpforge/git/node';

async function corruptRepository(workspace, kind) {
  const directory = join(workspace.root, `fsck-${kind}`);
  await mkdir(directory);
  const git = (args, options) => workspace.git(args, { cwd: directory, ...options });
  await git(['init', '-q', '--initial-branch=main']);
  const blob = (await git(['hash-object', '-w', '--stdin'], { input: 'fixture blob\n' })).text;
  let tree;
  if (kind === 'missing-object') {
    tree = (await git(['mktree'], { input: `100644 blob ${blob}\tfile.txt\n` })).text;
  } else {
    const entry = Buffer.concat([Buffer.from('100644 file.txt\0'), Buffer.from(blob, 'hex')]);
    tree = (await git(['hash-object', '-t', 'tree', '--literally', '-w', '--stdin'], { input: Buffer.concat([entry, entry]) })).text;
  }
  const commit = (await git(['commit-tree', tree, '-m', 'corrupt fixture'])).text;
  await git(['update-ref', 'refs/heads/main', commit]);
  if (kind === 'missing-object') await unlink(join(directory, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
  return { directory, git };
}

export async function runIntegrityConformance(workspace, report) {
  for (const category of ['missing-object', 'bad-tree']) {
    const fixture = await corruptRepository(workspace, category);
    const reference = await fixture.git(['fsck', '--strict', '--full', '--no-reflogs'], { allowFailure: true });
    const nativeText = `${reference.stdout}\n${reference.stderr}`;
    const nativeDetected = category === 'missing-object' ? /missing (blob|tree|commit|tag)/.test(nativeText)
      : /duplicateEntries|duplicate (file )?entries/i.test(nativeText);
    report.equal('fsck', `native detects ${category}`, nativeDetected, true);
    const descriptor = await openNodeRepository({ directory: fixture.directory });
    try {
      const result = await verifyRepositoryIntegrity(descriptor, { reflogs: false });
      report.equal('fsck', `matching category ${category}`, result.categories[category] > 0, nativeDetected);
      report.equal('fsck', `failure ${category}`, result.ok, false);
    } finally { await descriptor.store.close(); }
  }
}
