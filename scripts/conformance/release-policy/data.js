import { resolve } from 'node:path';
import { boundedRead, localPath, readJSON, repository, sha256 } from '../supply/files.js';

export const policyDirectory = 'planning/qualification/release-policy/';
export { repository, sha256 };

export async function policyJSON(name, { root = repository, signal } = {}) {
  return readJSON(localPath(root, policyDirectory + name), { root, signal });
}

export async function languageInventory({ root = repository, signal } = {}) {
  const inventory = await policyJSON('language-features.json', { root, signal });
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.rows) || !inventory.rows.length
      || inventory.rows.length > 1000 || !/^[a-f0-9]{40}$/.test(inventory.source?.commit ?? '')
      || !/^[a-f0-9]{64}$/.test(inventory.source?.sha256 ?? '')) throw new Error('Invalid language inventory');
  const registry = await readJSON(resolve(root, 'planning/contracts/spec-revisions.json'), { root, signal });
  const revisions = new Map(registry.revisions.map((row) => [row.id, row]));
  const seen = new Set();
  for (const row of inventory.rows) {
    signal?.throwIfAborted();
    if (!row.id || seen.has(row.id) || row.preview !== true || typeof row.supportedProfile !== 'boolean'
        || !row.specRevision.includes('preview') || !revisions.has(row.specRevision)
        || row.referenceQualification !== 'unknown') throw new Error('Invalid or promoted preview row: ' + row.id);
    seen.add(row.id);
    const bytes = await boundedRead(localPath(root, row.probe), { root, signal });
    if (sha256(bytes) !== row.probeSHA256) throw new Error('Preview probe changed without review: ' + row.id);
  }
  try {
    const shared = await readJSON(resolve(root, inventory.source.path), { root, signal });
    verifyPreviewCoverage(shared.rows, inventory.rows);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // The policy stack can precede T03. Its exact published projection remains
    // pinned until the shared inventory lands; absent data is not parity evidence.
  }
  return inventory;
}

export function verifyPreviewCoverage(rows, projected) {
  if (!Array.isArray(rows)) throw new Error('Malformed shared language feature inventory');
  const previews = rows.filter((row) => row.langVersion === 'preview' || row.preview === true);
  const selected = new Map(projected.map((row) => [row.id, row]));
  if (previews.length !== selected.size) throw new Error('Preview inventory membership changed; explicit policy review required');
  for (const row of previews) {
    const expected = selected.get(row.id);
    if (!expected || expected.probeSHA256 !== row.probeSHA256 || expected.specRevision !== row.specRevision) {
      throw new Error('Preview specification or probe changed; explicit policy review required: ' + row.id);
    }
  }
}

/** Opt-in permits testing a proposal. It never establishes implementation or parity. */
export function previewAdmission(feature, langVersion) {
  if (!feature || feature.preview !== true || !feature.specRevision?.includes('preview')) {
    throw new Error('Expected an explicit preview inventory row');
  }
  const accepted = typeof langVersion === 'string' && langVersion.toLowerCase() === 'preview';
  return {
    accepted,
    diagnostic: accepted ? null : 'CS8652',
    specRevision: feature.specRevision,
    qualification: 'unknown',
    implementation: feature.supportedProfile ? 'selected-profile' : 'unsupported',
  };
}
