import { createLineMap } from '@sharpforge/syntax';
import { SymbolError } from '@sharpforge/symbols';

const HIDDEN_LINE = 0xfeefee;
const checksumGuid = /^\{[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}\}$/i;
const checksumBytes = /^(?:[\da-f]{2})*$/i;

/** Index one-entry public line maps so each source lookup is O(log directives), including inherited paths. */
function mapsOf(file) {
  const source = file.source;
  const mappings = [{ at: 0, path: source.uri, map: createLineMap(source) }];
  let path = source.uri;
  for (const directive of file.directives ?? []) {
    const structure = directive.structure;
    if (structure?.directive !== 'line' || structure.mode === 'invalid' || structure.isActive === false) continue;
    if (structure.mode === 'default') path = source.uri;
    else if (structure.file !== null && structure.file !== undefined) path = structure.file;
    const normalized = { ...directive, structure: { ...structure, file: path } };
    mappings.push({ at: directive.end, path, map: createLineMap(source, [normalized]) });
  }
  return mappings;
}

function mappingAt(mappings, offset) {
  let lower = 0;
  let upper = mappings.length;
  while (lower + 1 < upper) {
    const middle = (lower + upper) >>> 1;
    if (mappings[middle].at <= offset) lower = middle;
    else upper = middle;
  }
  return mappings[lower];
}

function declaredChecksum(directive) {
  const value = directive.structure;
  if (value?.pragma !== 'checksum' || value.isActive === false || !checksumGuid.test(value.guid) || !checksumBytes.test(value.bytes)) return null;
  // The public document-only writer bounds opaque producer checksums before allocating their bytes.
  if (value.bytes.length > 8192) throw new SymbolError('Declared document checksum exceeds 4096 bytes');
  const hash = new Uint8Array(value.bytes.length / 2);
  for (let index = 0; index < hash.length; index++) hash[index] = Number.parseInt(value.bytes.slice(index * 2, index * 2 + 2), 16);
  return { uri: value.file, documentOnly: true, hashAlgorithm: value.guid.slice(1, -1), hash };
}

/** Source snapshots and mapped document declarations for one emitted assembly. No unavailable content is invented. */
export class CilDebugSources {
  constructor(files) {
    this.files = new Map();
    this.documents = new Map();
    this.syntaxUris = new WeakMap();
    for (const file of files) {
      const source = file.source;
      if (this.documents.has(source.uri)) throw new SymbolError('Duplicate source document names');
      this.files.set(source.uri, { source, mappings: mapsOf(file) });
      this.documents.set(source.uri, { uri: source.uri, text: source.text });
      this.syntaxUris.set(file.syntax, source.uri);
    }
    for (const file of files) for (const directive of file.directives ?? []) {
      const declared = declaredChecksum(directive);
      if (declared && !this.documents.has(declared.uri)) this.documents.set(declared.uri, declared);
    }
  }
  /** Cache parent-chain ownership once; field initializers may belong to another part of a partial type. */
  uriOf(syntax, fallback) {
    const visited = [];
    let current = syntax;
    while (current && !this.syntaxUris.has(current)) {
      visited.push(current);
      current = current.parent;
    }
    const uri = (current && this.syntaxUris.get(current)) ?? syntax?.uri ?? fallback;
    if (uri) for (const node of visited) this.syntaxUris.set(node, uri);
    return uri;
  }
  /** Portable PDB uses one-based UTF-16 columns; hidden/generated code has the standard hidden line marker. */
  location(uri, syntax, hidden = false) {
    const file = this.files.get(uri);
    const span = syntax?.span ?? syntax;
    if (!file || !Number.isInteger(span?.start) || !Number.isInteger(span?.end) || span.end <= span.start) return null;
    const mapping = mappingAt(file.mappings, span.start);
    const start = mapping.map.map(span.start);
    const end = mapping.map.map(span.end);
    const path = start.hidden ? mapping.path : start.path;
    if (!this.documents.has(path)) this.documents.set(path, { uri: path, documentOnly: true });
    const line = start.line + 1;
    const column = start.character + 1;
    const endLine = end.line + 1;
    const endColumn = end.character + 1;
    const invalid = line < 1 || endLine < line || endLine >= 0x20000000 || column > 65535 || endColumn > 65535;
    if (hidden || syntax?.debugHidden || start.hidden || invalid || (line === endLine && column >= endColumn))
      return { uri: path, line: HIDDEN_LINE, column: 0, endLine: HIDDEN_LINE, endColumn: 0 };
    return { uri: path, line, column, endLine, endColumn };
  }
}
