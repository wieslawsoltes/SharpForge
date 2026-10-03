import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { isMain, boundedRead } from '../supply/files.js';
import { git } from '../repro/common.js';
import { repository, policyJSON, sha256, languageInventory } from './data.js';
import { github } from './github.js';
import { requireReview } from './review.js';

const bootstrap = '1b1a85d1d26f9e13c8d2bbbb8dbe034fa58a97b8';
const paths = [
  'planning/contracts/spec-revisions.json',
  'planning/contracts/versions.json',
  'planning/contracts/framework-ids.lock.json',
  'planning/contracts/bytecode-ids.lock.json',
  'planning/qualification/oracle-toolchain.json',
];

export function immutableRevisions(before, after) {
  if (before.schemaVersion !== 1 || after.schemaVersion !== 1 || !Array.isArray(after.revisions)) {
    throw new Error('Malformed specification revision registry');
  }
  const current = new Map();
  for (const row of after.revisions) {
    if (!row.id || current.has(row.id)) throw new Error('Duplicate specification revision');
    current.set(row.id, row);
  }
  for (const row of before.revisions) {
    if (JSON.stringify(current.get(row.id)) !== JSON.stringify(row)) {
      throw new Error('Existing specification identity is immutable: ' + row.id);
    }
  }
}

/** Changed pins require an exact merged and approved PR; known identities cannot be repurposed at all. */
export async function checkPolicy({ root = repository, api, repositoryName, signal } = {}) {
  const lock = await policyJSON('inputs.json', { root, signal });
  if (lock.schemaVersion !== 1 || lock.baselineCommit !== bootstrap
      || JSON.stringify(lock.inputs?.map((row) => row.path)) !== JSON.stringify(paths)) {
    throw new Error('Policy baseline or contract input membership changed');
  }
  const changes = [];
  for (const entry of lock.inputs) {
    signal?.throwIfAborted();
    const bytes = await boundedRead(resolve(root, entry.path), { root, signal });
    const baseline = await git(root, ['show', `${bootstrap}:${entry.path}`], { signal });
    const previous = JSON.parse(baseline);
    const actual = sha256(bytes);
    if (actual !== entry.sha256) throw new Error('Policy pin changed without an explicit record: ' + entry.path);
    if (entry.path.endsWith('spec-revisions.json')) immutableRevisions(previous, JSON.parse(bytes));
    // Git helper trims its text output; compare semantic JSON for the frozen baseline.
    const before = sha256(JSON.stringify(previous));
    if (sha256(JSON.stringify(JSON.parse(bytes))) !== before) changes.push({ path: entry.path, before, after: actual });
  }
  const inventory = await languageInventory({ root, signal });
  const changeDigest = sha256(JSON.stringify(changes));
  let approval = null;
  if (changes.length) {
    const reviews = await policyJSON('reviews.json', { root, signal });
    const matches = reviews.requests?.filter((item) => item.changeDigest === changeDigest) ?? [];
    if (reviews.schemaVersion !== 1 || matches.length !== 1 || !api) throw new Error('Specification changes need explicit remote review');
    approval = await requireReview({ api, repository: repositoryName, request: matches[0], changes, signal });
  }
  return {
    schemaVersion: 1, gate: 'release-policy', changes, changeDigest, approval,
    previewFeatures: inventory.rows.map((row) => ({ id: row.id, specRevision: row.specRevision, qualification: 'unknown' })),
    scope: 'Policy pins and approval only; no capability or execution target is promoted',
  };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: 'string' } } });
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  console.log(JSON.stringify(await checkPolicy({
    ...values, api: github({ signal: controller.signal }), repositoryName: process.env.GITHUB_REPOSITORY,
    signal: controller.signal,
  }), null, 2));
}
