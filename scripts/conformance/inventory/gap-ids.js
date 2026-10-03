/** Stable reference identity, never its position in a sorted/generated inventory. */
export function assignGapIds(rows, previous = { schemaVersion: 1, entries: [] }, revision = 'initial') {
  if (previous.schemaVersion !== 1 || !Array.isArray(previous.entries) || !revision) throw new Error('Invalid gap ledger');
  const entries = structuredClone(previous.entries);
  const byKey = new Map(), ids = new Set(), maxima = new Map();
  for (const entry of entries) {
    const match = /^GAP-([A-Z][A-Z0-9]*)-([0-9]{4,})$/.exec(entry.id);
    if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) < 1 || !Array.isArray(entry.transitions) || !entry.transitions.length || match[1] !== entry.domain || !entry.key || byKey.has(entry.key) || ids.has(entry.id) || !['active', 'tombstone'].includes(entry.state)) throw new Error('Duplicate or malformed gap identity');
    byKey.set(entry.key, entry); ids.add(entry.id);
    maxima.set(entry.domain, Math.max(maxima.get(entry.domain) ?? 0, Number(match[2])));
  }
  const active = new Set();
  const result = [...rows].sort((a, b) => a.key.localeCompare(b.key, 'en')).map(row => {
    if (!/^[A-Z][A-Z0-9]*$/.test(row.domain) || typeof row.key !== 'string' || !row.key || active.has(row.key)) throw new Error('Duplicate or malformed inventory identity');
    active.add(row.key);
    let entry = byKey.get(row.key);
    if (entry && entry.domain !== row.domain) throw new Error(`Gap domain changed for ${row.key}`);
    if (!entry) {
      const number = (maxima.get(row.domain) ?? 0) + 1;
      if (!Number.isSafeInteger(number)) throw new Error('Gap ID counter exhausted');
      maxima.set(row.domain, number);
      entry = { key: row.key, domain: row.domain, id: `GAP-${row.domain}-${String(number).padStart(4, '0')}`, state: 'active', firstSeenRevision: revision, transitions: [{ revision, state: 'active' }] };
      entries.push(entry); byKey.set(row.key, entry);
    } else if (entry.state !== 'active') {
      entry.state = 'active'; entry.transitions.push({ revision, state: 'active' });
    }
    return { ...row, gapId: entry.id };
  });
  for (const entry of entries) if (!active.has(entry.key) && entry.state !== 'tombstone') {
    entry.state = 'tombstone'; entry.transitions.push({ revision, state: 'tombstone' });
  }
  return { rows: result, ledger: { schemaVersion: 1, entries } };
}

export function issueCandidates(rows) {
  return {
    schemaVersion: 1,
    synchronization: 'Stable gapId is the external key; this file proposes issues and does not publish or claim them.',
    details: 'Join gapId to the inventory row for signature, reference and observations. No duplicated issue bodies are stored.',
    issues: rows.filter(row => !['implemented', 'pass'].includes(row.status)).map(row => ({
      gapId: row.gapId, externalKey: `sharpforge-gap:${row.gapId}`,
      title: `[${row.gapId}] ${row.title ?? row.name ?? row.key}`,
      area: row.area, leafId: row.leafId, status: row.status,
    })),
  };
}
