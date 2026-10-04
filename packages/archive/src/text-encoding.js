import {portablePath} from './path-policy.js';

const encoder = new TextEncoder();
const textPath = new RegExp('(?:\\.(?:cs|fs|vb|csproj|fsproj|vbproj|slnx|sln|props|targets|proj|json|xml|config|resx|resw|txt|md|il'
  + '|css|html?|js|mjs|ts|svg|yml|yaml|editorconfig|gitignore|gitattributes|ruleset|runsettings|rsp|csv)'
  + '|(?:^|/)(?:LICENSE|NOTICE|README|\\.editorconfig|\\.gitignore|\\.gitattributes|NuGet.Config))$', 'i');
const windows1252 = '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f'
  + '\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';

export class TextEncodingError extends Error {
  constructor(message, code = 'SFWENC001') {
    super(message);
    this.name = 'TextEncodingError';
    this.code = code;
  }
}

export const isWorkspaceTextPath = path => textPath.test(path);

/** Record every delimiter, including CR-only lines; an empty last delimiter means no final newline. */
export function detectLineEndings(text) {
  const lineEndings = text.match(/\r\n|\r|\n/g) ?? [];
  const counts = new Map();
  for (const ending of lineEndings) counts.set(ending, (counts.get(ending) ?? 0) + 1);
  const preferred = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '\n';
  return {lineEndings, lineEnding: counts.size > 1 ? 'mixed' : preferred, preferredLineEnding: preferred,
    finalNewline: /(?:\r\n|\r|\n)$/.test(text)};
}

function inferUtf16(bytes) {
  if (bytes.length < 4 || bytes.length % 2) return null;
  const pairs = Math.min(bytes.length / 2, 4096);
  let evenNulls = 0;
  let oddNulls = 0;
  for (let index = 0; index < pairs; index++) {
    if (bytes[index * 2] === 0) evenNulls++;
    if (bytes[index * 2 + 1] === 0) oddNulls++;
  }
  if (oddNulls / pairs >= 0.3 && evenNulls / pairs <= 0.05) return 'utf-16le';
  if (evenNulls / pairs >= 0.3 && oddNulls / pairs <= 0.05) return 'utf-16be';
  return null;
}

function binaryText(text) {
  return /[\u0000-\u0008\u000b\u000e-\u001a\u001c-\u001f]/.test(text);
}

/** Decode likely text without discarding original bytes. Legacy fallback is explicitly marked lossy/uncertain. */
export function decodeWorkspaceFile(path, bytes, {legacyFallback = true, forceText = false} = {}) {
  portablePath(path);
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected file bytes');
  const record = {path, bytes: bytes.slice()};
  if (!forceText && !isWorkspaceTextPath(path)) return record;
  let encoding = 'utf-8';
  let bom = false;
  let inferred = false;
  let lossy = false;
  if (bytes[0] === 255 && bytes[1] === 254) { encoding = 'utf-16le'; bom = true; }
  else if (bytes[0] === 254 && bytes[1] === 255) { encoding = 'utf-16be'; bom = true; }
  else if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) bom = true;
  else { const detected = inferUtf16(bytes); if (detected) { encoding = detected; inferred = true; } }
  let text;
  try {
    text = new TextDecoder(encoding, {fatal: true}).decode(bytes);
  } catch (error) {
    if (bom || encoding !== 'utf-8' || !legacyFallback) return {...record, encodingDiagnostic: error.message};
    encoding = 'windows-1252';
    lossy = true;
    text = Array.from(bytes, byte => byte >= 128 && byte < 160 ? windows1252[byte - 128] : String.fromCharCode(byte)).join('');
  }
  if (binaryText(text)) return record;
  return {...record, text, originalText: text, encoding, bom, lossy, inferred, ...detectLineEndings(text)};
}

function savedText(record) {
  const text = record.text;
  if (record.preserveLineEndings === false || !record.lineEndings?.length || text.includes('\r')) return text;
  let index = 0;
  return text.replace(/\n/g, () => record.lineEndings[index++] ?? record.preferredLineEnding ?? '\n');
}

function encodeLegacy(text) {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) {
    const point = text.charCodeAt(index);
    const mapped = windows1252.indexOf(text[index]);
    if (point <= 127 || point >= 160 && point <= 255) bytes[index] = point;
    else if (mapped >= 0) bytes[index] = mapped + 128;
    else throw new TextEncodingError('Character cannot be represented by Windows-1252; choose UTF-8 explicitly', 'SFWENC002');
  }
  return bytes;
}

/** Preserve unchanged bytes exactly. Edited text retains encoding and per-line delimiters unless explicitly changed. */
export function encodeWorkspaceFile(record) {
  if (typeof record.text !== 'string') {
    if (!(record.bytes instanceof Uint8Array)) throw new TextEncodingError('Missing file data: ' + record.path);
    return record.bytes.slice();
  }
  if (record.bytes instanceof Uint8Array && record.text === record.originalText) return record.bytes.slice();
  const text = savedText(record);
  const {encoding = 'utf-8', bom = false} = record;
  if (typeof text.isWellFormed === 'function' && !text.isWellFormed()) {
    throw new TextEncodingError('Text contains an unpaired UTF-16 surrogate', 'SFWENC003');
  }
  if (encoding === 'windows-1252') return encodeLegacy(text);
  if (encoding === 'utf-8') {
    const bytes = encoder.encode(text);
    const output = new Uint8Array(bytes.length + (bom ? 3 : 0));
    if (bom) output.set([239, 187, 191]);
    output.set(bytes, bom ? 3 : 0);
    return output;
  }
  if (!['utf-16le', 'utf-16be'].includes(encoding)) throw new TextEncodingError('Unsupported text encoding: ' + encoding);
  const output = new Uint8Array(text.length * 2 + (bom ? 2 : 0));
  const view = new DataView(output.buffer);
  if (bom) output.set(encoding === 'utf-16le' ? [255, 254] : [254, 255]);
  for (let index = 0; index < text.length; index++) view.setUint16((bom ? 2 : 0) + index * 2, text.charCodeAt(index), encoding === 'utf-16le');
  return output;
}
