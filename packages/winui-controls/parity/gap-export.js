import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 20);

/** Existing tracked gap IDs are retained; supplements receive stable content-derived identities. */
export function exportGapRecords(rows) {
  const gaps = new Map();
  for (const row of rows) {
    if (row.api === 'present') continue;
    const gapId = row.gapId ?? `GAP-A16-API-${digest(row.key)}`;
    if (gaps.has(gapId) && gaps.get(gapId).referenceKey !== row.key) {
      throw new Error('A gap ID identifies multiple missing members: ' + gapId);
    }
    gaps.set(gapId, { gapId, referenceKey: row.key, owner: row.owner, name: row.name, signature: row.signature,
      api: row.api, behavior: row.behavior, leafId: row.leafId ?? null,
      status: 'open', reason: row.reason, candidateContractIds: row.candidateContractIds });
  }
  return [...gaps.values()].sort((left, right) => left.gapId.localeCompare(right.gapId, 'en'));
}

export function assertNoCoverageRegression(previous, current) {
  const rows = new Map(current.rows.map(row => [row.key, row]));
  for (const row of previous.rows) {
    const next = rows.get(row.key);
    if (!next) throw new Error('Reference denominator decreased: ' + row.key);
    const present = row.api === 'present' || row.status === 'implemented';
    if (present && next.api !== 'present') throw new Error('Registered signature coverage decreased: ' + row.key);
    if (row.behavior === 'verified' && next.behavior !== 'verified') throw new Error('Behavior evidence decreased: ' + row.key);
  }
}
