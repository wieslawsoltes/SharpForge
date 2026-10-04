import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const excludedEvaluationDirectories = new Set(['.git', '.vs', '.sharpforge', '.packages', 'node_modules', 'bin', 'obj']);

/** Directory membership is an evaluation input: a newly added globbed source must invalidate cached Compile items. */
export async function evaluationMembershipInputs(workspace, { maxDirectories = 2048, maxEntries = 100000 } = {}) {
  const directories = [];
  const pending = [workspace.root];
  let entries = 0;
  for (let index = 0; index < pending.length; index++) {
    const directory = pending[index];
    if (directories.length >= maxDirectories) throw new Error('Evaluation directory dependency limit exceeded');
    directories.push(directory);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++entries > maxEntries) throw new Error('Evaluation directory entry limit exceeded');
      if (entry.isDirectory() && !excludedEvaluationDirectories.has(entry.name)) pending.push(resolve(directory, entry.name));
    }
  }
  let directory = dirname(workspace.root);
  for (let depth = 0; depth < 128; depth++) {
    for (const name of ['Directory.Build.props', 'Directory.Build.targets', 'Directory.Packages.props', 'global.json']) {
      directories.push(resolve(directory, name));
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return directories;
}
