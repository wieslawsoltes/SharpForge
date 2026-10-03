import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { SyntaxTree, parseDocumentationComment, documentationCommentStructure, greenText, SyntaxKind, slotNames } from '@sharpforge/syntax';
import { fixtureRoot, loadReferenceFixture, compareWithReference } from './support/syntax-reference.js';

// SF-A01-T02.11: XML documentation comments are structured trivia (elements, attributes, cref and name syntax) that
// match Roslyn's DocumentationCommentTriviaSyntax, and malformed XML reports CS1570 without losing text.
const docTrivia = tree => [...tree.root.descendantTokens()].flatMap(t => t.leadingTrivia).filter(t => t.kind.endsWith('DocumentationCommentTrivia'));
const crefOf = text => {
  const tree = SyntaxTree.parseText(`/// <see cref="${text}"/>\nclass C { }`, { documentationMode: 'diagnose' }),
    structure = docTrivia(tree)[0].structure;
  return { cref: [...structure.descendantNodes()].find(n => n.kind === 'XmlCrefAttribute').cref, tree };
};
const shape = node => (node.isToken ? node.text : `${node.kind}(${node.childNodesAndTokens().map(shape).join(' ')})`);

test('doc comments: structures match the pinned Roslyn trees, including cref forms', () => {
  for (const name of ['reference/trivia/doc-comments.cs', 'reference/trivia/comments.cs']) {
    const { text, tree, reference } = loadReferenceFixture(join(fixtureRoot, name));
    assert.deepEqual(compareWithReference(tree, reference, text, 20), [], name);
    const structured = docTrivia(tree);
    assert(structured.length >= 2, name);
    for (const trivia of structured) {
      assert(trivia.structure.isNode);
      assert.equal(trivia.structure.kind, trivia.kind);
      assert.equal(trivia.structure.toFullString(), trivia.text);
      assert.equal(trivia.structure.parentTrivia, trivia);
    }
  }
  const { tree, reference } = loadReferenceFixture(join(fixtureRoot, 'reference/trivia/doc-comments.cs'));
  const kinds = new Set(docTrivia(tree).flatMap(t => [...t.structure.descendantNodes()].map(n => n.kind)));
  for (const kind of [
    'XmlElement',
    'XmlElementStartTag',
    'XmlElementEndTag',
    'XmlEmptyElement',
    'XmlName',
    'XmlTextAttribute',
    'XmlCrefAttribute',
    'XmlNameAttribute',
    'XmlText',
    'XmlCDataSection',
    'XmlComment',
    'XmlProcessingInstruction',
    'TypeCref',
    'QualifiedCref',
    'NameMemberCref',
    'IndexerMemberCref',
    'OperatorMemberCref',
    'ConversionOperatorMemberCref',
    'CrefParameterList',
    'CrefBracketedParameterList',
    'CrefParameter'
  ]) {
    assert(kinds.has(kind), kind);
    assert(SyntaxKind[kind] > 0 && slotNames[kind], kind);
  }
  let dumped = 0;
  const count = node => {
    if (Array.isArray(node[3])) node[3].forEach(count);
    else for (const t of [...node[6], ...node[7]]) if (t[3]) dumped++;
  };
  count(reference.tree);
  assert.equal(dumped, docTrivia(tree).length, 'every documentation comment has a Roslyn structure dump');
  assert.deepEqual(tree.getDiagnostics(), []);
});
test('doc comments: cref syntax covers generic, operator, conversion, indexer and parameter-list forms', () => {
  const cases = {
    M: 'NameMemberCref(IdentifierName(M))',
    'List{T}': 'NameMemberCref(GenericName(List TypeArgumentList({ IdentifierName(T) })))',
    'List&lt;T&gt;': 'NameMemberCref(GenericName(List TypeArgumentList(&lt; IdentifierName(T) &gt;)))',
    'A.B{T,U}.M(ref int, out T[])':
      'QualifiedCref(QualifiedName(IdentifierName(A) . GenericName(B TypeArgumentList({ IdentifierName(T) , IdentifierName(U) }))) . NameMemberCref(IdentifierName(M) CrefParameterList(( CrefParameter(ref PredefinedType(int)) , CrefParameter(out ArrayType(IdentifierName(T) ArrayRankSpecifier([ OmittedArraySizeExpression() ]))) ))))',
    'M(ref readonly int)': 'NameMemberCref(IdentifierName(M) CrefParameterList(( CrefParameter(ref readonly PredefinedType(int)) )))',
    'this[int, string]':
      'IndexerMemberCref(this CrefBracketedParameterList([ CrefParameter(PredefinedType(int)) , CrefParameter(PredefinedType(string)) ]))',
    'operator +(C, C)': 'OperatorMemberCref(operator + CrefParameterList(( CrefParameter(IdentifierName(C)) , CrefParameter(IdentifierName(C)) )))',
    'operator checked -(C)': 'OperatorMemberCref(operator checked - CrefParameterList(( CrefParameter(IdentifierName(C)) )))',
    'operator &lt;&lt;(C, int)':
      'OperatorMemberCref(operator &lt;&lt; CrefParameterList(( CrefParameter(IdentifierName(C)) , CrefParameter(PredefinedType(int)) )))',
    'C.operator false': 'QualifiedCref(IdentifierName(C) . OperatorMemberCref(operator false))',
    'explicit operator int(C)':
      'ConversionOperatorMemberCref(explicit operator PredefinedType(int) CrefParameterList(( CrefParameter(IdentifierName(C)) )))',
    'implicit operator checked C{T}':
      'ConversionOperatorMemberCref(implicit operator checked GenericName(C TypeArgumentList({ IdentifierName(T) })))',
    'int?': 'TypeCref(NullableType(PredefinedType(int) ?))',
    'global::N.T': 'QualifiedCref(AliasQualifiedName(IdentifierName(global) :: IdentifierName(N)) . NameMemberCref(IdentifierName(T)))'
  };
  for (const [text, expected] of Object.entries(cases)) {
    const { cref, tree } = crefOf(text);
    assert.equal(shape(cref), expected, text);
    assert.equal(cref.toFullString(), text);
    assert.deepEqual(tree.getDiagnostics(), [], text);
  }
  const shift = crefOf('operator &gt;&gt;&gt;(C, int)').cref.operatorToken;
  assert.equal(shift.kind, 'GreaterThanGreaterThanGreaterThanToken');
  assert.equal(shift.value, '>>>');
  const generic = crefOf('List{T}').cref.name.typeArgumentList.lessThanToken;
  assert.equal(generic.kind, 'LessThanToken');
  assert.equal(generic.text, '{');
  assert.equal(generic.value, '<');
  const verbatim = SyntaxTree.parseText('/// <see cref="T:System.String"/>\nclass C { }');
  assert.deepEqual(
    [...docTrivia(verbatim)[0].structure.descendantNodes()].filter(n => n.kind.endsWith('Attribute')).map(n => n.kind),
    ['XmlTextAttribute']
  );
});
test('doc comments: malformed XML reports CS1570 and malformed crefs CS1584 without losing text', () => {
  const malformed = [
    '/// <summary>\n/// Unclosed element\n',
    '/// <summary>Mismatched</remarks>\n',
    '/// Text with a stray < less-than and a lone & ampersand.\n',
    '/// <see attr=noquotes/>\n',
    '/// <see name="unterminated/>\n',
    '/// </summary>\n',
    '/// <a><b></a></b>\n',
    '/// <c x="1" x="2"/>\n',
    '/// <d\n',
    '/** <summary>\n * unterminated multi */',
    '/// <!-- never closed\n',
    '/// <![CDATA[ never closed\n',
    '/// <?pi never closed\n',
    '/// &unknown; &#xFFFFFFF;\n',
    '/// <a b = />\n',
    '/// <1bad/>\n'
  ];
  for (const comment of malformed) {
    const text = comment + (comment.endsWith('\n') ? '' : '\n') + 'class C { }',
      tree = SyntaxTree.parseText(text, { documentationMode: 'diagnose' }),
      diagnostics = tree.getDiagnostics();
    assert(
      diagnostics.length >= 1 && diagnostics.every(d => d.code === 'CS1570' && d.severity === 'warning'),
      JSON.stringify(comment) + ' ' + diagnostics.map(d => d.code)
    );
    for (const d of diagnostics) assert(d.start >= 0 && d.start + d.length <= comment.length, 'the warning lies inside the comment');
    assert.equal(tree.toFullString(), text);
    const [trivia] = docTrivia(tree);
    assert.equal(trivia.structure.toFullString(), trivia.text, JSON.stringify(comment));
    assert.deepEqual(SyntaxTree.parseText(text).getDiagnostics(), [], 'documentation diagnostics are opt-in, as with DocumentationMode.Parse');
  }
  for (const bad of ['Bad{', '', 'A.(', 'operator', 'this[', 'M(int', 'M(int) trailing', 'explicit int']) {
    const { cref, tree } = crefOf(bad);
    assert.deepEqual(
      tree.getDiagnostics().map(d => d.code),
      ['CS1584'],
      bad
    );
    assert.equal(tree.toFullString(), `/// <see cref="${bad}"/>\nclass C { }`);
    const [d] = tree.getDiagnostics();
    assert.equal(tree.source.text.slice(d.start, d.start + d.length), bad);
    assert(cref.isNode);
  }
  const unclosed = docTrivia(SyntaxTree.parseText('/// <summary>\n/// text\nclass C { }'))[0].structure.content.find(n => n.kind === 'XmlElement');
  assert.deepEqual(
    unclosed.endTag.childNodesAndTokens().map(c => (c.isToken ? c.isMissing : c.localName.isMissing)),
    [true, true, true],
    'an unclosed element gets a missing end tag'
  );
});
test('doc comments: every character of 3000 mutated comments stays in the structure', () => {
  let seed = 20240611;
  const random = n => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed % n;
  };
  const pieces = [
    '<',
    '>',
    '</',
    '/>',
    '"',
    "'",
    '=',
    '&',
    '&lt;',
    '&#65;',
    ';',
    '{',
    '}',
    '(',
    ')',
    '[',
    ']',
    ',',
    '.',
    ' ',
    '\n/// ',
    '\n * ',
    'cref',
    'name',
    'see',
    'param',
    'operator',
    'this',
    'implicit',
    'int',
    'T',
    '<!--',
    '-->',
    '<![CDATA[',
    ']]>',
    '<?',
    '?>',
    '*/',
    '::',
    '+',
    'ref ',
    ':',
    'x'
  ];
  for (let n = 0; n < 3000; n++) {
    const single = n % 2 === 0;
    let body = '';
    for (let k = 0, count = 1 + random(24); k < count; k++) body += pieces[random(pieces.length)];
    const text = single
      ? '/// ' + body.replaceAll('\n * ', '\n/// ') + '\n'
      : '/** ' + body.replaceAll('\n/// ', '\n * ').replaceAll('*/', '* /') + ' */';
    const parsed = parseDocumentationComment(text);
    assert.equal(greenText(parsed.green), text, JSON.stringify(text));
    assert.equal(parsed.green.fullWidth, text.length);
    for (const d of parsed.diagnostics) assert(d.start >= 0 && d.end <= text.length && d.start <= d.end && ['CS1570', 'CS1584'].includes(d.code));
  }
});
test('doc comments: structure is cached per green trivia and positioned in the tree', () => {
  const text = 'class A { }\n\n    /// <summary>Sum of <paramref name="a"/>.</summary>\n    class B { }',
    tree = SyntaxTree.parseText(text),
    [trivia] = docTrivia(tree);
  assert.equal(documentationCommentStructure(trivia.green), documentationCommentStructure(trivia.green));
  assert.equal(documentationCommentStructure(tree.root.members[0].openBraceToken.green.trailing[0]), null);
  for (const token of trivia.structure.descendantTokens()) assert.equal(text.slice(token.span.start, token.span.end), token.text);
  const name = [...trivia.structure.descendantNodes()].find(n => n.kind === 'XmlNameAttribute');
  assert.equal(name.identifier.identifier.text, 'a');
  assert.equal(text.slice(name.span.start, name.span.end), 'name="a"');
  const whitespace = tree.root.members[0].openBraceToken.trailingTrivia[0];
  assert.equal(whitespace.structure, null);
  assert.equal(whitespace.hasStructure, false);
  const exterior = trivia.structure.firstToken().leadingTrivia[0];
  assert.equal(exterior.kind, 'DocumentationCommentExteriorTrivia');
  assert.equal(exterior.text, '///');
  assert.equal(text.slice(exterior.span.start, exterior.span.end), '///');
});
