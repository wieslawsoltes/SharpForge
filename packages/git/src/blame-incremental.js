import { checkCancelled } from './errors.js';

/** Group finalized records only when both source and final line numbers are consecutive. */
export function* blameChunks(records) {
  let group = [];
  for (const record of records) {
    const last = group.at(-1);
    if (last && (record.oid !== last.oid || record.path !== last.path || record.originalLine !== last.originalLine + 1
      || record.finalLine !== last.finalLine + 1 || record.ignored !== last.ignored || record.unblamable !== last.unblamable)) {
      yield chunk(group);
      group = [];
    }
    group.push(record);
  }
  if (group.length) yield chunk(group);
}

function chunk(lines) {
  const { text, ...metadata } = lines[0];
  return Object.freeze({ ...metadata, lineCount: lines.length, lines: Object.freeze(lines) });
}

function quotePath(path) {
  const bytes = new TextEncoder().encode(path);
  if (!bytes.some(byte => byte < 32 || byte >= 127 || byte === 34 || byte === 92)) return path;
  let quoted = '"';
  for (const byte of bytes) {
    if (byte === 34 || byte === 92) quoted += `\\${String.fromCharCode(byte)}`;
    else if (byte === 9) quoted += '\\t';
    else if (byte === 10) quoted += '\\n';
    else if (byte === 13) quoted += '\\r';
    else if (byte < 32 || byte >= 127) quoted += `\\${byte.toString(8).padStart(3, '0')}`;
    else quoted += String.fromCharCode(byte);
  }
  return `${quoted}"`;
}

function metadataText(value) {
  return String(value ?? '').replace(/[\r\n\u0000]/g, ' ');
}

function identityLines(role, identity) {
  return `${role} ${metadataText(identity?.name)}\n${role}-mail <${metadataText(identity?.email)}>\n`
    + `${role}-time ${identity?.timestamp ?? 0}\n${role}-tz ${metadataText(identity?.timezone ?? '+0000')}\n`;
}

/** Serialize an incremental chunk stream using Git's header/metadata/filename framing, without source text. */
export async function* formatBlameIncremental(chunks, { signal } = {}) {
  const seen = new Set();
  for await (const item of chunks) {
    checkCancelled(signal);
    let text = `${item.oid} ${item.originalLine} ${item.finalLine} ${item.lineCount}\n`;
    if (!seen.has(item.oid)) {
      seen.add(item.oid);
      text += identityLines('author', item.author) + identityLines('committer', item.committer);
      text += `summary ${metadataText(item.summary)}\n`;
      if (item.boundary) text += 'boundary\n';
    }
    if (item.ignored) text += 'ignored\n';
    if (item.unblamable) text += 'unblamable\n';
    text += `filename ${quotePath(item.path)}\n`;
    yield text;
  }
}
