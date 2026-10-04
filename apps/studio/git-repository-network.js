import { GitError, checkCancelled, exactOrigin } from '@sharpforge/git';
import { runRepositoryTool } from './git-repository-tool-actions.js';

async function allowConnection(workbench, remoteId, origin, options, confirm) {
  const model = workbench.preferences.model;
  if (model.grants.list(remoteId).includes(origin)) return false;
  if (!confirm(`Allow this repository's LFS download to connect to ${origin}?`)) {
    throw new GitError('Cancelled', 'LFS connection grant cancelled.');
  }
  const origins = [...new Set([...model.grants.list(remoteId), origin])];
  await workbench.preferences.auth('grant', { remoteId, origins, consent: true }, options);
  model.grants.grant(remoteId, origins);
  model.update({});
  return true;
}

/** Connection and action-credential grants are separate, exact and bounded to this one user-initiated download. */
async function fetchWithLfsConsent(workbench, params, options, confirm) {
  const actionOrigins = new Set();
  const reviewed = new Set();
  for (let attempt = 0; attempt < 9; attempt++) {
    checkCancelled(options.signal);
    try {
      return await workbench.request('lfsFetch', { ...params,
        ...(actionOrigins.size ? { lfsActionOrigins: [...actionOrigins], lfsActionConsent: true } : {}) }, options);
    } catch (error) {
      if (!['Auth', 'Unsafe'].includes(error.code) || typeof error.details?.origin !== 'string') throw error;
      const origin = exactOrigin(error.details.origin);
      const action = error.details.purpose === 'git-lfs-action-credentials' && error.details.credentials === true;
      const key = `${action ? 'credential' : 'connection'}:${origin}`;
      if (reviewed.has(key)) throw error;
      reviewed.add(key);
      if (!action) {
        if (!await allowConnection(workbench, params.remoteId, origin, options, confirm)) throw error;
      } else {
        if (!confirm(`Allow server-provided LFS action credentials to be sent to ${origin} for this download?`)) {
          throw new GitError('Cancelled', 'LFS action credential grant cancelled.');
        }
        actionOrigins.add(origin);
      }
    }
  }
  throw new GitError('Limit', 'LFS download requested too many separate grants.');
}

export function downloadRepositoryLfs(workbench, file, remote, { signal, confirm = globalThis.confirm } = {}) {
  if (!remote?.url) throw new GitError('NotFound', 'Add or select a Git remote before downloading LFS content.');
  return runRepositoryTool(workbench, { title: `Download LFS: ${file.path}`, signal, adopt: true,
    action: async options => {
      const paths = [`:(literal)${file.path}`];
      const current = await workbench.request('lfsStatus', { paths }, options);
      const pointer = current.find(item => item.path === file.path);
      if (!pointer || pointer.oid !== file.oid || pointer.size !== file.size) {
        throw new GitError('Conflict', 'The LFS pointer changed. Refresh Repository Tools before downloading.');
      }
      const parameters = await workbench.preferences.networkParameters(remote);
      return fetchWithLfsConsent(workbench, { ...parameters, paths, materialize: true, force: false }, options, confirm);
    },
    describe: result => ({ ok: result.every(item => item.state === 'ready'),
      summary: result.every(item => item.state === 'ready') ? 'Verified LFS content is available.' : 'The LFS server did not provide this content.',
      details: result.map(({ path, oid, size, state }) => ({ path, oid, size, state })) })
  });
}

/** Bind submodule consent to the displayed path, resolved URL and pinned commit, then grant its remote independently. */
export function initializeRepositorySubmodule(workbench, module, { signal, confirm = globalThis.confirm } = {}) {
  if (!module.oid) throw new GitError('NotFound', 'This submodule has no pinned Git commit.');
  return runRepositoryTool(workbench, { title: `Initialize submodule: ${module.path}`, signal, adopt: true,
    action: async options => {
      const current = (await workbench.request('submodules', {}, options)).find(item => item.path === module.path);
      if (!current || current.url !== module.url || current.oid !== module.oid) {
        throw new GitError('Conflict', 'The submodule definition changed. Refresh Repository Tools before initializing.');
      }
      if (!confirm(`Initialize this submodule?\n\nPath: ${current.path}\nURL: ${current.url}\nPinned commit: ${current.oid}`)) {
        throw new GitError('Cancelled', 'Submodule initialization cancelled.');
      }
      const parameters = await workbench.preferences.networkParameters({ name: 'origin', url: current.url });
      return workbench.request('initializeSubmodules', { ...parameters, paths: [current.path], recursive: false,
        trustedSubmodules: [{ path: current.path, url: current.url, oid: current.oid }] }, options);
    },
    describe: result => ({ ok: result.every(item => item.state === 'initialized'),
      summary: result.every(item => item.state === 'initialized') ? 'Submodule checked out at its pinned commit.' : 'Submodule remains uninitialized.',
      details: result.map(({ path, url, oid, state, reason }) => ({ path, url, oid, state, reason })) })
  });
}
