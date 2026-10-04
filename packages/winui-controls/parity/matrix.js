import { createHash } from 'node:crypto';
import { parseReferenceRow, methodKey, normalizeType, isWinUIType, signatureText } from './signatures.js';
import { exportGapRecords } from './gap-export.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function registryIndex(manifest) {
  const types = new Map(manifest.types.map(type => [type.name, type]));
  const methods = new Map();
  const projected = new Map();
  const named = new Map();
  const owned = new Map();
  for (const member of manifest.members) {
    methods.set(methodKey(member), member);
    projected.set(methodKey(member, { projected: true }), member);
    const key = member.owner + '::' + member.name;
    if (!named.has(key)) named.set(key, []);
    named.get(key).push(member);
    if (!owned.has(member.owner)) owned.set(member.owner, []);
    owned.get(member.owner).push(member);
  }
  return { types, methods, projected, named, owned };
}

function matchReference(row, index) {
  const type = index.types.get(row.owner);
  const candidates = index.named.get(row.owner + '::' + row.name) ?? [];
  if (row.kind === 'type') return { exact: !!type, ids: [], candidates: [] };
  if (row.kind === 'method') {
    const member = index.methods.get(methodKey(row));
    const projected = index.projected.get(methodKey(row));
    return { exact: !!member, projection: !member && !!projected, ids: member ? [member.id] : [],
      candidates: member ? [member] : projected ? [projected] : candidates };
  }
  const members = index.owned.get(row.owner) ?? [];
  if (row.kind === 'property') {
    const property = type?.properties?.[row.name];
    const matching = members.filter(member => member.property === row.name);
    return { exact: !!property && normalizeType(property.type) === normalizeType(row.result)
      && !!property.isStatic === !!row.isStatic && !row.parameters.length && (!row.set || !property.readOnly),
    ids: matching.map(member => member.id), candidates: matching };
  }
  if (row.kind === 'event') {
    const handler = type?.events?.[row.name];
    const matching = members.filter(member => member.event === row.name);
    return { exact: typeof handler === 'string' && normalizeType(handler) === normalizeType(row.result) && !row.isStatic,
      ids: matching.map(member => member.id), candidates: matching };
  }
  return { exact: type?.kind === 'enum' && Object.hasOwn(type.values, row.name), ids: [], candidates: [] };
}

function evidenceIndex(evidence) {
  const result = new Map();
  for (const entry of evidence ?? []) {
    if (!entry.referenceKey || result.has(entry.referenceKey)) throw new Error('Duplicate or missing behavior evidence identity');
    if (!['unverified', 'failed', 'verified', 'unsupported'].includes(entry.status)) throw new Error('Invalid behavior evidence status');
    if (entry.status === 'verified' && (!entry.test || !/^[a-f0-9]{64}$/.test(entry.resultSHA256 ?? '')
      || !entry.engines?.length || !entry.platforms?.length)) throw new Error('Verified behavior requires a hashed result and engine/platform scope');
    result.set(entry.referenceKey, entry);
  }
  return result;
}

function deviations(manifest, index, referenceRows, matchedIds, policies) {
  const nativeOwners = new Set(referenceRows.map(row => row.owner));
  const referenceNames = new Map();
  for (const row of referenceRows) {
    const key = row.owner + '::' + row.name;
    if (!referenceNames.has(key)) referenceNames.set(key, []);
    referenceNames.get(key).push(row);
  }
  const entries = [];
  for (const member of manifest.members) {
    if ((!isWinUIType(member.owner) && !policies.types?.[member.owner]) || matchedIds.has(member.id)) continue;
    const name = member.property ?? member.event ?? member.name;
    const key = member.owner + '::' + name;
    const rule = policies.members?.[key] ?? policies.types?.[member.owner];
    const names = new Set([name, member.name, member.name.replace(/^set_/, 'put_')]);
    const counterpart = [...names].flatMap(value => referenceNames.get(member.owner + '::' + value) ?? []);
    const native = nativeOwners.has(member.owner);
    const kind = rule?.kind ?? (counterpart.length ? 'signature-deviation' : native ? 'profile-extension' : 'unreferenced-type');
    entries.push({ contractId: member.id, owner: member.owner, name: member.name, signature: signatureText(member), kind,
      reason: rule?.reason ?? (counterpart.length ? 'The released/profile ABI differs from the pinned native signature.'
        : native ? 'This registered convenience member is absent from the pinned native type.'
          : 'The type is absent from the current reference set; native absence is not inferred outside imported namespaces.'),
      migrationTargets: rule?.migrationTargets ?? counterpart.map(row => row.signature),
      review: rule ? 'documented' : 'inventory-reported' });
  }
  return entries;
}

/** API presence and behavior are separate axes; a registered type never proves its behavior. */
export function generateParityMatrix(reference, manifest, { behaviorEvidence = [], policies = {} } = {}) {
  if (!Array.isArray(reference.rows) || !Array.isArray(manifest.types) || !Array.isArray(manifest.members)) {
    throw new TypeError('A reference inventory and framework manifest are required');
  }
  if (new Set(reference.rows.map(row => row.key)).size !== reference.rows.length) throw new Error('Duplicate reference key');
  const parsed = reference.rows.map(parseReferenceRow);
  const index = registryIndex(manifest);
  const evidence = evidenceIndex(behaviorEvidence);
  const matchedIds = new Set();
  const rows = parsed.map(row => {
    const match = matchReference(row, index);
    if (match.exact && row.kind === 'method') for (const id of match.ids) matchedIds.add(id);
    const api = match.exact ? 'present' : match.projection ? 'projection' : match.candidates.length ? 'signature-mismatch' : 'missing';
    const behavior = evidence.get(row.key);
    if (behavior?.status === 'verified' && api !== 'present') throw new Error('Missing native API cannot be marked behavior-verified: ' + row.key);
    return { key: row.key, owner: row.owner, name: row.name, kind: row.kind, signature: row.signature, assembly: row.assembly,
      api, behavior: behavior?.status ?? 'unverified', evidence: behavior ?? null, contractIds: match.exact ? match.ids : [],
      candidateContractIds: match.candidates.map(member => member.id),
      candidateSignatures: match.candidates.map(signatureText), gapId: row.gapId ?? null, leafId: row.leafId ?? null,
      enumValues: row.kind === 'field' ? 'Numeric enum values are not present in the sealed metadata rows; semantics remain unverified.' : null,
      reason: api === 'present' ? 'Exact registered signature; behavior is qualified separately.'
        : api === 'projection' ? 'CLR set_ accessor projects native WinRT put_; the binary signatures remain distinguishable.'
          : api === 'signature-mismatch' ? 'A named registry member exists with a different signature.' : 'No matching registered API.' };
  });
  const summaries = new Map();
  for (const row of rows) {
    const summary = summaries.get(row.owner) ?? { type: row.owner, total: 0, present: 0, projection: 0, mismatched: 0, missing: 0, verified: 0 };
    summary.total++;
    summary[row.api === 'signature-mismatch' ? 'mismatched' : row.api]++;
    if (row.behavior === 'verified') summary.verified++;
    summaries.set(row.owner, summary);
  }
  const apiCounts = Object.fromEntries(['present', 'projection', 'signature-mismatch', 'missing'].map(status =>
    [status, rows.filter(row => row.api === status).length]));
  const requiredPrefixes = ['Microsoft.UI.Xaml.', 'Microsoft.UI.Composition.', 'Microsoft.UI.Windowing.',
    'Microsoft.UI.Dispatching.', 'Microsoft.UI.Input.'];
  const result = { schemaVersion: 1, windowsAppSDK: reference.windowsAppSDK,
    referenceFiles: reference.referenceFiles ?? reference.files, extractor: reference.extractor,
    referenceSHA256: hash(reference.rows.map(row => [row.key, row.signature])), registrySHA256: hash(manifest),
    referenceCoverage: requiredPrefixes.map(prefix => ({ namespace: prefix, imported: rows.some(row => row.owner.startsWith(prefix)) })),
    totals: { denominator: rows.length, api: apiCounts, behaviorVerified: rows.filter(row => row.behavior === 'verified').length,
      registryWinUITypes: manifest.types.filter(type => isWinUIType(type.name)).length,
      registryWinUIMembers: manifest.members.filter(member => isWinUIType(member.owner)).length },
    types: [...summaries.values()].sort((a, b) => a.type.localeCompare(b.type, 'en')),
    deviations: deviations(manifest, index, parsed, matchedIds, policies), profileDeviations: policies.behaviors ?? [], rows };
  result.gaps = exportGapRecords(rows);
  return result;
}
