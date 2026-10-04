import test from 'node:test';
import assert from 'node:assert/strict';
import { reconstructAudit } from '../../../scripts/planning/audit.js';
import { auditBody, Claims } from '../../../scripts/planning/lib/claims.js';
import { GitHubProject } from '../../../scripts/planning/lib/github-project.js';
import { FakeGitHub } from '../../../scripts/planning/testing/fake-github.js';

const at = '2026-10-04T12:00:00.000Z';
const later = '2026-10-04T12:00:01.000Z';
const event = (kind, sequence, extra = {}) => ({
  version: 1, task: 'SF-A00-T25', issue: 476, agent: 'codex-owner', generation: 'generation-a',
  at, event: kind, sequence, ...extra,
});
const comment = (record, id) => ({ body: auditBody(record), ...(id === undefined ? {} : { id }) });
const next = { generation: 'generation-b', agent: 'codex-replacement' };
const active = () => [comment(event('claim', 0), 1), comment(event('lock', 1, { key: 'studio' }), 2)];
const assertActive = audit => {
  assert.equal(audit.owner, 'codex-owner');
  assert.deepEqual(audit.locks, ['studio']);
};

test('comment IDs order releases and reclaims sharing one timestamp without comparing generation sequences', () => {
  const comments = [
    comment(event('claim', 0), 10),
    comment(event('lock', 1, { key: 'studio' }), 20),
    comment(event('release', 2), 30),
    comment(event('claim', 0, next), 40),
    comment(event('lock', 1, { ...next, key: 'compiler' }), 50),
  ];
  const before = structuredClone(comments);
  const audit = reconstructAudit([...comments].reverse());
  assert.deepEqual(audit.gaps, []);
  assert.equal(audit.complete, true);
  assert.equal(audit.owner, next.agent);
  assert.deepEqual(audit.locks, ['compiler']);
  assert.deepEqual(audit.timeline.map(record => record.commentId), [10, 20, 30, 40, 50]);
  assert.deepEqual(comments, before);
});

test('actual fake API release/reclaim comments preserve their owner at a fixed clock', async () => {
  const fake = new FakeGitHub();
  const client = new GitHubProject({ owner: 'test', transport: fake.transport });
  let generation = 0;
  const claims = new Claims(client, { now: () => new Date(at), uuid: () => `fixture-generation-${++generation}` });
  const options = { issue: 1, agent: 'codex-owner', branch: 'codex/audit-first' };
  await claims.claim(options);
  await claims.lock({ ...options, key: 'studio' });
  await claims.release(options);
  const replacement = { ...options, agent: next.agent, branch: 'codex/audit-replacement' };
  await claims.claim(replacement);
  await claims.lock({ ...replacement, key: 'studio' });
  const audit = reconstructAudit(fake.issues[0].comments);
  assert.equal(audit.complete, true, audit.gaps.join('\n'));
  assert.equal(audit.owner, replacement.agent);
  assert.deepEqual(audit.locks, ['studio']);
});

test('same-generation histories without IDs retain sequence ordering and quiet-heartbeat gaps', () => {
  const records = [event('claim', 0), event('heartbeat', 1), event('lock', 3, { key: 'studio' }),
    event('unlock', 4, { key: 'studio' }), event('release', 5)];
  for (const id of [undefined, null]) {
    const audit = reconstructAudit([...records].reverse().map(record => comment(record, id)));
    assert.equal(audit.complete, true, audit.gaps.join('\n'));
    assert.equal(audit.owner, null);
    assert.deepEqual(audit.locks, []);
    assert.deepEqual(audit.timeline.map(record => record.sequence), [0, 1, 3, 4, 5]);
  }
});

test('different generations with distinct timestamps can be ordered without comment IDs', () => {
  const records = [event('claim', 0), event('release', 1),
    event('claim', 0, { ...next, at: later }), event('lock', 1, { ...next, at: later, key: 'compiler' })];
  const audit = reconstructAudit([...records].reverse().map(record => comment(record)));
  assert.equal(audit.complete, true, audit.gaps.join('\n'));
  assert.equal(audit.owner, next.agent);
  assert.deepEqual(audit.locks, ['compiler']);
});

test('mixed-generation ties without complete IDs preserve input order and report ambiguity', () => {
  const records = [event('claim', 0), event('lock', 1, { key: 'studio' }), event('release', 2),
    event('claim', 0, next), event('lock', 1, { ...next, key: 'compiler' })];
  for (const ids of [[], [30, undefined, 50, 10]]) {
    const audit = reconstructAudit(records.map((record, index) => comment(record, ids[index])));
    assert.equal(audit.complete, false);
    assert.match(audit.gaps.join('\n'), /Ambiguous event order/);
    assert.deepEqual(audit.timeline.map(record => [record.generation, record.sequence]),
      records.map(record => [record.generation, record.sequence]));
    assert.equal(audit.owner, next.agent);
    assert.deepEqual(audit.locks, ['compiler']);
  }
});

test('chronological string IDs retain integer precision and invalid or duplicate IDs stay incomplete', () => {
  const records = [event('claim', 0), event('release', 1), event('claim', 0, next)];
  const ids = ['90071992547409920', '90071992547409921', '90071992547409922'];
  const audit = reconstructAudit(records.map((record, index) => comment(record, ids[index])).reverse());
  assert.equal(audit.complete, true, audit.gaps.join('\n'));
  assert.deepEqual(audit.timeline.map(record => record.commentId), ids);
  assert.equal(audit.owner, next.agent);
  for (const id of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1, 'invalid-id', '01']) {
    const invalid = reconstructAudit([...active(), comment(event('release', 2), id)]);
    assert.equal(invalid.complete, false);
    assert.match(invalid.gaps.join('\n'), /Invalid chronological comment ID/);
    assertActive(invalid);
  }
  const duplicate = reconstructAudit([...active(), comment(event('release', 2, { at: later }), 2)]);
  assert.equal(duplicate.complete, false);
  assert.match(duplicate.gaps.join('\n'), /Duplicate chronological comment ID/);
  assertActive(duplicate);
});

test('malformed structured records remain visible and never clear established ownership', () => {
  const invalid = [
    null, [], 42, 'record',
    event('release', 2, { version: 2 }), event('unknown', 2),
    event('release', 2, { at: undefined }), event('release', 2, { at: 'not-a-date' }),
    event('release', 2, { at: '2026-02-30T12:00:00Z' }), event('release', 2, { at: '2026-10-04T24:00:00Z' }),
    event('release', 2, { generation: '' }), event('release', 2, { generation: undefined }),
    event('release', 2, { agent: 'invalid agent' }), event('release', 2, { agent: undefined }),
    event('release', -1), event('release', 1.5), event('release', 2, { sequence: undefined }),
    event('claim', 2), event('unlock', 2), event('lock', 2, { key: '' }),
    event('release', 2, { task: 'SF-invalid' }), event('release', 2, { task: ['SF-A00-T25'] }),
    event('release', 2, { issue: '476' }), event('release', 2, { issue: 0 }),
  ];
  for (const record of invalid) {
    const audit = reconstructAudit([...active(), comment(record, 3)]);
    assert.equal(audit.complete, false, JSON.stringify(record));
    assert.equal(audit.timeline.length, 3);
    assert.ok(audit.timeline.find(row => row.commentId === 3).auditError);
    assertActive(audit);
  }
});

test('malformed JSON and unsupported markers are recorded while ordinary discussion is ignored', () => {
  const bodies = [
    '<!-- sharpforge-agent-event:v1 -->\n```json\n{\n```',
    '<!-- sharpforge-agent-event:v1 -->\nNo JSON record',
    '<!-- sharpforge-agent-event:v2 -->\n```json\n{}\n```',
  ];
  for (const body of bodies) {
    const audit = reconstructAudit([...active(), { id: 3, body }, { id: 4, body: 'Ordinary discussion' }]);
    assert.equal(audit.complete, false);
    assert.equal(audit.timeline.length, 3);
    assert.ok(audit.timeline.find(row => row.commentId === 3).auditError);
    assertActive(audit);
  }
  const blank = reconstructAudit([{ body: 'Ordinary discussion' }]);
  assert.equal(blank.complete, false);
  assert.deepEqual(blank.timeline, []);
  assert.match(blank.gaps.join('\n'), /No structured claim events/);
  assert.equal(reconstructAudit([{ body: '\n  ' + auditBody(event('claim', 0)) }]).complete, true);
});

test('mismatched generation and agent events cannot change current owner or locks', () => {
  for (const kind of ['heartbeat', 'lock', 'unlock', 'release']) {
    for (const mismatch of [{ generation: 'stale-generation' }, { agent: 'codex-unrelated' }]) {
      const audit = reconstructAudit([...active(), comment(event(kind, 2, { ...mismatch, key: 'studio' }), 3)]);
      assert.equal(audit.complete, false, `${kind}: ${JSON.stringify(mismatch)}`);
      assert.match(audit.gaps.join('\n'), /matching claim generation|match the claim owner/);
      assertActive(audit);
    }
  }
});

test('overlapping and reused claims are rejected without adopting their owner or dropping locks', () => {
  const overlap = reconstructAudit([...active(), comment(event('claim', 0, next), 3), comment(event('release', 1, next), 4)]);
  assert.equal(overlap.complete, false);
  assert.match(overlap.gaps.join('\n'), /before codex-owner released/);
  assertActive(overlap);
  const reused = reconstructAudit([comment(event('claim', 0), 1), comment(event('release', 1), 2),
    comment(event('claim', 0), 3)]);
  assert.equal(reused.complete, false);
  assert.match(reused.gaps.join('\n'), /generation was already used/);
  assert.equal(reused.owner, null);
});

test('duplicate or backwards sequences and unrecorded unlocks preserve the established lock set', () => {
  for (const record of [event('unlock', 1, { key: 'studio' }), event('release', 1), event('heartbeat', 0),
    event('unlock', 2, { key: 'compiler' })]) {
    const audit = reconstructAudit([...active(), comment(record, 3)]);
    assert.equal(audit.complete, false);
    assert.match(audit.gaps.join('\n'), /sequence|no recorded lock/);
    assertActive(audit);
  }
});

test('a copied event from another task or issue cannot release the current claim', () => {
  for (const identity of [{ task: 'SF-A00-T24' }, { issue: 475 }]) {
    const audit = reconstructAudit([...active(), comment(event('release', 2, identity), 3)]);
    assert.equal(audit.complete, false);
    assert.match(audit.gaps.join('\n'), /task or issue does not match/);
    assertActive(audit);
  }
});

test('field history remains informational even when its data resembles claim or release events', () => {
  const history = [event('release', 2, { at: later }), event('claim', 0, { ...next, at: later })];
  const before = structuredClone(history);
  const audit = reconstructAudit(active(), history);
  assert.equal(audit.complete, true, audit.gaps.join('\n'));
  assertActive(audit);
  assert.equal(audit.timeline.filter(record => record.source === 'project-field-history').length, 2);
  assert.deepEqual(history, before);
  const fieldsOnly = reconstructAudit([], history);
  assert.equal(fieldsOnly.owner, null);
  assert.deepEqual(fieldsOnly.locks, []);
  assert.equal(fieldsOnly.complete, false);
  assert.equal(fieldsOnly.timeline.length, 2);
});

test('malformed field history and comment containers fail visibly without throwing or inventing owners', () => {
  for (const invalid of [null, {}, 'history']) {
    const audit = reconstructAudit(invalid);
    assert.equal(audit.owner, null);
    assert.equal(audit.complete, false);
    assert.match(audit.gaps.join('\n'), /Comments must be an array/);
    const fields = reconstructAudit(active(), invalid);
    assert.equal(fields.complete, false);
    assert.match(fields.gaps.join('\n'), /Field history must be an array/);
    assertActive(fields);
  }
  for (const invalid of [null, {}, { at: 'invalid' }]) {
    const fields = reconstructAudit(active(), [invalid]);
    assert.equal(fields.complete, false);
    assert.ok(fields.timeline.at(-1).auditError);
    assertActive(fields);
  }
  for (const invalid of [null, {}, { id: 3, body: null }]) {
    const audit = reconstructAudit([...active(), invalid]);
    assert.equal(audit.complete, false);
    assert.equal(audit.timeline.length, 3);
    assertActive(audit);
  }
});
