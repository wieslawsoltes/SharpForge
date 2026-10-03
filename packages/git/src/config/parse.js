import { GitError, checkLimit } from '../errors.js';

function syntax(message, line) { throw new GitError('Corrupt', message, { line }); }

export function splitConfigKey(key) {
  if (typeof key !== 'string') throw new TypeError('Git config key must be a string');
  const first = key.indexOf('.');
  const last = key.lastIndexOf('.');
  const section = key.slice(0, first).toLowerCase();
  const name = key.slice(last + 1).toLowerCase();
  const subsection = first === last ? undefined : key.slice(first + 1, last);
  if (first < 1 || !/^[a-z0-9-]+$/u.test(section) || !/^[a-z][a-z0-9-]*$/u.test(name) || /[\x00\r\n]/u.test(subsection ?? '')) {
    throw new GitError('Unsafe', 'Invalid Git config key', { key });
  }
  return { section, subsection, name };
}

export function configKey({ section, subsection, name }) {
  return `${section}.${subsection === undefined ? '' : `${subsection}.`}${name}`;
}

/** Decode Git's quoted/unquoted value grammar without treating comments as data. */
function parseValue(text, line) {
  let result = '';
  let whitespace = '';
  let quoted = false;
  let commentAt = text.length;
  const escapes = { n: '\n', t: '\t', b: '\b', '\\': '\\', '"': '"' };
  for (let offset = 0; offset < text.length; offset++) {
    const character = text[offset];
    if (!quoted && (character === '#' || character === ';')) { commentAt = offset; break; }
    if (character === '"') {
      result += whitespace;
      whitespace = '';
      quoted = !quoted;
      continue;
    }
    if (character === '\\') {
      const next = text[++offset];
      if (!Object.hasOwn(escapes, next)) syntax('Invalid escape in Git config value', line);
      result += whitespace + escapes[next];
      whitespace = '';
      continue;
    }
    if (!quoted && (character === ' ' || character === '\t')) {
      if (result) whitespace += character;
      continue;
    }
    result += whitespace + character;
    whitespace = '';
  }
  if (quoted) syntax('Unterminated quoted Git config value', line);
  const comment = text.slice(commentAt);
  return { value: result, suffix: `${whitespace}${comment}` };
}

function parseSection(text, line) {
  const modern = /^\[([A-Za-z0-9-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\]\s*(?:[#;].*)?$/u.exec(text);
  if (modern) {
    const subsection = modern[2]?.replace(/\\(.)/gu, '$1');
    return { section: modern[1].toLowerCase(), subsection };
  }
  const legacy = /^\[([A-Za-z0-9-]+)\.([^\]\r\n]+)\]\s*(?:[#;].*)?$/u.exec(text);
  if (legacy) return { section: legacy[1].toLowerCase(), subsection: legacy[2].toLowerCase() };
  syntax('Malformed Git config section', line);
}

function physicalRecords(source) {
  const result = [];
  let start = 0;
  let line = 1;
  let recordLine = 1;
  for (let index = 0; index < source.length; index++) {
    if (source[index] !== '\n') continue;
    let previous = index - 1;
    if (source[previous] === '\r') previous--;
    let slashes = 0;
    while (source[previous--] === '\\') slashes++;
    line++;
    if (slashes % 2) continue;
    result.push({ raw: source.slice(start, index + 1), line: recordLine });
    start = index + 1;
    recordLine = line;
  }
  if (start < source.length) result.push({ raw: source.slice(start), line: recordLine });
  return result;
}

export function parseConfigRecords(source, { maxBytes = 8 * 1024 * 1024, maxEntries = 100000 } = {}) {
  if (typeof source !== 'string') throw new TypeError('Git config must be text');
  checkLimit(source.length, maxBytes, 'Git config size');
  if (source.includes('\0')) syntax('Git config contains a NUL byte', 1);
  const records = [];
  const warnings = [];
  let section;
  let subsection;
  for (const record of physicalRecords(source)) {
    const ending = /\r?\n$/u.exec(record.raw)?.[0] ?? '';
    const joined = record.raw.slice(0, record.raw.length - ending.length).replace(/\\\r?\n/gu, '');
    const text = (record.line === 1 ? joined.replace(/^\ufeff/u, '') : joined).trimStart();
    if (!text || /^[#;]/u.test(text)) { records.push({ ...record, type: 'trivia' }); continue; }
    if (text.startsWith('[')) {
      ({ section, subsection } = parseSection(text, record.line));
      records.push({ ...record, type: 'section', section, subsection });
      continue;
    }
    if (!section) syntax('Git config entry appears before a section', record.line);
    const match = /^(\s*)([A-Za-z][A-Za-z0-9-]*)(\s*)(?:(=)(\s*)(.*)|([#;].*))?$/u.exec(joined);
    if (!match) syntax('Malformed Git config variable', record.line);
    const name = match[2].toLowerCase();
    const value = match[4] ? parseValue(match[6], record.line) : { value: true, suffix: `${match[3]}${match[7] ?? ''}` };
    const entry = { ...record, type: 'entry', section, subsection, name, value: value.value,
      prefix: `${match[1]}${match[2]}${match[3]}${match[4] ?? '='}${match[5] ?? ' '}`,
      suffix: value.suffix, ending };
    records.push(entry);
    if ((section === 'include' || section === 'includeif') && name === 'path') {
      warnings.push({ code: 'GitConfigIncludeDisabled', severity: 'warning', line: record.line,
        message: 'External Git config includes are disabled', path: entry.value, condition: subsection });
    }
    checkLimit(records.length, maxEntries, 'Git config entry count');
  }
  return { records, warnings };
}
