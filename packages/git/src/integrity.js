import { GitError, checkCancelled, checkLimit } from './errors.js';
import { getObjectFormat, detectObjectFormat } from './object-format.js';
import { createPackReader } from './pack/accessor.js';
import { parseShallow } from './shallow.js';
import { IntegrityReport, IntegrityCategory } from './integrity/report.js';
import { integrityRoots, normalizeReferenceError } from './integrity/refs.js';
import { scanIntegrityObjects } from './integrity/objects.js';
import { verifyIntegrityGraph } from './integrity/graph.js';

export { IntegrityCategory } from './integrity/report.js';

/** Read-only repository fsck: object integrity, connectivity, types, refs, index, packs and cycles. */
export async function verifyRepositoryIntegrity(repository, options = {}) {
  if (!repository?.odb || !repository?.refs) throw new TypeError('Integrity verification needs an object and reference database');
  checkCancelled(options.signal);
  const algorithm = getObjectFormat(repository.algorithm ?? repository.odb.algorithm).name;
  const subject = { ...repository, algorithm, store: repository.store ?? repository.odb.store };
  const report = new IntegrityReport(algorithm, options);
  if (options.shallow === undefined && subject.store?.get) {
    try {
      const bytes = await subject.store.get('shallow', options);
      options = { ...options, shallow: parseShallow(bytes, { algorithm }) };
    } catch (error) { report.capture(error, IntegrityCategory.InvalidObject, { ref: 'shallow' }); }
  }
  if (subject.config) {
    try {
      const configured = detectObjectFormat(subject.config);
      if (configured.name !== algorithm) report.add(IntegrityCategory.InvalidObject, 'Repository configuration and object database formats differ', {
        configured: configured.name, algorithm
      });
    } catch (error) { report.capture(error, IntegrityCategory.InvalidObject); }
  }
  const packIds = options.verifyPacks === false ? [] : await verifyPacks(subject, report, options);
  let roots;
  try { roots = await integrityRoots(subject, report, options); }
  catch (error) {
    report.capture(normalizeReferenceError(error), IntegrityCategory.BadRef);
    roots = [];
  }
  let ids = roots.map(root => root.oid);
  if (options.full !== false) {
    const stored = await subject.odb.list({ ...options, includeAlternates: !!options.includeAlternates });
    checkLimit(stored.length, options.maxObjects ?? 1_000_000, 'Integrity stored object count');
    ids = [...new Set([...ids, ...stored])];
  }
  const scanned = await scanIntegrityObjects(subject, ids, report, options);
  const graph = verifyIntegrityGraph(scanned.nodes, roots, report, options);
  return report.finish({
    objects: [...scanned.nodes.values()].filter(Boolean).length,
    bytes: scanned.bytes, edges: scanned.edges, externalLinks: scanned.externalLinks,
    roots: roots.length, packs: packIds.length, ...graph
  });
}

async function verifyPacks(repository, report, options) {
  const store = repository.store;
  if (!store?.listPacks || !store?.readPack) return [];
  const ids = await store.listPacks(options);
  checkLimit(ids.length, options.maxPacks ?? 10_000, 'Integrity pack count');
  for (const id of ids) {
    checkCancelled(options.signal);
    try {
      const stored = await store.readPack(id, options);
      await createPackReader({ ...stored, algorithm: repository.algorithm, odb: repository.odb, ...options });
    } catch (error) {
      if (!(error instanceof GitError)) throw error;
      report.capture(error, IntegrityCategory.BadPack, { pack: id });
    }
  }
  return ids;
}

export const fsck = verifyRepositoryIntegrity;
