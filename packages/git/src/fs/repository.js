import { GitError } from '../errors.js';
import { GitConfig } from '../config.js';
import { RefDatabase, validateRefName } from '../refs.js';
import { encodeStorageText } from '../storage/store-contract.js';
import { detectObjectFormat } from '../object-format.js';

/** Initialize only native Git metadata; existing repositories require an explicit open. */
export async function initializeRepositoryStore(store, { algorithm = 'sha1', defaultBranch = 'main', bare = false, filemode = false,
  signal } = {}) {
  if (!['sha1', 'sha256'].includes(algorithm)) throw new GitError('Unsupported', 'Unsupported Git object format', { algorithm });
  validateRefName(defaultBranch, { allowOneLevel: true, branch: true });
  const ref = validateRefName(`refs/heads/${defaultBranch}`);
  const config = new GitConfig({ store });
  config.set('core.repositoryformatversion', algorithm === 'sha256' ? 1 : 0);
  config.set('core.filemode', filemode);
  config.set('core.bare', bare);
  config.set('core.logallrefupdates', !bare);
  if (algorithm === 'sha256') config.set('extensions.objectformat', 'sha256');
  await store.transaction(async tx => {
    if (await tx.get('HEAD') !== undefined || await tx.get('config') !== undefined) {
      throw new GitError('Conflict', 'The directory already contains Git repository metadata');
    }
    await tx.set('HEAD', encodeStorageText(`ref: ${ref}\n`));
    await tx.set('config', encodeStorageText(config.toString()));
    await tx.set('description', encodeStorageText('SharpForge Git repository\n'));
  }, { signal });
}

export async function readRepositoryMetadata(store, { signal } = {}) {
  const config = await new GitConfig({ store }).load({ signal });
  if (!config.loaded || await store.get('HEAD', { signal }) === undefined) throw new GitError('NotFound', 'The directory is not a Git repository');
  const algorithm = detectObjectFormat(config).name;
  for (const { key, value } of config.entries()) {
    if (!key.startsWith('extensions.') || key === 'extensions.objectformat' || key === 'extensions.worktreeconfig') continue;
    throw new GitError('Unsupported', 'Repository requires an unsupported Git extension', { key, value });
  }
  if (config.getBoolean('extensions.worktreeconfig', false)) {
    throw new GitError('Unsupported', 'Per-worktree Git configuration requires an explicitly resolved common directory');
  }
  return { config, algorithm, refs: new RefDatabase({ store, algorithm }) };
}
