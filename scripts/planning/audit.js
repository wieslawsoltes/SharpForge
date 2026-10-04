import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { GitHubProject } from './lib/github-project.js';
import { agentId, auditRecord, TASK_ID } from './lib/claims.js';

const eventKinds = new Set(['claim', 'heartbeat', 'lock', 'unlock', 'release']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

function timestamp(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const time = Date.parse(value), calendar = Date.parse(value.slice(0, 10) + 'T00:00:00.000Z');
  if (!Number.isFinite(time) || !Number.isFinite(calendar) ||
      new Date(calendar).toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  return time;
}

function commentOrder(value) {
  if (Number.isSafeInteger(value) && value > 0) return BigInt(value);
  if (typeof value === 'string' && /^[1-9]\d{0,31}$/.test(value)) return BigInt(value);
  return null;
}

function eventError(record) {
  if (!object(record)) return 'Structured event must be an object';
  if (record.version !== 1) return 'Unsupported structured event version';
  if (!eventKinds.has(record.event)) return 'Unknown structured event kind';
  if (timestamp(record.at) === null) return 'Missing or invalid event timestamp';
  if (!nonempty(record.generation) || record.generation.length > 128) return 'Missing or invalid claim generation';
  try { agentId(record.agent); } catch { return 'Missing or invalid agent identity'; }
  if (!Number.isSafeInteger(record.sequence) || record.sequence < 0) return 'Invalid event sequence';
  if (record.event === 'claim' && record.sequence !== 0) return 'Claim sequence must start at zero';
  if (['lock', 'unlock'].includes(record.event) && !nonempty(record.key)) return 'Missing or invalid lock key';
  if (Object.hasOwn(record, 'task') && (typeof record.task !== 'string' || !TASK_ID.test(record.task))) return 'Invalid task identity';
  if (Object.hasOwn(record, 'issue') && (!Number.isSafeInteger(record.issue) || record.issue <= 0)) return 'Invalid issue identity';
  return null;
}

function invalidate(row, message, gaps) {
  row.value.auditError = message;
  row.valid = false;
  gaps.push(`${row.label}: ${message}`);
}

function commentRows(comments, gaps) {
  if (!Array.isArray(comments)) {
    gaps.push('Comments must be an array');
    return [];
  }
  const rows = [], seenIds = new Set();
  for (const [index, comment] of comments.entries()) {
    const body = typeof comment?.body === 'string' ? comment.body.trimStart() : null;
    if (body !== null && !body.startsWith('<!-- sharpforge-agent-event:')) continue;
    const row = {
      value: { commentId: comment?.id, event: 'invalid', at: null },
      label: `Comment ${comment?.id ?? `at input ${index + 1}`}`, index, time: null,
      order: commentOrder(comment?.id), valid: false, fieldHistory: false,
    };
    rows.push(row);
    if (body === null) { invalidate(row, 'Missing string comment body', gaps); continue; }
    if (!body.startsWith('<!-- sharpforge-agent-event:v1 -->')) {
      invalidate(row, 'Unsupported structured audit marker', gaps);
      continue;
    }
    const record = auditRecord({ body });
    if (object(record)) row.value = { ...record, commentId: comment?.id };
    row.time = timestamp(record?.at);
    const error = eventError(record);
    if (error) { invalidate(row, error, gaps); continue; }
    if (comment?.id != null && row.order === null) {
      invalidate(row, 'Invalid chronological comment ID', gaps);
      continue;
    }
    if (row.order !== null) {
      if (seenIds.has(row.order)) { invalidate(row, 'Duplicate chronological comment ID', gaps); continue; }
      seenIds.add(row.order);
    }
    row.valid = true;
  }
  return rows;
}

function fieldRows(fieldHistory, start, gaps) {
  if (!Array.isArray(fieldHistory)) {
    gaps.push('Field history must be an array');
    return [];
  }
  return fieldHistory.map((entry, index) => {
    const row = {
      value: { ...(object(entry) ? entry : {}), source: 'project-field-history' },
      label: `Field history at input ${index + 1}`, index: start + index,
      time: timestamp(entry?.at), valid: false, fieldHistory: true,
    };
    if (!object(entry) || row.time === null) invalidate(row, 'Missing or invalid field-history timestamp', gaps);
    return row;
  });
}

function orderBucket(rows, gaps) {
  const comments = rows.filter(row => !row.fieldHistory);
  const fields = rows.filter(row => row.fieldHistory);
  const presentIds = comments.filter(row => row.order !== null).map(row => row.order.toString());
  const uniqueIds = new Set(presentIds);
  if (uniqueIds.size !== presentIds.length) gaps.push(`Duplicate chronological comment ID at ${comments[0].value.at ?? 'unknown time'}`);
  if (presentIds.length === comments.length && uniqueIds.size === comments.length) {
    comments.sort((left, right) => left.order < right.order ? -1 : left.order > right.order ? 1 : 0);
  } else {
    const generations = new Set(comments.filter(row => row.valid).map(row => row.value.generation));
    if (generations.size > 1) {
      gaps.push(`Ambiguous event order at ${comments[0].value.at}: different generations lack unique chronological comment IDs`);
      // Sequence numbers restart at each claim. Input order is the only retained
      // observation when GitHub IDs cannot establish the order of generations.
    } else {
      comments.sort((left, right) =>
        (left.valid ? left.value.sequence : Infinity) - (right.valid ? right.value.sequence : Infinity) || left.index - right.index);
    }
  }
  return [...comments, ...fields];
}

function orderHistory(rows, gaps) {
  const buckets = new Map();
  for (const row of rows) {
    const time = row.time ?? Infinity;
    if (!buckets.has(time)) buckets.set(time, []);
    buckets.get(time).push(row);
  }
  return [...buckets].sort(([left], [right]) => left - right).flatMap(([, bucket]) => orderBucket(bucket, gaps));
}

function replay(row, state, gaps) {
  if (!row.valid || row.fieldHistory) return;
  const event = row.value;
  const reject = message => invalidate(row, message, gaps);
  if (event.task !== undefined && state.task !== null && event.task !== state.task ||
      event.issue !== undefined && state.issue !== null && event.issue !== state.issue) {
    reject('Event task or issue does not match this ownership history');
    return;
  }
  if (event.event === 'claim') {
    if (state.owner) { reject(`claim by ${event.agent} before ${state.owner} released`); return; }
    if (state.generations.has(event.generation)) { reject('Claim generation was already used'); return; }
    state.owner = event.agent;
    state.generation = event.generation;
    state.sequence = event.sequence;
    state.generations.add(event.generation);
    state.task ??= event.task ?? null;
    state.issue ??= event.issue ?? null;
    return;
  }
  if (!state.owner || event.generation !== state.generation) { reject(`${event.event} has no matching claim generation`); return; }
  if (event.agent !== state.owner) { reject(`${event.event} agent does not match the claim owner`); return; }
  if (event.sequence <= state.sequence) { reject('Event sequence is duplicate or moves backwards'); return; }
  if (event.event === 'unlock' && !state.held.has(event.key)) { reject(`unlock has no recorded lock for ${event.key}`); return; }
  state.task ??= event.task ?? null;
  state.issue ??= event.issue ?? null;
  state.sequence = event.sequence;
  if (event.event === 'lock') state.held.add(event.key);
  if (event.event === 'unlock') state.held.delete(event.key);
  if (event.event === 'release') {
    state.owner = null;
    state.generation = null;
    state.held.clear();
  }
}

/** Reconstruct observable claim history. Invalid or ambiguously ordered evidence
 * makes complete false; field history is informational and never grants ownership.
 */
export function reconstructAudit(comments, fieldHistory = []) {
  const gaps = [], events = commentRows(comments, gaps);
  if (!events.some(row => row.valid)) gaps.push('No structured claim events available');
  const rows = orderHistory([...events, ...fieldRows(fieldHistory, events.length, gaps)], gaps);
  const state = { owner: null, generation: null, sequence: -1, task: null, issue: null, held: new Set(), generations: new Set() };
  for (const row of rows) replay(row, state, gaps);
  return {
    timeline: rows.map(row => row.value), owner: state.owner, locks: [...state.held].sort(), gaps,
    complete: gaps.length === 0,
    limitations: [
      'GitHub Projects does not expose a general field-value history API; supplied fieldHistory is merged explicitly. ' +
        'Legacy unstructured comments are not proof of a complete timeline.',
      'Throttled heartbeats may omit intermediate record sequences. Consistent observable events do not prove every Git ref write was captured.',
    ],
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { issue: { type: 'string' }, owner: { type: 'string', default: 'wieslawsoltes' }, repo: { type: 'string', default: 'SharpForge' } } });
  if (!/^\d+$/.test(values.issue ?? '')) throw new Error('--issue required');
  const client = new GitHubProject(values);
  console.log(JSON.stringify(reconstructAudit(await client.comments(values.issue)), null, 2));
}
