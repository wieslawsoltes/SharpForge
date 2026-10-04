import { GitError, checkLimit } from '../errors.js';
import { PromisorDatabase, validateFilter } from '../promisor.js';
import { validateRemoteUrl } from '../transport/http.js';

/** Stored promisor metadata is a locator, never an authorization grant or credential container. */
export async function readPromisorDescription(store, options = {}) {
  const bytes = await store.get('sharpforge/promisor', options);
  if (!bytes) return null;
  checkLimit(bytes.length, 16384, 'Promisor metadata');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new GitError('Corrupt', 'Invalid promisor metadata'); }
  if (!value || typeof value !== 'object') throw new GitError('Corrupt', 'Invalid promisor description');
  const url = validateRemoteUrl(value.url, options).href;
  const filter = validateFilter(value.filter);
  return { url, filter, algorithm: value.algorithm };
}

export function localObjectDatabase(odb) {
  return odb instanceof PromisorDatabase ? odb.odb : odb;
}

/** Attach lazy loading through the repository's explicit dependency replacement seam. */
export function attachPromisorDatabase(repo, description, fetchObjects) {
  if (description.algorithm && description.algorithm !== repo.algorithm) throw new GitError('Corrupt', 'Promisor object format does not match the repository');
  const local = localObjectDatabase(repo.odb);
  const previous = repo.odb;
  const database = new PromisorDatabase({
    odb: local, algorithm: repo.algorithm, filter: description.filter,
    fetchObjects: async (oids, context) => {
      if (!fetchObjects) throw new GitError('Auth', 'Missing Git objects require an explicitly authorized promisor connection');
      return fetchObjects({ repository: repo, oids, ...context, remote: description });
    }
  });
  repo.replaceObjectDatabase(database);
  if (previous instanceof PromisorDatabase) previous.dispose();
  return database;
}
