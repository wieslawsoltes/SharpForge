import test from 'node:test';
import assert from 'node:assert/strict';
import { lex, parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { assertMatchesRoslyn, diagnosticsOf, expressionOf, shapeOf } from './support/syntax-reference.js';

// Defect reported by the compiler workstream: the interpolation scanner rejected every alignment that was not an
// integer literal with CS8076. Roslyn's parser accepts any expression there; whether it is an int constant in range is
// decided while binding (CS0150, CS8094). CS8076 is the lexer's "missing close delimiter" error and nothing else.
test('alignments that are not integer literals match Roslyn and report nothing', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp6/interpolation-alignment.cs');
  assert(kinds.has('InterpolationAlignmentClause'));
  assert.deepEqual(tree.getDiagnostics(), []);
});

test('the alignment is an expression node', () => {
  const alignmentOf = text => shapeOf(expressionOf(text).contents[0].alignmentClause.value);
  assert.equal(alignmentOf('$"{x,width}"'), 'IdentifierName(width)');
  assert.equal(alignmentOf('$"{x,-Width}"'), 'UnaryMinusExpression(- IdentifierName(Width))');
  assert.equal(alignmentOf('$"{x, W + 2 :F2}"'), 'AddExpression(IdentifierName(W) + NumericLiteralExpression(2))');
  assert.equal(alignmentOf('$"{x,5}"'), 'NumericLiteralExpression(5)');
});

test('no alignment reports CS8076; an unclosed hole still does', () => {
  const inMethod = body => `class C { void M() { ${body} } }`;
  for (const hole of ['{x,w}', '{x,1.5}', '{x,"s"}', '{x,200000}', '{x,C.W:X}'])
    assert.deepEqual(diagnosticsOf(inMethod(`var a = $"${hole}";`)), [], hole);
  assert(lex(new SourceText('$"{x"')).diagnostics.some(diagnostic => diagnostic.code === 'CS8076'));
  assert(lex(new SourceText('$"{x,w"')).diagnostics.some(diagnostic => diagnostic.code === 'CS8076'));
});

test('the legacy AST carries an integer literal as a number and any other alignment as an expression, without a diagnostic', () => {
  const partsOf = text => {
    const result = parse(`class C { void M() { var a = ${text}; } }`);
    assert.deepEqual(result.diagnostics, [], text);
    let found = null;
    JSON.stringify(result.root, (key, value) => {
      if (value && value.kind === 'InterpolatedString') found = value;
      return key === 'syntax' ? undefined : value;
    });
    return found.parts.map(part => [part.alignment, part.alignmentExpression?.kind ?? null]);
  };
  assert.deepEqual(partsOf('$"{x,-5}{x,w}{x}"'), [[-5, null], [0, 'Name'], [0, null]]);
});
