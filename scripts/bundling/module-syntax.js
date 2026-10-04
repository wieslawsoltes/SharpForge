import { codeTokens } from '../conformance/static/code-tokens.js';

const identifier = /^[A-Za-z_$][\w$]*$/;
const member = value => value === '.' || value === '?.';

function literal(source, token) {
  const raw = source.slice(token?.start, token?.end);
  if (token?.value !== '<string>' || !/^(['"])[^\\\r\n]*\1$/.test(raw)) {
    throw new Error('Module paths must be unescaped string literals');
  }
  return raw.slice(1, -1);
}

function names(tokens, start) {
  const result = [];
  let at = start + 1;
  while (tokens[at]?.value !== '}') {
    const name = tokens[at++]?.value;
    if (!identifier.test(name ?? '')) throw new Error('Unsupported named binding');
    let alias = name;
    if (tokens[at]?.value === 'as') { at++; alias = tokens[at++]?.value; }
    if (!identifier.test(alias ?? '')) throw new Error('Unsupported binding alias');
    result.push({ name, alias });
    if (tokens[at]?.value !== ',') break;
    at++;
  }
  if (tokens[at]?.value !== '}') throw new Error('Unclosed named bindings');
  return { names: result, next: at + 1 };
}

function declarationNames(tokens, start) {
  const result = [];
  let at = start, depth = 0;
  if (!identifier.test(tokens[at]?.value ?? '')) throw new Error('Destructured exports require native ESM');
  result.push(tokens[at].value);
  for (at++; at < tokens.length; at++) {
    const value = tokens[at].value;
    if (value === ';' && depth === 0) break;
    if (['(', '[', '{'].includes(value)) depth++;
    if ([')', ']', '}'].includes(value)) depth--;
    if (value === ',' && depth === 0) {
      const name = tokens[++at]?.value;
      if (!identifier.test(name ?? '')) throw new Error('Destructured exports require native ESM');
      result.push(name);
    }
  }
  return result;
}

function importStatement(source, tokens, at) {
  const start = at, next = tokens[at + 1]?.value;
  if (next === '(') {
    const specifier = literal(source, tokens[at + 2]);
    if (tokens[at + 3]?.value !== ')') throw new Error('Computed dynamic imports and import options are unsupported');
    return { kind: 'dynamic', specifier, start: tokens[start].start, end: tokens[at + 3].end, next: at + 4 };
  }
  let bindings = [], namespace = null;
  at++;
  if (next === '{') { const list = names(tokens, at); bindings = list.names; at = list.next; }
  else if (next === '*') {
    if (tokens[at + 1]?.value !== 'as' || !identifier.test(tokens[at + 2]?.value ?? '')) throw new Error('Invalid namespace import');
    namespace = tokens[at + 2].value;
    at += 3;
  } else if (next !== '<string>') throw new Error('Default imports require native ESM');
  if (next !== '<string>' && tokens[at++]?.value !== 'from') throw new Error('Invalid static import');
  const specifier = literal(source, tokens[at++]);
  if (tokens[at]?.value === ';') at++;
  return { kind: 'static', specifier, bindings, namespace, start: tokens[start].start, end: tokens[at - 1].end, next: at };
}

function exportStatement(source, tokens, at) {
  const start = at, next = tokens[at + 1]?.value;
  if (next === '*' || next === '{') {
    at++;
    let bindings = null;
    if (next === '{') { const list = names(tokens, at); bindings = list.names; at = list.next; }
    else at++;
    let specifier = null;
    if (tokens[at]?.value === 'from') { at++; specifier = literal(source, tokens[at++]); }
    if (!specifier && !bindings) throw new Error('Unsupported export-star declaration');
    if (tokens[at]?.value === ';') at++;
    return { kind: specifier ? 'reexport' : 'exports', specifier, bindings,
      start: tokens[start].start, end: tokens[at - 1].end, next: at };
  }
  at++;
  let kind = tokens[at]?.value;
  if (kind === 'async') { at++; kind = tokens[at]?.value; }
  if (!['const', 'class', 'function'].includes(kind)) throw new Error('Only immutable named declarations can be bundled');
  at++;
  if (kind === 'function' && tokens[at]?.value === '*') at++;
  const declared = kind === 'const' ? declarationNames(tokens, at) : [tokens[at]?.value];
  if (declared.some(name => !identifier.test(name ?? ''))) throw new Error('Unsupported exported declaration');
  return { kind: 'declaration', bindings: declared.map(name => ({ name, alias: name })),
    start: tokens[start].start, end: tokens[start].end, next: start + 1 };
}

function workerUrl(source, tokens, at) {
  const values = tokens.slice(at, at + 11).map(token => token.value);
  if (values.join(' ') !== 'new URL ( <string> , import . meta . url )') return null;
  return { kind: 'worker', specifier: literal(source, tokens[at + 3]),
    start: tokens[at].start, end: tokens[at + 10].end, next: at + 11 };
}

/** Token locations exclude comments/strings/regex bodies and include executable template expressions. */
export function moduleSyntax(source) {
  const tokens = codeTokens(source), records = [];
  for (let at = 0; at < tokens.length;) {
    const token = tokens[at], previous = tokens[at - 1]?.value;
    let record = null;
    if (token.value === 'new' && !member(previous)) record = workerUrl(source, tokens, at);
    if (token.value === 'import' && !member(previous) && tokens[at + 1]?.value !== ':') {
      if (tokens[at + 1]?.value === '.') throw new Error('Unresolved import.meta; only literal worker URLs are supported');
      record = importStatement(source, tokens, at);
    }
    if (token.value === 'export' && !member(previous) && ![':', '('].includes(tokens[at + 1]?.value)) {
      record = exportStatement(source, tokens, at);
    }
    if (record) { records.push(record); at = record.next; }
    else at++;
  }
  return records;
}
