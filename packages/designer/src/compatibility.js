import {Scanner, parse} from '@sharpforge/syntax';
import {SourceText} from '@sharpforge/text';
import {frameworkType} from '@sharpforge/framework';
import {constructorProbeCandidates} from './compatibility-constructors.js';

export const designerCompatibilityCodes = Object.freeze({
  compatible: 'SFDESIGN_COMPATIBLE',
  fileType: 'SFDESIGN_FILE_TYPE',
  size: 'SFDESIGN_SOURCE_LIMIT',
  syntax: 'SFDESIGN_INCOMPLETE_SOURCE',
  method: 'SFDESIGN_NO_CONSTRUCTION_METHOD',
  body: 'SFDESIGN_BLOCK_BODY_REQUIRED',
  controls: 'SFDESIGN_NO_DECLARATIVE_CONTROLS',
  ambiguous: 'SFDESIGN_AMBIGUOUS_CONSTRUCTION'
});

const preferredMethods = Object.freeze(['Create', 'InitializeComponent', 'Main']);
const uiKinds = new Set(['control', 'shape', 'window']);

function result(uri, code, reason, method = null) {
  return {
    uri,
    compatible: code === designerCompatibilityCodes.compatible,
    code,
    reason,
    blockingReason: reason,
    methodName: method?.name ?? null,
    method,
    span: method ? {start: method.start, end: method.end} : null
  };
}

function pairTokens(tokens) {
  const pairs = new Int32Array(tokens.length).fill(-1);
  const stack = [];
  const methodTokens = [];
  const classes = [];
  let invalid = false;
  for (let index = 0; index < tokens.length; index++) {
    const {kind, value} = tokens[index];
    if (kind === 'class') classes.push(index);
    if (value === 'Create' || value === 'InitializeComponent' || value === 'Main') methodTokens.push(index);
    if (kind === '(' || kind === '[' || kind === '{') stack.push(index);
    else if (kind === ')' || kind === ']' || kind === '}') {
      const start = stack.pop();
      const expected = kind === ')' ? '(' : kind === ']' ? '[' : '{';
      if (start === undefined || tokens[start].kind !== expected) invalid = true;
      else { pairs[start] = index; pairs[index] = start; }
    }
  }
  return {pairs, methodTokens, classes, invalid: invalid || stack.length !== 0};
}

function signatureStart(tokens, nameIndex) {
  let index = nameIndex - 1;
  while (index >= 0 && ![';', '{', '}'].includes(tokens[index].kind)) index--;
  return index + 1;
}

function constructionType(tokens, index, end) {
  let name = '';
  for (let cursor = index; cursor <= end; cursor++) {
    const token = tokens[cursor];
    if (token.kind === 'identifier') name += token.value;
    else if (token.kind === '.') name += '.';
    else if (token.kind === '::' && name === 'global') name = '';
    else break;
  }
  return frameworkType(name);
}

function containsControls(tokens, start, end) {
  for (let index = start; index < end; index++) {
    if (tokens[index].kind === 'new' && uiKinds.has(constructionType(tokens, index + 1, end)?.kind)) return true;
  }
  return false;
}

function candidate(tokens, index, pairs, text, {uri, owner = null}) {
  const name = owner ? '.ctor' : tokens[index].value;
  if (!owner && !preferredMethods.includes(name) || tokens[index + 1]?.kind !== '(') return null;
  const previous = tokens[index - 1];
  if (!previous || ['.', '?.', 'new', 'return', '='].includes(previous.kind)
    || !owner && ['{', '}', ';'].includes(previous.kind)) return null;
  const parameterEnd = pairs[index + 1];
  if (parameterEnd < 0) return null;
  if (owner && parameterEnd !== index + 2) return null;
  const bodyIndex = parameterEnd + 1;
  if (!['{', '=>'].includes(tokens[bodyIndex]?.kind)) return null;
  const startIndex = signatureStart(tokens, index);
  const header = text.slice(tokens[startIndex].start, tokens[parameterEnd].end);
  // Parse just the signature with the shared C# grammar. The body remains a lexical probe, never a design session.
  const parsed = parse(new SourceText(`class ${owner ? '@' + owner : '__DesignerProbe'} { ${header} {} }`, uri));
  if (parsed.diagnostics.some(diagnostic => diagnostic.severity === 'error')) return null;
  const declaration = parsed.root.members[0]?.members[0];
  if (owner && (declaration?.name !== '.ctor' || declaration.modifiers?.includes('static'))) return null;
  const bodyEnd = pairs[bodyIndex];
  return {
    name,
    ...(owner ? {ownerName: owner} : {}),
    start: tokens[startIndex].start,
    end: bodyEnd >= 0 ? tokens[bodyEnd].end : tokens[bodyIndex].end,
    nameSpan: {start: tokens[index].start, end: tokens[index].end},
    body: {start: tokens[bodyIndex].start, end: bodyEnd >= 0 ? tokens[bodyEnd].end : tokens[bodyIndex].end},
    blockBodied: tokens[bodyIndex].kind === '{' && bodyEnd >= 0,
    hasControls: bodyEnd >= 0 && containsControls(tokens, bodyIndex, bodyEnd)
  };
}

/**
 * O(source length) syntax-only compatibility probe. Spans use UTF-16 offsets. It never compiles, executes, or creates
 * CSharpDesignSession; lexical errors, unsupported files, ambiguity, and a 2-million-character bound are explicit.
 */
export function probeDesignSource(text, uri = 'Program.cs', {maxCharacters = 2_000_000, cancellationToken} = {}) {
  const codes = designerCompatibilityCodes;
  if (typeof uri !== 'string' || !/\.cs$/i.test(uri)) return result(uri, codes.fileType, 'The design view requires a C# source document.');
  if (typeof text !== 'string' || text.length > maxCharacters) return result(uri, codes.size, 'C# design source exceeds the size limit.');
  cancellationToken?.throwIfCancellationRequested();
  if (!preferredMethods.some(name => text.includes(name)) && !(text.includes('class') && text.includes('new'))) {
    return result(uri, codes.method, 'No Create, InitializeComponent, Main, or direct constructor construction was found.');
  }
  const scanner = new Scanner(new SourceText(text, uri), undefined, {cancellationToken});
  const {raws: tokens} = scanner.sequence(null, {captureTrivia: false});
  const {pairs, methodTokens, classes, invalid} = pairTokens(tokens);
  if (invalid || scanner.diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return result(uri, codes.syntax, 'Complete the C# tokens and balanced method body before opening the design view.');
  }
  const methods = [];
  for (const index of methodTokens) {
    const method = candidate(tokens, index, pairs, text, {uri});
    if (method) methods.push(method);
  }
  for (const {index, owner} of constructorProbeCandidates(tokens, pairs, classes)) {
    const method = candidate(tokens, index, pairs, text, {uri, owner});
    if (method) methods.push(method);
  }
  if (!methods.length) return result(uri, codes.method, 'No supported construction method declaration was found.');
  const order = [...preferredMethods, '.ctor'];
  for (const name of order) {
    const matching = methods.filter(method => method.name === name && method.blockBodied && method.hasControls);
    if (matching.length > 1) return result(uri, codes.ambiguous, `More than one ${name} method constructs controls; choose one explicitly.`);
    if (matching.length === 1) return result(uri, codes.compatible, null, matching[0]);
  }
  const preferred = methods.find(method => method.name === order.find(name => methods.some(item => item.name === name)));
  if (!methods.some(method => method.blockBodied)) {
    return result(uri, codes.body, 'A block-bodied construction method is required.', preferred);
  }
  return result(uri, codes.controls, 'The construction method contains no directly constructed supported WinUI controls.', preferred);
}
