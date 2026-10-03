import { SourceText, diagnostic } from '@sharpforge/text';
import { lex } from './lexer/scanner.js';
import { createNode } from './red.js';
import { slotNames } from './generated/nodes.js';
import { toLegacyTree, toLegacyExpression } from './legacy-adapter.js';
import { checkFeatures } from './feature-gate.js';
import { Parser } from './parser/core.js';
import { typeMethods } from './parser/types.js';
import { modifierMethods } from './parser/modifiers.js';
import { statementMethods } from './parser/statements.js';
import { expressionMethods } from './parser/expressions.js';
import { namespaceMethods } from './parser/declarations/namespaces.js';
import { typeDeclarationMethods } from './parser/declarations/types.js';
import { enumMethods } from './parser/declarations/enums.js';
import { delegateMethods } from './parser/declarations/delegates.js';
import { memberMethods } from './parser/declarations/members.js';
import { attributeMethods } from './parser/declarations/attributes.js';
import { eventMethods } from './parser/declarations/events.js';
import { operatorMethods } from './parser/declarations/operators.js';
import { constructorMethods } from './parser/declarations/constructors.js';
import { typeParameterMethods } from './parser/declarations/type-parameters.js';
import { anonymousFunctionMethods } from './parser/expressions/anonymous-functions.js';
import { lambdaMethods } from './parser/expressions/lambdas.js';
import { queryMethods } from './parser/expressions/queries.js';
import { tupleMethods } from './parser/expressions/tuples.js';
import { nullabilityMethods } from './parser/expressions/nullability.js';
import { genericNameMethods } from './parser/expressions/generic-names.js';
import { basicPatternMethods } from './parser/patterns/basic.js';
import { recursivePatternMethods } from './parser/patterns/recursive.js';
import { combinatorPatternMethods } from './parser/patterns/combinators.js';
import { listPatternMethods } from './parser/patterns/lists.js';
import { recordMethods } from './parser/declarations/records.js';
import { recordStructMethods } from './parser/declarations/record-structs.js';
import { withMethods } from './parser/expressions/with.js';
import { accessorMethods } from './parser/declarations/accessors.js';
import { propertyMethods } from './parser/declarations/properties.js';
import { primaryConstructorMethods } from './parser/declarations/primary-constructors.js';
import { partialMemberMethods } from './parser/declarations/partial-members.js';
import { typeModifierMethods } from './parser/declarations/type-modifiers.js';
import { extensionMethods } from './parser/declarations/extensions.js';
import { modernOperatorMethods } from './parser/declarations/operators-modern.js';
import { extensionIndexerMethods } from './parser/declarations/extension-indexers.js';
import { unionMethods } from './parser/declarations/unions.js';
import { closedMethods } from './parser/declarations/closed.js';
import { safetyModifierMethods } from './parser/declarations/safety-modifiers.js';
Object.assign(Parser.prototype, typeMethods, modifierMethods, statementMethods, expressionMethods, namespaceMethods, typeDeclarationMethods, enumMethods, delegateMethods, memberMethods, attributeMethods, eventMethods,
  operatorMethods, constructorMethods, typeParameterMethods, anonymousFunctionMethods, lambdaMethods, queryMethods, tupleMethods, nullabilityMethods, genericNameMethods, basicPatternMethods, recursivePatternMethods, combinatorPatternMethods, listPatternMethods,
  recordMethods, recordStructMethods, withMethods, accessorMethods, propertyMethods, primaryConstructorMethods, partialMemberMethods, typeModifierMethods, extensionMethods, modernOperatorMethods, extensionIndexerMethods, unionMethods,
  closedMethods, safetyModifierMethods);
export { Parser };
export { nestingBudget } from './parser/budget.js';
const asSource = source => typeof source === 'string' ? new SourceText(source) : source;
const byPosition = (a, b) => a.start - b.start;
/**
 * Parses lexed tokens into a lossless green CompilationUnit.
 * Returns { green, diagnostics, features, nodeCount }; `diagnostics` holds lexical and syntax errors only.
 */
export function parseCompilationUnit(lexed, options = {}) {
  const parser = new Parser(lexed, options), green = parser.compilationUnit();
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
  const lexed = lex(source, cache, options), parsed = parseCompilationUnit(lexed, { ...options, cache }), diagnostics = [...parsed.diagnostics, ...lexed.profileDiagnostics];
  const syntax = createNode(parsed.green, null, 0), report = (start, end, code, message) => { if (diagnostics.length < 400) diagnostics.push(diagnostic(source, start, Math.max(1, end - start), code, message)); };
  const root = toLegacyTree(syntax, source, lexed.tokens, report);
  if (options.languageVersion !== undefined) diagnostics.push(...checkFeatures(source, parsed.features, options.languageVersion));
  diagnostics.sort(byPosition);
  return { source, tokens: lexed.tokens, root, diagnostics, internedTokenHits: lexed.internedTokenHits, nodeCount: parsed.nodeCount, green: parsed.green, syntax, features: parsed.features, directives: lexed.directives };
}
/** Parses a standalone expression into the legacy AST: { expression, diagnostics, syntax }. */
export function parseExpression(text) {
  const source = new SourceText(text, '<expression>'), lexed = lex(source), parser = new Parser(lexed), green = parser.expression();
  if (!parser.at('eof')) parser.error(parser.current, 'CS1003', 'Unexpected trailing input');
  const diagnostics = [...parser.diagnostics, ...lexed.profileDiagnostics], syntax = createNode(green, null, 0);
  const expression = toLegacyExpression(syntax, source, (start, end, code, message) => diagnostics.push(diagnostic(source, start, Math.max(1, end - start), code, message)));
  return { expression, diagnostics, syntax };
}
/** Depth-first visit of every legacy AST node (objects with a `kind`). For the lossless tree use SyntaxWalker. */
export function walk(node, visit) { if(!node||typeof node!=='object')return; if(node.kind)visit(node);for(const [key,value] of Object.entries(node)){if(['source','tokens','nameSpan','symbol'].includes(key))continue;if(Array.isArray(value))for(const v of value)walk(v,visit);else if(value&&typeof value==='object')walk(value,visit);} }
/** True when every node under `green` has exactly the child slots its grammar entry declares. */
export function matchesGrammar(green) {
  const stack = [green];
  while (stack.length) { const node = stack.pop(); if (!node || !node.isNode) continue; if (!node.isList && slotNames[node.kind]?.length !== node.children.length) return false; for (const child of node.children) stack.push(child); }
  return true;
}
