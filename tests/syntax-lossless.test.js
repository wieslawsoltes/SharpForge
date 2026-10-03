import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { SyntaxTree, SyntaxKind, syntaxKindName, tokenKindNames, triviaKindNames, nodeKindNames, isNodeKind, isTokenKind, GreenNode, GreenToken, GreenTrivia, GreenCache, GreenFlags, SyntaxNode, SyntaxToken, slotNames, slotTypes, SyntaxFactory,
  SyntaxVisitor, SyntaxWalker, SyntaxWalkerDepth, SyntaxRewriter, greenToken, matchesGrammar, parse, reservedKeywordKinds, contextualKeywordKinds, punctuationKinds, IfStatementSyntax, BinaryExpressionSyntax } from '@sharpforge/syntax';
import { BoundedCache, SourceText } from '@sharpforge/text';
import { repoRoot, fixtureRoot, filesUnder, repositorySources } from './support/syntax-reference.js';

const sources = repositorySources();
const BOM = String.fromCharCode(0xFEFF), NEL = String.fromCharCode(0x85), LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
// ---- SF-A01-T02.2: SyntaxKind ---------------------------------------------------------------------------------------
test('kinds: numeric ids are frozen by the snapshot', () => {
  const snapshot = JSON.parse(readFileSync(join(repoRoot, 'tests/fixtures/syntax-kinds.snapshot.json'), 'utf8'));
  for (const [name, id] of Object.entries(snapshot)) assert.equal(SyntaxKind[name], id, `${name} changed id; the kind lists are append-only`);
  assert.equal(new Set(Object.values(SyntaxKind)).size, Object.keys(SyntaxKind).length, 'ids are unique');
  assert.equal(SyntaxKind.None, 0); assert.equal(syntaxKindName(SyntaxKind.IfStatement), 'IfStatement'); assert.equal(SyntaxKind.TildeToken, 8193);
});
test('kinds: every token, keyword and grammar node kind is enumerated', () => {
  for (const kind of [...Object.values(punctuationKinds), ...Object.values(reservedKeywordKinds), ...Object.values(contextualKeywordKinds)]) assert(isTokenKind(kind), kind);
  for (const kind of Object.keys(slotNames)) assert(isNodeKind(kind), kind);
  assert(tokenKindNames.length > 200 && triviaKindNames.length > 25 && nodeKindNames.length > 250);
  const tree = SyntaxTree.parseText(sources.map(s => s.text).join('\n'));
  for (const item of tree.root.descendantNodesAndTokens(true)) { assert(SyntaxKind[item.kind] > 0, item.kind); if (item.isToken) for (const trivia of [...item.leadingTrivia, ...item.trailingTrivia]) assert(SyntaxKind[trivia.kind] > 0, trivia.kind); }
});
// ---- SF-A01-T02.3: green nodes --------------------------------------------------------------------------------------
test('green: full width equals source length for every fixture and all elements are immutable', () => {
  assert(sources.length > 250, String(sources.length));
  for (const { name, text } of sources) {
    const tree = SyntaxTree.parseText(text); assert.equal(tree.green.fullWidth, text.length, name); assert(tree.green instanceof GreenNode); assert(Object.isFrozen(tree.green) && Object.isFrozen(tree.green.children));
    let width = 0; for (const token of tree.root.descendantTokens()) { assert(token.green instanceof GreenToken && Object.isFrozen(token.green)); assert.equal(token.green.fullWidth, token.green.leadingWidth + token.green.width + token.green.trailingWidth); width += token.green.fullWidth; }
    assert.equal(width, text.length, name);
  }
});
test('green: identical subtrees, tokens and trivia are shared', () => {
  const tree = SyntaxTree.parseText('class C { void M() { f(x + y); g(x + y); h(x + y); } }'), sums = [...tree.root.descendantNodes()].filter(n => n.kind === 'AddExpression');
  assert.equal(sums.length, 3); assert.equal(sums[0].green, sums[1].green); assert.equal(sums[1].green, sums[2].green); assert.notEqual(sums[0], sums[1]); assert.notEqual(sums[0].position, sums[1].position);
  const spaces = [...tree.root.descendantTokens()].flatMap(t => t.green.trailing).filter(t => t.text === ' '); assert(spaces.length > 5); assert(spaces.every(t => t === spaces[0]) && spaces[0] instanceof GreenTrivia);
  const cache = new BoundedCache(65536), a = SyntaxTree.parseText('int x = 1; int y = 2;', { cache }), b = SyntaxTree.parseText('int x = 1; int z = 3;', { cache });
  assert.equal(a.root.members[0].green, b.root.members[0].green, 'unchanged statement is shared between trees'); assert.notEqual(a.root.members[1].green, b.root.members[1].green);
  assert(GreenCache.for(cache).hits > 0); assert.equal(GreenCache.for(cache), GreenCache.for(cache));
});
test('green: missing tokens are zero-width and flagged', () => {
  const tree = SyntaxTree.parseText('int x = 1'), missing = [...tree.root.descendantTokens()].filter(t => t.isMissing);
  assert.deepEqual(missing.map(t => [t.kind, t.green.fullWidth]), [['SemicolonToken', 0]]); assert(missing[0].green.flags & GreenFlags.Missing); assert(tree.green.flags & GreenFlags.ContainsMissing);
  assert.equal(SyntaxTree.parseText('int x = 1;').green.flags & GreenFlags.ContainsMissing, 0);
});
// ---- SF-A01-T02.4: red facade ---------------------------------------------------------------------------------------
test('red: findToken returns the right token for every offset of a 100 KB file and parent chains are consistent', () => {
  let text = ''; for (const { text: part } of sources) { text += part + '\n'; if (text.length > 100 * 1024) break; }
  assert(text.length > 100 * 1024);
  const tree = SyntaxTree.parseText(text), root = tree.root, tokens = [...root.descendantTokens()];
  let index = 0;
  for (let offset = 0; offset < text.length; offset++) { while (offset >= tokens[index].fullSpan.end) index++; const found = root.findToken(offset); if (found !== tokens[index]) assert.fail(`findToken(${offset}) returned ${found.kind}@${found.position}, expected ${tokens[index].kind}@${tokens[index].position}`); }
  assert.equal(root.findToken(text.length), tokens.at(-1)); assert.equal(tokens.at(-1).kind, 'EndOfFileToken'); assert.throws(() => root.findToken(text.length + 1), RangeError);
  let position = 0;
  for (const item of root.descendantNodesAndTokens()) {
    assert(item.parent.childNodesAndTokens().includes(item)); assert(item.fullSpan.start >= item.parent.fullSpan.start && item.fullSpan.end <= item.parent.fullSpan.end);
    if (item.isToken) { assert.equal(item.position, position); position += item.green.fullWidth; assert.equal(text.slice(item.span.start, item.span.end), item.text); for (const ancestor of item.parent.ancestors()) assert(ancestor.isNode); }
    else { assert(item instanceof SyntaxNode); assert.equal(item.root, root); assert.equal(item.toFullString(), text.slice(item.fullSpan.start, item.fullSpan.end)); }
  }
  assert.equal(position, text.length);
});
test('red: spans exclude trivia, lists are transparent and slots have typed accessors', () => {
  const tree = SyntaxTree.parseText('  /* c */ if (a) { b(); } // t\n'), statement = tree.root.members[0].statement;
  assert(statement instanceof IfStatementSyntax); assert.deepEqual(statement.span, { start: 10, end: 25 }); assert.deepEqual(statement.fullSpan, { start: 0, end: 31 }); assert.equal(statement.toString(), 'if (a) { b(); }');
  assert.equal(statement.ifKeyword.kind, 'IfKeyword'); assert(statement.ifKeyword instanceof SyntaxToken); assert.equal(statement.condition.kind, 'IdentifierName'); assert.equal(statement.else, null); assert.deepEqual(statement.attributeLists, []);
  const block = statement.statement; assert.equal(block.statements.length, 1); assert.equal(block.statements[0].parent, block, 'a list element is parented by the node that owns the list');
  assert.equal(statement.firstToken().text, 'if'); assert.equal(statement.lastToken().text, '}'); assert.equal(tree.root.findNode(19, 20).kind, 'IdentifierName');
  assert.deepEqual(statement.ifKeyword.leadingTrivia.map(t => [t.kind, t.span.start, t.span.end]), [['WhitespaceTrivia', 0, 2], ['MultiLineCommentTrivia', 2, 9], ['WhitespaceTrivia', 9, 10]]);
  const call = SyntaxTree.parseText('f(a, b, c);').root.members[0].statement.expression; assert.deepEqual(call.argumentList.arguments.map(a => a.toString()), ['a', 'b', 'c']); assert.equal(call.argumentList.separators(1).length, 2);
});
// ---- SF-A01-T02.5: trivia -------------------------------------------------------------------------------------------
test('trivia: token full texts reproduce the input byte-for-byte including a BOM and every line ending', () => {
  const text = BOM + 'int a = 1;\r\nint b = 2;\rint c = 3;\nint d = 4;' + NEL + 'int e = 5;' + LS + 'int f = 6;' + PS + '// end\r\n\t /* x */ ';
  const tree = SyntaxTree.parseText(text), tokens = [...tree.root.descendantTokens()];
  assert.equal(tokens.map(t => t.toFullString()).join(''), text); assert.equal(tree.getDiagnostics().length, 0);
  const trivia = tokens.flatMap(t => [...t.leadingTrivia, ...t.trailingTrivia]);
  assert.deepEqual(trivia.filter(t => t.kind === 'EndOfLineTrivia').map(t => t.text), ['\r\n', '\r', '\n', NEL, LS, PS, '\r\n']);
  assert.equal(tokens[0].leadingTrivia[0].kind, 'WhitespaceTrivia'); assert.equal(tokens[0].leadingTrivia[0].text, BOM);
  assert.equal(trivia.map(t => t.text).join('').length + tokens.reduce((n, t) => n + t.text.length, 0), text.length);
});
test('trivia: Roslyn attachment rules', () => {
  const kinds = list => list.map(t => t.kind.replace('Trivia', '')), tree = SyntaxTree.parseText('a(); // one\n// two\n\n  /* three */ b(); /** doc */ c(); /// d1\n  /// d2\nd();'), tokens = [...tree.root.descendantTokens()], at = text => tokens.find(t => t.text === text);
  const semicolons = tokens.filter(t => t.text === ';');
  assert.deepEqual(kinds(semicolons[0].trailingTrivia), ['Whitespace', 'SingleLineComment', 'EndOfLine'], 'trailing trivia runs through the end of the line');
  assert.deepEqual(kinds(at('b').leadingTrivia), ['SingleLineComment', 'EndOfLine', 'EndOfLine', 'Whitespace', 'MultiLineComment', 'Whitespace']);
  assert.deepEqual(kinds(semicolons[1].trailingTrivia), ['Whitespace'], 'a documentation comment never trails a token'); assert.deepEqual(kinds(at('c').leadingTrivia), ['MultiLineDocumentationComment', 'Whitespace']);
  assert.deepEqual(kinds(at('d').leadingTrivia), ['SingleLineDocumentationComment']); assert.equal(at('d').leadingTrivia[0].text, '/// d1\n  /// d2\n', 'consecutive /// lines form one trivia');
});
// ---- SF-A01-T02.6: recovery -----------------------------------------------------------------------------------------
test('recovery: 500 truncated and malformed inputs round-trip without losing a character', () => {
  let seed = 0x5EED; const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const junk = ['(', ')', '{', '}', '[', ']', ';', ',', '.', '=', '?', ':', '<', '>', '"', "'", '$"', '"""', '#if X\n', '/*', 'class ', 'new ', 'is ', 'switch ', '=>', 'namespace ', 'from x in ', '@', '\\', 'delegate ', 'var (', '\r\n'];
  const bases = sources.filter(s => s.text.length > 200);
  for (let n = 0; n < 500; n++) {
    const base = bases[random(bases.length)].text, at = random(base.length + 1), mode = n % 4; let text;
    if (mode === 0) text = base.slice(0, at); else if (mode === 1) text = base.slice(0, at) + base.slice(at + random(40)); else if (mode === 2) text = base.slice(0, at) + junk[random(junk.length)] + base.slice(at);
    else { text = base; for (let k = 0; k < 6; k++) { const p = random(text.length + 1); text = text.slice(0, p) + junk[random(junk.length)] + text.slice(p + random(3)); } }
    const tree = SyntaxTree.parseText(text);
    if (tree.toFullString() !== text) assert.fail(`input ${n} lost text: ${JSON.stringify(text.slice(Math.max(0, at - 40), at + 40))}`);
    assert(matchesGrammar(tree.green), 'input ' + n); assert(tree.getDiagnostics().length <= 400); assert.equal(parse(text).green.fullText, text);
  }
});
test('recovery: missing tokens are inserted and unexpected tokens become skipped-token trivia', () => {
  const tree = SyntaxTree.parseText('class A { static void Main( { int x = ; Console.WriteLine(x) } ) ] class B { }'), tokens = [...tree.root.descendantTokens()];
  assert.equal(tree.toFullString(), 'class A { static void Main( { int x = ; Console.WriteLine(x) } ) ] class B { }');
  assert(tokens.filter(t => t.isMissing).map(t => t.kind).includes('CloseParenToken')); assert(tokens.some(t => t.isMissing && t.kind === 'SemicolonToken'));
  const skipped = tokens.flatMap(t => t.leadingTrivia).filter(t => t.kind === 'SkippedTokensTrivia'); assert(skipped.length >= 1); assert(skipped.map(t => t.text).join('').includes(']'));
  assert(tree.green.flags & GreenFlags.ContainsSkippedText); assert.deepEqual([...tree.root.descendantNodes()].filter(n => n.kind === 'ClassDeclaration').map(n => n.identifier.text), ['A', 'B'], 'parsing resumes after the damage');
  assert(tree.getDiagnostics().length > 0 && !tree.root.descendantNodes().next().done); assert.equal([...tree.root.descendantNodes()].some(n => n.kind === 'Error'), false, 'no Error nodes that drop source');
  for (const text of ['class C {', 'class C { void M() {', 'namespace N { class C { int', 'if (', 'x = (1 + ', '$"{a', '"""', 'foo(a, , b);', 'class C { void M() { } public void N() { } }', '}}}', '#if A\nclass']) assert.equal(SyntaxTree.parseText(text).toFullString(), text, text);
  const unclosed = SyntaxTree.parseText('class C { void M() { int x = 1; public void N() { } }');
  assert.deepEqual(unclosed.root.members[0].members.map(m => m.identifier.text), ['M', 'N'], 'a member keyword ends an unclosed block so the next member survives');
});
// ---- SF-A01-T02.9: generated nodes ----------------------------------------------------------------------------------
test('generated nodes: file is reproducible from the grammar and every kind has accessors for all slots', () => {
  const check = spawnSync(process.execPath, [join(repoRoot, 'packages/syntax/tools/generate-nodes.js'), '--check'], { encoding: 'utf8' }); assert.equal(check.status, 0, check.stderr);
  const grammar = JSON.parse(readFileSync(join(repoRoot, 'packages/syntax/src/grammar/syntax.json'), 'utf8')); let kinds = 0;
  for (const [syntax, kindList, slots] of grammar.nodes) for (const kind of kindList.split(' ')) {
    kinds++; const names = slots.split(' ').map(s => s.replace(/[?*,]+$/, '')); assert.deepEqual(slotNames[kind], names, kind); assert.equal(slotTypes[kind].length, names.length);
    const node = new (SyntaxFactory[syntax[0].toLowerCase() + syntax.slice(1)] ? Object : Object)(); assert(node);
    const factory = SyntaxFactory[syntax[0].toLowerCase() + syntax.slice(1)]; assert.equal(typeof factory, 'function', syntax);
    const made = kindList.includes(' ') ? factory(kind, ...names.map(() => null)) : factory(...names.map(() => null)); assert.equal(made.kind, kind);
    for (const [index, name] of names.entries()) { const value = made[name]; assert(value === null || Array.isArray(value) && value.length === 0, `${kind}.${name}`); assert.equal(typeof made['with' + name[0].toUpperCase() + name.slice(1)], 'function'); assert.equal(slotTypes[kind][index] === '1' || slotTypes[kind][index] === '2', Array.isArray(value)); }
  }
  assert(kinds > 200, String(kinds));
});
test('generated nodes: with*() updaters and factories build detached nodes', () => {
  const tree = SyntaxTree.parseText('a + b'), sum = tree.root.members[0].statement.expression; assert(sum instanceof BinaryExpressionSyntax);
  const swapped = sum.withLeft(sum.right).withRight(sum.left); assert.equal(swapped.toFullString(), 'b+ a ', 'trivia travels with its token'); assert.equal(swapped.parent, null); assert.equal(sum.toFullString(), 'a + b', 'the original is unchanged');
  const made = SyntaxFactory.binaryExpression('MultiplyExpression', sum.left, greenToken('AsteriskToken', '*'), sum.right); assert.equal(made.kind, 'MultiplyExpression'); assert.equal(made.toFullString(), 'a *b');
  const block = SyntaxTree.parseText('{ a(); b(); }').root.members[0].statement, reversed = block.withStatements([...block.statements].reverse()); assert.equal(reversed.toFullString(), '{ b(); a(); }'); assert.equal(block.withStatements([]).toFullString(), '{ }');
});
// ---- SF-A01-T02.10: visitor, walker, rewriter -----------------------------------------------------------------------
test('visitor: identity rewriter returns the same green root and a trivia-depth walker visits every character once', () => {
  for (const { name, text } of sources.slice(0, 60)) {
    const tree = SyntaxTree.parseText(text), rewritten = new SyntaxRewriter().rewrite(tree.root); assert.equal(rewritten.green, tree.green, name); assert.equal(rewritten, tree.root);
    let seen = 0, position = 0; const walker = new SyntaxWalker(SyntaxWalkerDepth.Trivia);
    walker.visitToken = token => { assert.equal(token.span.start, position); position += token.text.length; seen += token.text.length; }; walker.visitTrivia = trivia => { assert.equal(trivia.span.start, position); position += trivia.text.length; seen += trivia.text.length; };
    walker.walk(tree.root); assert.equal(seen, text.length, name);
  }
});
test('visitor: dispatch, depth and rewriting', () => {
  const tree = SyntaxTree.parseText('class C { void M() { if (a) { b(1); } else c(2 + 3); } }'), kinds = [];
  class Collector extends SyntaxWalker { visitIfStatement(node) { kinds.push('if:' + node.condition.toString()); return true; } visitInvocationExpression(node) { kinds.push('call:' + node.expression.toString()); return false; } visitToken() { kinds.push('token'); } }
  new Collector(SyntaxWalkerDepth.Node).walk(tree.root); assert.deepEqual(kinds, ['if:a', 'call:b', 'call:c'], 'node depth skips tokens; returning false skips children');
  let tokens = 0; const counting = new SyntaxWalker(SyntaxWalkerDepth.Token); counting.visitToken = () => tokens++; counting.walk(tree.root); assert.equal(tokens, [...tree.root.descendantTokens()].length);
  class Visitor extends SyntaxVisitor { visitClassDeclaration(node) { return 'class ' + node.identifier.text; } defaultVisit(node) { return 'other ' + node.kind; } }
  assert.equal(new Visitor().visit(tree.root.members[0]), 'class C'); assert.equal(new Visitor().visit(tree.root), 'other CompilationUnit'); assert.equal(new Visitor().visit(null), undefined);
  class Rename extends SyntaxRewriter { visitToken(token) { return token.kind === 'IdentifierToken' && token.text === 'b' ? greenToken('IdentifierToken', 'renamed', 'renamed', token.green.leading, token.green.trailing) : token; } visitElseClause() { return null; } }
  const result = new Rename().rewrite(tree.root); assert.equal(result.toFullString(), 'class C { void M() { if (a) { renamed(1); } } }'); assert.notEqual(result.green, tree.green);
  assert.equal(result.members[0].identifier.green, tree.root.members[0].identifier.green, 'untouched tokens are reused');
});
// ---- SF-A01-T02.12: byte-preserving round trip ----------------------------------------------------------------------
test('roundtrip: toFullString equals the input for every repository source in LF, CRLF and mixed line endings', () => {
  let files = 0;
  for (const { name, text } of sources) {
    const lf = text.replace(/\r\n?/g, '\n'), crlf = lf.replace(/\n/g, '\r\n'); let line = 0; const mixed = lf.replace(/\n/g, () => ['\n', '\r\n', '\r'][line++ % 3]);
    for (const variant of [text, lf, crlf, mixed]) { const tree = SyntaxTree.parseText(variant); if (tree.toFullString() !== variant) assert.fail('round-trip failed for ' + name); assert.equal(tree.root.toFullString(), variant); assert.equal(parse(variant).green.fullText, variant); }
    files++;
  }
  assert(files > 250);
  for (const file of filesUnder(fixtureRoot)) assert(sources.some(s => file.endsWith(s.name)), 'matrix and reference fixtures are part of the corpus');
});
test('roundtrip: files with errors, directives and unusual trivia', () => {
  for (const text of ['', ' ', '\n', BOM, '// only a comment', '/* unterminated', '"unterminated', "'x", '#if A\n#else\n', '#region\n', 'int x = 1 /* a */ // b', 'class C {\r\n#if false\r\n junk "\r\n#endif\r\n}\r\n', '$"{a,3:N2} {{b}}"', '@"a""b"', 'x = 1e;', '0x', "'ab'", '\u0000', 'a\tb\vc\fd', 'x ?.y', 'a >> = b', '#!shebang\nx();', '#:sdk Foo\nx();', 'class C { /// <summary>\n /// text\n void M(); }'])
    assert.equal(SyntaxTree.parseText(text).toFullString(), text, JSON.stringify(text));
});
// ---- SF-A01-T03.1: SyntaxTree ---------------------------------------------------------------------------------------
test('syntax tree: parseText, diagnostics and text changes', () => {
  const tree = SyntaxTree.parseText('class C { int x; }', { uri: 'a.cs' });
  assert.equal(tree.source.uri, 'a.cs'); assert.equal(tree.root.kind, 'CompilationUnit'); assert.equal(tree.root, tree.root); assert.deepEqual(tree.getDiagnostics(), []); assert(Object.isFrozen(tree)); assert.equal(tree.length, 18);
  const same = tree.withChangedText([]); assert.notEqual(same, tree); assert.equal(same.green, tree.green, 'an empty change shares the green root'); assert.equal(same.source, tree.source);
  const changed = tree.withChangedText([{ start: 14, length: 1, text: 'y' }, { start: 6, length: 1, text: 'Renamed' }]);
  assert.equal(changed.toFullString(), 'class Renamed { int y; }'); assert.equal(changed.source.version, tree.source.version + 1); assert.equal(tree.toFullString(), 'class C { int x; }');
  assert.deepEqual(changed.getChanges(tree), [{ start: 6, length: 9, text: 'Renamed { int y' }]); assert.deepEqual(tree.getChanges(tree), []);
  assert.equal(tree.withChangedText(changed.getChanges(tree)).toFullString(), changed.toFullString());
  assert.throws(() => tree.withChangedText([{ start: 99, length: 1, text: '' }]), RangeError); assert.throws(() => tree.withChangedText([{ start: 2, length: 4, text: '' }, { start: 4, length: 1, text: '' }]), RangeError);
  const big = SyntaxTree.parseText('class C { void A() { a(1); } void B() { b(2); } void D() { d(3); } }'), edited = big.withChangedText([{ start: 44, length: 1, text: '9' }]);
  assert.equal(edited.root.members[0].members[0].green, big.root.members[0].members[0].green, 'members outside the edit are reused through the shared green cache'); assert.notEqual(edited.root.members[0].members[1].green, big.root.members[0].members[1].green);
  const broken = SyntaxTree.parseText(new SourceText('int x = ;', 'b.cs', 3)); assert.equal(broken.getDiagnostics()[0].code, 'CS1525'); assert.equal(broken.getDiagnostics()[0].uri, 'b.cs'); assert.equal(broken.source.version, 3);
});
