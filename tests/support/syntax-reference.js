/** Helpers for the syntax fixture suites: fixture discovery, Roslyn reference comparison and source corpora. */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SyntaxTree, decimalToString } from '@sharpforge/syntax';
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
    if (key === 'langversion') options.languageVersion = value; else if (key === 'define') options.preprocessorSymbols = value.split(';'); else if (key === 'kind' && value === 'script') options.script = true;
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
 * token text and values, and error codes. Returns a list of problems (empty when the trees agree).
 */
export function compareWithReference(tree, reference, text, limit = 8) {
  const problems = [], path = [];
  const visit = (mine, theirs) => {
    if (problems.length >= limit) return;
    const isNode = Array.isArray(theirs[3]), where = () => `${path.join('/')} @${theirs[1]}..${theirs[2]} ${JSON.stringify(text.slice(theirs[1], Math.min(theirs[2], theirs[1] + 40)))}`;
    const span = mine.span;
    if (mine.kind !== theirs[0]) { problems.push(`kind ${mine.kind} != ${theirs[0]} at ${where()}`); return; }
    if (span.start !== theirs[1] || span.end !== theirs[2]) { problems.push(`span of ${mine.kind} ${span.start}..${span.end} != ${theirs[1]}..${theirs[2]} at ${where()}`); return; }
    if (!isNode) {
      const trivia = list => JSON.stringify(list.map(t => [t.kind, t.span.start, t.span.end]));
      if (trivia(mine.leadingTrivia) !== JSON.stringify(theirs[6])) problems.push(`leading trivia ${trivia(mine.leadingTrivia)} != ${JSON.stringify(theirs[6])} at ${where()}`);
      if (trivia(mine.trailingTrivia) !== JSON.stringify(theirs[7])) problems.push(`trailing trivia ${trivia(mine.trailingTrivia)} != ${JSON.stringify(theirs[7])} at ${where()}`);
      if (mine.isMissing !== theirs[8]) problems.push(`missing flag differs at ${where()}`);
      const value = compareTokenValue(mine, theirs); if (value) problems.push(`${value} at ${where()}`);
      return;
    }
    const children = mine.childNodesAndTokens(); path.push(theirs[0]);
    if (children.length !== theirs[3].length) problems.push(`children [${children.map(c => c.kind).join(' ')}] != [${theirs[3].map(c => c[0]).join(' ')}] in ${where()}`);
    else for (let i = 0; i < children.length; i++) visit(children[i], theirs[3][i]);
    path.pop();
  };
  visit(tree.root, reference.tree);
  const errors = list => list.sort().join(' '), mine = errors(tree.getDiagnostics().filter(d => d.severity === 'error').map(d => d.code)), theirs = errors(reference.diagnostics.filter(d => d[3] === 'error').map(d => d[0]));
  if (mine !== theirs) problems.push(`error codes [${mine}] != [${theirs}]`);
  return problems;
}
/** Parses a fixture with the options Roslyn used for its reference dump and returns { text, tree, reference }. */
export function loadReferenceFixture(file) {
  const text = readFileSync(file, 'utf8'), reference = JSON.parse(readFileSync(file + '.json', 'utf8'));
  return { text, reference, tree: SyntaxTree.parseText(text, fixtureOptions(text)) };
}
/** Tracked C# sources in the repository (examples, templates and the syntax fixtures). */
export function repositorySources() {
  return [...filesUnder(join(repoRoot, 'examples')), ...filesUnder(join(repoRoot, 'packages/templates')), ...filesUnder(join(repoRoot, 'apps')), ...filesUnder(fixtureRoot)].map(file => ({ name: file.slice(repoRoot.length), text: readFileSync(file, 'utf8') }));
}
