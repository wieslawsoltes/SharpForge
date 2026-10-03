import { GitError } from '../errors.js';
import { configKey, parseConfigRecords, splitConfigKey } from './parse.js';

export function encodeConfigValue(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value !== 'string' || value.includes('\0')) throw new GitError('Unsafe', 'Unsupported Git config value');
  const escaped = value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"').replace(/\n/gu, '\\n')
    .replace(/\t/gu, '\\t').replace(/\x08/gu, '\\b');
  if (escaped.includes('\r')) throw new GitError('Unsafe', 'Git config values cannot contain carriage returns');
  return `"${escaped}"`;
}

function sectionHeader({ section, subsection }) {
  const suffix = subsection === undefined ? '' : ` "${subsection.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
  return `[${section}${suffix}]`;
}

/** Lossless config syntax document. Unedited records retain their exact source bytes. */
export class ConfigDocument {
  constructor(source = '', options = {}) {
    const parsed = parseConfigRecords(source, options);
    this.records = parsed.records;
    this.warnings = parsed.warnings;
    this.newline = source.includes('\r\n') ? '\r\n' : '\n';
    this.options = options;
  }

  #matches(key) {
    const normalized = configKey(splitConfigKey(key));
    return this.records.filter(record => record.type === 'entry' && !record.removed && configKey(record) === normalized);
  }

  getAll(key) { return this.#matches(key).map(record => record.value); }
  get(key, fallback) { return this.#matches(key).at(-1)?.value ?? fallback; }
  has(key) { return this.#matches(key).length !== 0; }

  getBoolean(key, fallback) {
    const value = this.get(key, fallback);
    if (value === undefined) return value;
    if (typeof value === 'boolean') return value;
    if (/^(?:true|yes|on|1)$/iu.test(String(value))) return true;
    if (/^(?:false|no|off|0|)$/iu.test(String(value))) return false;
    throw new GitError('Corrupt', 'Git config variable is not a boolean', { key });
  }

  getInteger(key, fallback) {
    const value = this.get(key, fallback);
    if (value === undefined) return value;
    const match = /^([+-]?\d+)([kmg]?)$/iu.exec(String(value));
    if (!match) throw new GitError('Corrupt', 'Git config variable is not an integer', { key });
    const multiplier = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[match[2].toLowerCase()];
    const result = Number(match[1]) * multiplier;
    if (!Number.isSafeInteger(result)) throw new GitError('Limit', 'Git config integer exceeds safe precision', { key });
    return result;
  }

  /** Replace the final matching value, or append a multivar without reordering existing records. */
  set(key, value, { append = false } = {}) {
    const parsed = splitConfigKey(key);
    const encoded = encodeConfigValue(value);
    const existing = append ? undefined : this.#matches(key).at(-1);
    if (existing) {
      existing.value = value;
      existing.raw = `${existing.prefix}${encoded}${existing.suffix}${existing.ending}`;
      return this;
    }
    let insertion = -1;
    let inSection = false;
    for (let index = 0; index < this.records.length; index++) {
      const record = this.records[index];
      if (record.type === 'section') inSection = record.section === parsed.section && record.subsection === parsed.subsection;
      if (inSection) insertion = index + 1;
    }
    const prefix = `\t${parsed.name} = `;
    const record = { ...parsed, type: 'entry', value, raw: `${prefix}${encoded}${this.newline}`,
      prefix, suffix: '', ending: this.newline, line: 0 };
    if (insertion < 0) {
      const last = this.records.at(-1);
      if (last && !last.raw.endsWith('\n')) last.raw += this.newline;
      this.records.push({ type: 'section', ...parsed, raw: `${sectionHeader(parsed)}${this.newline}`, line: 0 }, record);
    } else {
      const previous = this.records[insertion - 1];
      if (previous && !previous.raw.endsWith('\n')) previous.raw += this.newline;
      this.records.splice(insertion, 0, record);
    }
    return this;
  }

  unset(key, { all = true } = {}) {
    const matches = this.#matches(key);
    for (const record of all ? matches : matches.slice(-1)) record.removed = true;
    return this;
  }

  entries() {
    return this.records.filter(record => record.type === 'entry' && !record.removed)
      .map(record => ({ key: configKey(record), value: record.value }));
  }

  toString() { return this.records.filter(record => !record.removed).map(record => record.raw).join(''); }
}

export function parseGitConfig(source, options) { return new ConfigDocument(source, options); }
export function serializeGitConfig(document) { return document.toString(); }
