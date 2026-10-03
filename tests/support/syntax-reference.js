/** Helpers for the syntax fixture suites: fixture discovery, Roslyn reference comparison and source corpora. */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { SyntaxTree, decimalToString, matchesGrammar, boundPhaseCodes, languageFeatures } from '@sharpforge/syntax';
export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const fixtureRoot = join(repoRoot, 'packages/syntax/test');
/** Every file under `directory` (absolute) whose name passes `filter`, sorted. */
export function filesUnder(directory, filter = name => name.endsWith('.cs')) {
  const out = [], visit = dir => { for (const entry of readdirSync(dir).sort()) { const path = join(dir, entry); if (statSync(path).isDirectory()) { if (!['node_modules', '.git', 'bin', 'obj', 'dist', 'artifacts', '.scratch', '.claude'].includes(entry)) visit(path); } else if (filter(entry)) out.push(path); } };
  if (existsSync(directory)) visit(directory); return out;
}
/** Parse options from a `// roslyn: langversion=11 define=A;B kind=script` first line; Roslyn defaults otherwise. */
export function fixtureOptions(text) {
  const options = { fileBasedProgram: false }, first = text.split('\n')[0];
  if (first.startsWith('// roslyn:')) for (const setting of first.slice(10).trim().split(/\s+/)) {
    const [key, value] = setting.split('=');
    if (key === 'langversion') options.languageVersion = value; else if (key === 'doc' && value === 'diagnose') options.documentationMode = 'diagnose'; else if (key === 'define') options.preprocessorSymbols = value.split(';'); else if (key === 'kind' && value === 'script') options.script = true;
    // `gates=binder`: Roslyn reports this fixture's language-version errors while binding, so its parse-only dump has none.
    else if (key === 'gates' && value === 'binder') options.gatesFromBinder = true;
  }
  return options;
}
const valueTypes = { int: 'Int32', uint: 'UInt32', long: 'Int64', ulong: 'UInt64', float: 'Single', double: 'Double', decimal: 'Decimal' };
/** Compares a token's value with the Roslyn dump entry [kind, start, end, text, valueType, value]; returns a problem string or null. */
export function compareTokenValue(token, reference) {
  const [kind, , , text, type, value] = reference;
  if (token.text !== text) return `text ${JSON.stringify(token.text)} != ${JSON.stringify(text)}`;
  if (kind === 'NumericLiteralToken') {
    const literal = token.value;
    if (valueTypes[literal.type] !== type) return `${text}: type ${literal.type} != ${type}`;
    if (type === 'Decimal') return decimalToString(literal.value) === value ? null : `${text}: decimal ${decimalToString(literal.value)} != ${value}`;
    if (type === 'Single') return Math.fround(Number(value)) === literal.value ? null : `${text}: float ${literal.value} != ${value}`;
    if (type === 'Double') return Number(value) === literal.value ? null : `${text}: double ${literal.value} != ${value}`;
    return String(literal.value) === value ? null : `${text}: integer ${literal.value} != ${value}`;
  }
  if (kind === 'IdentifierToken' || kind === 'CharacterLiteralToken' || kind.endsWith('StringLiteralToken') || kind === 'InterpolatedStringTextToken') return token.value === value ? null : `${text}: value ${JSON.stringify(token.value)} != ${JSON.stringify(value)}`;
  return null;
}
/**
 * Compares a SharpForge tree with a Roslyn dump: node and token kinds, spans, leading/trailing trivia kinds and spans,
 * token text and values, error codes, and the structure of documentation comment trivia (which Roslyn positions
 * relative to the comment, so its offsets are shifted onto the trivia). Returns a list of problems (empty when the trees agree).
 */
export function compareWithReference(tree, reference, text, limit = 8) {
  const problems = [], path = [];
  const firstOffset = node => { while (Array.isArray(node[3])) node = node[3][0]; return node[6].length ? node[6][0][1] : node[1]; };
  const visit = (mine, theirs, shift = 0) => {
    if (problems.length >= limit) return;
    const isNode = Array.isArray(theirs[3]), start = theirs[1] + shift, end = theirs[2] + shift, where = () => `${path.join('/')} @${start}..${end} ${JSON.stringify(text.slice(start, Math.min(end, start + 40)))}`;
    const span = mine.span;
    if (mine.kind !== theirs[0]) { problems.push(`kind ${mine.kind} != ${theirs[0]} at ${where()}`); return; }
    // Roslyn reports the spans of nodes inside a structured trivia without the leading comment exterior; token spans are exact.
    if ((span.start !== start || span.end !== end) && !(shift && isNode)) { problems.push(`span of ${mine.kind} ${span.start}..${span.end} != ${start}..${end} at ${where()}`); return; }
    if (!isNode) {
      const trivia = list => JSON.stringify(list.map(t => [t.kind, t.span.start, t.span.end])), reference = list => JSON.stringify(list.map(t => [t[0], t[1] + shift, t[2] + shift]));
      if (trivia(mine.leadingTrivia) !== reference(theirs[6])) problems.push(`leading trivia ${trivia(mine.leadingTrivia)} != ${reference(theirs[6])} at ${where()}`);
      if (trivia(mine.trailingTrivia) !== reference(theirs[7])) problems.push(`trailing trivia ${trivia(mine.trailingTrivia)} != ${reference(theirs[7])} at ${where()}`);
      if (mine.isMissing !== theirs[8]) problems.push(`missing flag differs at ${where()}`);
      const value = compareTokenValue(mine, theirs); if (value) problems.push(`${value} at ${where()}`);
      const all = [...mine.leadingTrivia, ...mine.trailingTrivia]; [...theirs[6], ...theirs[7]].forEach((entry, index) => {
        if (!entry[3] || !all[index]) return; const structure = all[index].structure;
        if (!structure || !structure.isNode) { problems.push(`no documentation structure at ${where()}`); return; }
        path.push('#doc'); visit(structure, entry[3], entry[1] + shift - firstOffset(entry[3])); path.pop();
      });
      return;
    }
    const children = mine.childNodesAndTokens(); path.push(theirs[0]);
    if (children.length !== theirs[3].length) problems.push(`children [${children.map(c => c.kind).join(' ')}] != [${theirs[3].map(c => c[0]).join(' ')}] in ${where()}`);
    else for (let i = 0; i < children.length; i++) visit(children[i], theirs[3][i], shift);
    path.pop();
  };
  visit(tree.root, reference.tree);
  // Error codes and the offsets they are reported at; several errors at one offset are compared as a set.
  const errors = list => list.sort().join(' ');
  // Errors Roslyn only reports while binding (boundPhaseCodes) cannot appear in its parse-only diagnostics.
  const skipped = code => boundPhaseCodes.has(code) || (tree.options?.gatesFromBinder && gateCodes.has(code));
  const parseErrors = tree.getDiagnostics().filter(d => d.severity === 'error' && !skipped(d.code));
  const mine = errors(parseErrors.map(d => `${d.code}@${d.start}`));
  const theirs = errors(reference.diagnostics.filter(d => d[3] === 'error').map(d => `${d[0]}@${d[1]}`));
  if (mine !== theirs) problems.push(`errors [${mine}] != [${theirs}]`);
  return problems;
}
/** Parses a fixture with the options Roslyn used for its reference dump and returns { text, tree, reference }. */
export function loadReferenceFixture(file) {
  const text = readFileSync(file, 'utf8'), reference = JSON.parse(readFileSync(file + '.json', 'utf8'));
  return { text, reference, tree: SyntaxTree.parseText(text, fixtureOptions(text)) };
}
/** Tracked C# sources in the repository (examples, templates and the syntax fixtures). */
export function repositorySources() {
  return [...filesUnder(join(repoRoot, 'examples')), ...filesUnder(join(repoRoot, 'packages/templates')), ...filesUnder(join(repoRoot, 'apps')), ...filesUnder(fixtureRoot)].map(file => ({ name: file.slice(repoRoot.length).replaceAll('\\', '/'), text: readFileSync(file, 'utf8') }));
}
/**
 * Asserts that the fixture at `relative` (under packages/syntax/test) has a pinned Roslyn dump and that SharpForge
 * produces the same tree. Returns { text, tree, kinds } where `kinds` is the set of node kinds in the tree.
 */
export function assertMatchesRoslyn(relative) {
  const file = join(fixtureRoot, relative); assert(existsSync(file + '.json'), 'no Roslyn dump for ' + relative);
  const { text, tree, reference } = loadReferenceFixture(file);
  assert.equal(reference.length, text.length, relative + ': dump is current'); assert.equal(tree.toFullString(), text); assert(matchesGrammar(tree.green), relative);
  assert.deepEqual(compareWithReference(tree, reference, text), [], relative);
  return { text, tree, kinds: new Set([...tree.root.descendantNodes(true)].map(node => node.kind)) };
}
/** `code@offset text` for every diagnostic of a parse of `text` at `languageVersion` (undefined parses without gating). */
export function diagnosticsOf(text, languageVersion, options = {}) {
  const tree = SyntaxTree.parseText(text, { ...options, languageVersion }); assert.equal(tree.toFullString(), text);
  return tree.getDiagnostics().map(d => `${d.code}@${d.start} ${JSON.stringify(text.slice(d.start, d.start + d.length))}`);
}
/** One line per node: the shape of a red node as `Kind(children)` with token text. */
export function shapeOf(node) { return node.isToken ? (node.isMissing ? '<' + node.kind + '>' : node.text) : `${node.kind}(${node.childNodesAndTokens().map(shapeOf).join(' ')})`; }
/** The statements of `body` parsed inside a method of a class. */
export function statementsOf(body, options) {
  return SyntaxTree.parseText(`class C { void M() { ${body} } }`, options).root.members[0].members[0].body.statements;
}
/** The red node of expression `text`, parsed as the initializer of a local. */
export function expressionOf(text, options) {
  return statementsOf(`var _ = ${text};`, options)[0].declaration.variables[0].initializer.value;
}
/** The members of `class C { text }`. */
export function classMembersOf(text, options) {
  return SyntaxTree.parseText(`class C { ${text} }`, options).root.members[0].members;
}
/** The diagnostic codes of a parse of `text` at `languageVersion`. */
export function codesOf(text, languageVersion, options) {
  return diagnosticsOf(text, languageVersion, options).map(entry => entry.split('@')[0]);
}
/**
 * Asserts that a malformed fixture recovers exactly as Roslyn does (same tree, missing tokens and error codes) and
 * that it reports at least one error. Returns what assertMatchesRoslyn returns.
 */
export function assertRecoversLikeRoslyn(relative) {
  const result = assertMatchesRoslyn(relative);
  assert(result.tree.getDiagnostics().length > 0, relative + ' reports errors');
  return result;
}
// Every code the feature gate can report: one per catalog row plus CS8703, the 'modifier is not valid in C# n' form.
const gateCodes = new Set([...languageFeatures.map(row => row.code).filter(Boolean), 'CS8703']);
/**
 * Asserts that the language-version diagnostics SharpForge reports for `relative` (a `*.rejected.cs` file under
 * packages/syntax/test, whose first line names the language version) are the ones Roslyn reports when compiling the
 * file: the same codes over the same spans. Other Roslyn errors (unbound names and so on) are not syntax and are ignored.
 * `binderOnly` lists the language-version diagnostics in the file that cannot be decided from syntax (they need a
 * bound symbol); Roslyn must report each of them and SharpForge's parser must not.
 * Returns the agreed list as `code@start..end` strings.
 */
export function assertGatesMatchRoslyn(relative, binderOnly = []) {
  const file = join(fixtureRoot, relative), text = readFileSync(file, 'utf8');
  assert(existsSync(file + '.roslyn.json'), 'no Roslyn compile diagnostics for ' + relative);
  const recorded = JSON.parse(readFileSync(file + '.roslyn.json', 'utf8'));
  const reported = recorded.errors.filter(entry => gateCodes.has(entry[0])).map(entry => `${entry[0]}@${entry[1]}..${entry[2]}`);
  for (const entry of binderOnly) assert(reported.includes(entry), `${relative}: Roslyn does not report ${entry}`);
  const theirs = reported.filter(entry => !binderOnly.includes(entry));
  const tree = SyntaxTree.parseText(text, { languageVersion: recorded.langversion });
  const mine = tree.getDiagnostics().filter(d => gateCodes.has(d.code)).map(d => `${d.code}@${d.start}..${d.start + d.length}`);
  assert.deepEqual(mine, theirs, relative);
  return mine;
}
