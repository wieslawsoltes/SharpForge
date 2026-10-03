import { SourceText, diagnostic } from '@sharpforge/text';
import { lex } from './lexer/scanner.js';
import { createNode } from './red.js';
import { slotNames } from './generated/nodes.js';
import { toLegacyTree, toLegacyExpression } from './legacy-adapter.js';
import { checkFeatures } from './feature-gate.js';
import { Parser } from './parser/core.js';
import { parserModules } from './parser/modules.js';
// Each grammar family is a module of parser methods; parser/modules.js is the one list they are registered in.
for (const methods of parserModules) Object.assign(Parser.prototype, methods);
export { Parser };
export { nestingBudget } from './parser/budget.js';
const asSource = source => (typeof source === 'string' ? new SourceText(source) : source);
const byPosition = (a, b) => a.start - b.start;
/**
 * Parses lexed tokens into a lossless green CompilationUnit.
 * Returns { green, diagnostics, features, nodeCount }; `diagnostics` holds lexical and syntax errors only.
 */
export function parseCompilationUnit(lexed, options = {}) {
  const parser = new Parser(lexed, options),
    green = parser.compilationUnit();
  return { green, diagnostics: parser.diagnostics, features: parser.features, nodeCount: parser.nodeCount, reusedNodes: parser.blend?.reused ?? 0 };
}
/**
 * Parses C# source. The result keeps the shape existing consumers rely on - { source, tokens, root, diagnostics,
 * internedTokenHits, nodeCount } with `root` the plain AST produced by the legacy adapter - and adds the lossless
 * tree: `green` (GreenNode), `syntax` (red CompilationUnit) and `features` (language-feature uses).
 * Options: `languageVersion` gates features at parse time, `preprocessorSymbols`, `script`, `cancellationToken`.
 */
export function parse(source, cache, options = {}) {
  source = asSource(source);
  const lexed = lex(source, cache, options),
    // The back end runs top-level statements wherever they stand and checks the `field` keyword itself, so by default
    // the legacy entry point leaves CS8803, CS9258 and CS9273 out (`backEndProfile: false` reports them).
    parsed = parseCompilationUnit(lexed, { backEndProfile: true, ...options, cache }),
    diagnostics = [...parsed.diagnostics, ...lexed.profileDiagnostics];
  const syntax = createNode(parsed.green, null, 0),
    report = (start, end, code, message) => {
      if (diagnostics.length < 400) diagnostics.push(diagnostic(source, start, Math.max(1, end - start), code, message));
    };
  const root = toLegacyTree(syntax, source, lexed.tokens, report);
  if (options.languageVersion !== undefined) diagnostics.push(...checkFeatures(source, parsed.features, options.languageVersion));
  diagnostics.sort(byPosition);
  return {
    source,
    tokens: lexed.tokens,
    root,
    diagnostics,
    internedTokenHits: lexed.internedTokenHits,
    nodeCount: parsed.nodeCount,
    green: parsed.green,
    syntax,
    features: parsed.features,
    directives: lexed.directives
  };
}
/** Parses a standalone expression into the legacy AST: { expression, diagnostics, syntax }. */
export function parseExpression(text) {
  const source = new SourceText(text, '<expression>'),
    lexed = lex(source),
    parser = new Parser(lexed),
    green = parser.expression();
  if (!parser.at('eof')) parser.error(parser.current, 'CS1003', 'Unexpected trailing input');
  const diagnostics = [...parser.diagnostics, ...lexed.profileDiagnostics],
    syntax = createNode(green, null, 0);
  const expression = toLegacyExpression(syntax, source, (start, end, code, message) =>
    diagnostics.push(diagnostic(source, start, Math.max(1, end - start), code, message))
  );
  return { expression, diagnostics, syntax };
}
/** Depth-first visit of every legacy AST node (objects with a `kind`). For the lossless tree use SyntaxWalker. */
export function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (node.kind) visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (['source', 'tokens', 'nameSpan', 'symbol'].includes(key)) continue;
    if (Array.isArray(value)) for (const v of value) walk(v, visit);
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
/** True when every node under `green` has exactly the child slots its grammar entry declares. */
export function matchesGrammar(green) {
  const stack = [green];
  while (stack.length) {
    const node = stack.pop();
    if (!node || !node.isNode) continue;
    if (!node.isList && slotNames[node.kind]?.length !== node.children.length) return false;
    for (const child of node.children) stack.push(child);
  }
  return true;
}
