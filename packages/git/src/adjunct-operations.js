import { GitError, checkLimit } from './errors.js';
import { verifyRepositoryIntegrity } from './integrity.js';
import { repositoryStorageUsage, repackRepository, gcRepository } from './maintenance.js';
import { exportTreeZip, importBundle } from './archive.js';
import { localObjectDatabase } from './adjunct/promisor.js';
import { importWorktreeZip, exportRepositoryBundle } from './adjunct/offline.js';
import { sparseCheckoutStatus, setRepositorySparseCheckout } from './adjunct/sparse.js';
import { repositoryLfsStatus, fetchRepositoryLfs } from './adjunct/lfs.js';
import { repositorySubmodules, initializeRepositorySubmodules } from './adjunct/submodules.js';
import { sanitizeGitExportFiles } from './redact-artifacts.js';
import { SecretRedactor } from './redact.js';

const maximumImportBytes = 64 * 1024 * 1024;

function importBytes(params) {
  if (!(params.bytes instanceof Uint8Array)) throw new GitError('Corrupt', 'Archive import requires a byte array');
  checkLimit(params.bytes.byteLength, maximumImportBytes, 'Archive import bytes');
  return params.bytes;
}

function localOptions(repo, params, context) {
  return { ...params, ...context, odb: localObjectDatabase(repo.odb), refs: repo.refs, config: repo.config,
    index: repo.index, store: repo.store, algorithm: repo.algorithm };
}

async function maintainRepository(repo, params, context, action) {
  await repo.loadIndex(context);
  const result = await action(localOptions(repo, params, context));
  repo.replaceObjectDatabase(repo.odb);
  return result;
}

/** Bounded offline/maintenance descriptors use the service queue; remote adjuncts share current credential checks. */
export function createAdjunctOperations({ remoteAccess, submodules = {}, redactor = new SecretRedactor() } = {}) {
  return [
    { name: 'policyNotices', run: repo => [...repo.policy.reported].map(setting => ({
      code: 'GitPolicyIgnored', setting, message: 'Repository executable setting is ignored'
    })) },
    { name: 'fsck', run: (repo, params, context) => verifyRepositoryIntegrity(repo, { ...params, ...context }) },
    { name: 'storageUsage', run: (repo, params, context) => repositoryStorageUsage(localOptions(repo, params, context)) },
    { name: 'repack', mutates: true, run: (repo, params, context) =>
      maintainRepository(repo, { prune: false, ...params }, context, repackRepository) },
    { name: 'gc', mutates: true, run: (repo, params, context) => maintainRepository(repo, params, context, gcRepository) },
    { name: 'exportZip', async run(repo, params, context) {
      const oid = await repo.revParse(params.revision ?? 'HEAD', context);
      if (typeof oid !== 'string') throw new GitError('Corrupt', 'ZIP export requires a scalar revision');
      const result = await exportTreeZip({ ...localOptions(repo, params, context), oid,
        sanitizeFiles: files => sanitizeGitExportFiles(files.map(file => file.directory ? { ...file, bytes: new Uint8Array() } : file), redactor) });
      return { ...result, entries: result.entries.map(entry => redactor.value(entry)) };
    } },
    { name: 'importZip', mutates: true, run: (repo, params, context) => importWorktreeZip(repo, importBytes(params), { ...params, ...context }) },
    { name: 'exportBundle', async run(repo, params, context) {
      const result = await exportRepositoryBundle(repo, { ...params, ...context, assertSafeObject: bytes => redactor.assertSafeBytes(bytes) });
      redactor.assertSafeBytes(result.bytes);
      return result;
    } },
    { name: 'importBundle', mutates: true, async run(repo, params, context) {
      const result = await importBundle(importBytes(params), localOptions(repo, params, context));
      repo.replaceObjectDatabase(repo.odb);
      return { version: result.version, algorithm: result.algorithm, refs: result.refs, prerequisites: result.prerequisites,
        pack: { checksum: result.pack.checksum, count: result.pack.count, bytes: result.pack.bytes } };
    } },
    { name: 'sparseCheckout', run: (repo, params, context) => sparseCheckoutStatus(repo, { ...params, ...context }) },
    { name: 'configureSparseCheckout', mutates: true,
      run: (repo, params, context) => setRepositorySparseCheckout(repo, { ...params, ...context }) },
    { name: 'lfsStatus', run: (repo, params, context) => repositoryLfsStatus(repo, { ...params, ...context }) },
    { name: 'lfsFetch', mutates: true, async run(repo, params, context) {
      if (!remoteAccess) throw new GitError('Auth', 'LFS download requires an authorized remote connection');
      const prepared = await remoteAccess.prepare(repo, params, context);
      try { return await fetchRepositoryLfs(repo, prepared.options); }
      finally { prepared.dispose(); }
    } },
    { name: 'submodules', run: (repo, params, context) => repositorySubmodules(repo, { ...params, ...context }) },
    { name: 'initializeSubmodules', mutates: true, async run(repo, params, context) {
      const connections = [];
      try {
        return await initializeRepositorySubmodules(repo, params, context, {
          createRepository: submodules.createRepository,
          transportFor: async (module, options) => {
            if (!remoteAccess) throw new GitError('Auth', 'Submodule initialization requires an authorized remote connection');
            const prepared = await remoteAccess.prepare(repo, { ...options, url: module.url,
              credentialId: params.credentialsByPath?.[module.path] ?? params.credentialId }, context);
            connections.push(prepared);
            return prepared.options.transport;
          }
        });
      } finally { for (const connection of connections) connection.dispose(); }
    } }
  ];
}
