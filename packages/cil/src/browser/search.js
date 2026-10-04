import { CilError } from '../binary.js';

const maximumCacheBytes = 64 * 1024 * 1024;
const unicodeWord = /[\p{L}\p{Nd}\p{M}]/u;
const unicodeDigit = /\p{Nd}/u;
const modes = new Set(['prefix', 'substring', 'camel']);

function cancelled(signal) {
  if (signal?.aborted) throw new CilError('Symbol search cancelled');
}

function integer(value, maximum, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new CilError(`Invalid symbol search ${name}`);
  return value;
}

function options(query, input) {
  if (typeof query !== 'string' || query.length > 256) throw new CilError('Invalid symbol search query');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CilError('Invalid symbol search options');
  const { mode = 'substring', offset = 0, limit = 100, resultLimit = 10000, cacheBytes = maximumCacheBytes, signal } = input;
  if (!modes.has(mode)) throw new CilError('Invalid symbol search mode');
  integer(resultLimit, 10000, 'result limit');
  if (!resultLimit) throw new CilError('Invalid symbol search result limit');
  integer(offset, resultLimit, 'offset');
  integer(limit, 1000, 'page limit');
  integer(cacheBytes, maximumCacheBytes, 'cache budget');
  cancelled(signal);
  return { mode, offset, limit, resultLimit, cacheBytes, signal };
}

function initials(name) {
  let result = '', word = false, digit = false;
  for (const character of name) {
    const code = character.codePointAt(0);
    const number = code < 128 ? code >= 48 && code <= 57 : unicodeDigit.test(character);
    const upper = code < 128 ? code >= 65 && code <= 90
      : character === character.toUpperCase() && character !== character.toLowerCase();
    const inWord = code < 128 ? number || upper || code >= 97 && code <= 122 : unicodeWord.test(character);
    if (inWord && (!word || upper || number && !digit)) result += character;
    word = inWord;
    digit = number;
  }
  return result.toLowerCase();
}

function preflight(entries, maximum, signal) {
  let bytes = entries.length * 2; // One Uint16 simple-name position per record.
  if (bytes > maximum) throw new CilError('Symbol search cache budget exceeded');
  for (let index = 0; index < entries.length; index++) {
    if (!(index & 255)) cancelled(signal);
    const name = entries[index].name;
    // A single name is bounded by AssemblySymbolIndex. Only scratch strings exist in this first pass.
    bytes += 2 * (name.toLowerCase().length + initials(name).length);
    if (bytes > maximum) throw new CilError('Symbol search cache budget exceeded');
  }
  return bytes;
}

function makeCache(entries, maximum, signal) {
  const bytes = preflight(entries, maximum, signal);
  const names = new Array(entries.length), humps = new Array(entries.length), starts = new Uint16Array(entries.length);
  for (let index = 0; index < entries.length; index++) {
    if (!(index & 255)) cancelled(signal);
    const name = entries[index].name.toLowerCase();
    names[index] = name;
    humps[index] = initials(entries[index].name);
    starts[index] = Math.max(name.lastIndexOf('.'), name.lastIndexOf('+'), name.lastIndexOf('/')) + 1;
  }
  cancelled(signal);
  return { names, humps, starts, bytes };
}

function matches(cache, index, query, mode, pattern) {
  if (mode === 'prefix') return cache.names[index].startsWith(query) || cache.names[index].startsWith(query, cache.starts[index]);
  if (mode === 'substring') return cache.names[index].includes(query);
  const humps = cache.humps[index];
  let position = 0;
  for (let character = 0; character < pattern.length; character++) {
    const found = humps.indexOf(pattern[character], position);
    if (found < 0) return false;
    position = found + pattern[character].length;
  }
  return true;
}

/** Internal search service; entries are the immutable scalar records owned by AssemblySymbolIndex. */
export class SymbolSearch {
  #entries;
  #cache;
  constructor(entries) { this.#entries = entries; }

  get storage() { return { entries: this.#cache?.names.length ?? 0, bytes: this.#cache?.bytes ?? 0 }; }

  query(query, input = {}) {
    const config = options(query, input);
    const result = { entries: [], nextOffset: null, capped: false };
    if (!config.limit) return result;
    if (query.length) {
      if (this.#cache && this.#cache.bytes > config.cacheBytes) throw new CilError('Symbol search cache budget exceeded');
      this.#cache ??= makeCache(this.#entries, config.cacheBytes, config.signal);
    }
    const folded = query.toLowerCase();
    const pattern = config.mode === 'camel' ? [...folded] : null;
    const end = Math.min(config.offset + config.limit, config.resultLimit);
    let count = 0;
    for (let index = 0; index < this.#entries.length; index++) {
      if (!(index & 255)) cancelled(config.signal);
      if (query.length && !matches(this.#cache, index, folded, config.mode, pattern)) continue;
      if (count === end) {
        result.capped = end === config.resultLimit;
        result.nextOffset = result.capped ? null : end;
        break;
      }
      if (count >= config.offset) result.entries.push({ ...this.#entries[index] });
      count++;
    }
    cancelled(config.signal);
    return result;
  }
}
