import { GitError } from '../errors.js';
import { getObjectFormat, validateObjectId } from '../object-format.js';
import {
  decodeHeaders, encodeHeaders, headerValues, singleHeader, normalizeHeader,
  setHeaderValues, decodeMessage, encodeMessage
} from './headers.js';

/** Parse a Git identity without consulting the clock or the host timezone. */
export function parseIdentity(value) {
  if (typeof value !== 'string') throw new GitError('Corrupt', 'Git identity must be a string');
  const match = /^(.*?) <([^<>\r\n\0]*)> (-?[0-9]+) ([+-][0-9]{4})$/.exec(value);
  if (!match || /[<>\r\n\0]/.test(match[1])) throw new GitError('Corrupt', 'Malformed Git identity');
  const timestamp = Number(match[3]);
  if (!Number.isSafeInteger(timestamp)) throw new GitError('Corrupt', 'Git identity timestamp is out of range');
  return { name: match[1], email: match[2], timestamp, timezone: match[4] };
}

/** Encode explicit identity fields; timestamp is integer Unix seconds and timezone is +/-HHMM. */
export function formatIdentity(identity) {
  if (typeof identity === 'string') {
    parseIdentity(identity);
    return identity;
  }
  const { name, email, timestamp, timezone = '+0000' } = identity ?? {};
  if (typeof name !== 'string' || typeof email !== 'string' || /[<>\r\n\0]/.test(name + email)
    || !Number.isSafeInteger(timestamp) || typeof timezone !== 'string' || !/^[+-][0-9]{4}$/.test(timezone)) {
    throw new GitError('Corrupt', 'Invalid Git identity fields');
  }
  return `${name} <${email}> ${timestamp} ${timezone}`;
}

/** Decode commits without flattening repeated, signed or continued headers. */
export function decodeCommit(input, options = {}) {
  const record = decodeHeaders(input, options);
  const format = getObjectFormat(options.algorithm);
  const tree = validateObjectId(singleHeader(record.headers, 'tree'), format, { allowZero: false });
  const parents = headerValues(record.headers, 'parent').map(oid => validateObjectId(oid, format, { allowZero: false }));
  const author = singleHeader(record.headers, 'author');
  const committer = singleHeader(record.headers, 'committer');
  const encoding = singleHeader(record.headers, 'encoding', { required: false }) ?? 'UTF-8';
  parseIdentity(author);
  parseIdentity(committer);
  return { ...record, tree, parents, author, committer, encoding, message: decodeMessage(record.messageBytes, encoding) };
}

function sourceHeaders(record) {
  if (record.headers === undefined) return [];
  if (!Array.isArray(record.headers)) throw new GitError('Corrupt', 'Object headers must be an array');
  return record.headers.map(normalizeHeader);
}

/** Encode commits canonically when new, preserving existing raw header/message bytes on round-trip. */
export function encodeCommit(record, options = {}) {
  const format = getObjectFormat(options.algorithm);
  const tree = validateObjectId(record.tree, format, { allowZero: false });
  const parents = (record.parents ?? []).map(oid => validateObjectId(oid, format, { allowZero: false }));
  const author = formatIdentity(record.author);
  const committer = formatIdentity(record.committer);
  let headers = sourceHeaders(record);
  const hasCoreHeaders = headers.some(header => ['tree', 'parent', 'author', 'committer'].includes(header.key));
  if (hasCoreHeaders) {
    headers = setHeaderValues(headers, 'tree', [tree]);
    headers = setHeaderValues(headers, 'parent', parents);
    headers = setHeaderValues(headers, 'author', [author]);
    headers = setHeaderValues(headers, 'committer', [committer]);
  } else {
    headers = [
      { key: 'tree', value: tree }, ...parents.map(value => ({ key: 'parent', value })),
      { key: 'author', value: author }, { key: 'committer', value: committer }, ...headers
    ];
  }
  if (record.encoding !== undefined && (record.encoding !== 'UTF-8' || headerValues(headers, 'encoding').length)) {
    headers = setHeaderValues(headers, 'encoding', [record.encoding]);
  }
  for (const key of ['gpgsig', 'gpgsig-sha256', 'mergetag']) {
    if (record[key] !== undefined) headers = setHeaderValues(headers, key, Array.isArray(record[key]) ? record[key] : [record[key]]);
  }
  const encoding = singleHeader(headers, 'encoding', { required: false }) ?? 'UTF-8';
  return encodeHeaders(headers, encodeMessage(record, encoding), options);
}

/** Decode annotated tags, preserving signed tag messages and optional historical tagger fields. */
export function decodeTag(input, options = {}) {
  const record = decodeHeaders(input, options);
  const object = validateObjectId(singleHeader(record.headers, 'object'), options.algorithm, { allowZero: false });
  const type = singleHeader(record.headers, 'type');
  const tag = singleHeader(record.headers, 'tag');
  const tagger = singleHeader(record.headers, 'tagger', { required: false });
  if (!['blob', 'tree', 'commit', 'tag'].includes(type) || !tag || /[\r\n\0]/.test(tag)) throw new GitError('Corrupt', 'Malformed tag');
  if (tagger !== undefined) parseIdentity(tagger);
  return { ...record, object, type, tag, tagger, message: decodeMessage(record.messageBytes) };
}

/** Encode annotated tag bodies; signed payload text remains part of the unchanged message bytes. */
export function encodeTag(record, options = {}) {
  const object = validateObjectId(record.object, options.algorithm, { allowZero: false });
  if (!['blob', 'tree', 'commit', 'tag'].includes(record.type) || typeof record.tag !== 'string'
    || !record.tag || /[\r\n\0]/.test(record.tag)) throw new GitError('Corrupt', 'Invalid annotated tag fields');
  let headers = sourceHeaders(record);
  const core = [
    { key: 'object', value: object }, { key: 'type', value: record.type }, { key: 'tag', value: record.tag }
  ];
  if (record.tagger !== undefined) core.push({ key: 'tagger', value: formatIdentity(record.tagger) });
  if (!headers.some(header => header.key === 'object')) headers = [...core, ...headers];
  else for (const header of core) headers = setHeaderValues(headers, header.key, [header.value]);
  return encodeHeaders(headers, encodeMessage(record), options);
}
