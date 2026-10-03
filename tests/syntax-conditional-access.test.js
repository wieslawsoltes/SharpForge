import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { assertMatchesRoslyn, assertRecoversLikeRoslyn, diagnosticsOf, expressionOf, shapeOf } from './support/syntax-reference.js';

// SF-A01-T31: C# 6 null-conditional chains as structured nodes.
test('T31 null-conditional chains match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp6/conditional-access.cs');
  for (const kind of ['ConditionalAccessExpression', 'MemberBindingExpression', 'ElementBindingExpression']) assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
});

test('T31 everything after a ? belongs to that conditional access', () => {
  assert.equal(
    shapeOf(expressionOf('a?.b.c?[i].d()')),
    'ConditionalAccessExpression(IdentifierName(a) ? ' +
      'ConditionalAccessExpression(SimpleMemberAccessExpression(MemberBindingExpression(. IdentifierName(b)) . IdentifierName(c)) ? ' +
      'InvocationExpression(SimpleMemberAccessExpression(' +
      'ElementBindingExpression(BracketedArgumentList([ Argument(IdentifierName(i)) ])) . IdentifierName(d)) ArgumentList(( )))))'
  );
  assert.equal(
    shapeOf(expressionOf('x?.y.z')),
    'ConditionalAccessExpression(IdentifierName(x) ? SimpleMemberAccessExpression(MemberBindingExpression(. IdentifierName(y)) . IdentifierName(z)))'
  );
  const chain = expressionOf('x?[0]?.y(z)');
  assert.equal(chain.whenNotNull.kind, 'ConditionalAccessExpression');
  assert.equal(chain.whenNotNull.expression.kind, 'ElementBindingExpression');
  assert.equal(chain.whenNotNull.whenNotNull.kind, 'InvocationExpression');
});

test('T31 the chain ends at operators that are not part of a primary expression', () => {
  assert.equal(expressionOf('a?.b ?? c').kind, 'CoalesceExpression');
  assert.equal(expressionOf('a?.b == null').kind, 'EqualsExpression');
  assert.equal(expressionOf('a?.b++').kind, 'PostIncrementExpression');
  assert.equal(expressionOf('a?.b->c').kind, 'PointerMemberAccessExpression', '-> applies to the whole conditional access');
  assert.equal(expressionOf('(a?.b).c').kind, 'SimpleMemberAccessExpression');
  assert.equal(expressionOf('a?.b!.c').whenNotNull.expression.kind, 'SuppressNullableWarningExpression');
});

test('T31 ? followed by . or [ is still a conditional operator where it must be', () => {
  assert.equal(expressionOf('x ? .5 : 1').kind, 'ConditionalExpression');
  assert.equal(expressionOf('x ? [1] : [2]').kind, 'ConditionalExpression');
  assert.equal(expressionOf('x ? y?[0] : z').whenTrue.kind, 'ConditionalAccessExpression');
  assert.equal(expressionOf('x?[0]').kind, 'ConditionalAccessExpression');
});

test('T31 the legacy adapter still gives the compiler its flat conditional nodes', () => {
  const legacy = parse('class C { void M(C a) { var x = a?.b.c; var y = a?[0]; } }');
  const [member, index] = legacy.root.members[0].members[0].body.statements.map(statement => statement.declarations[0].initializer);
  assert.equal(member.kind, 'Member');
  assert.equal(member.target.kind, 'ConditionalMember');
  assert.equal(index.kind, 'ConditionalIndex');
});

test('T31 conditional access is rejected below C# 6 and recovers as Roslyn does', () => {
  const source = 'class C { void M(C a) { object q = a?.b; object r = a?[0]; } }';
  assert.deepEqual(diagnosticsOf(source, '5'), ['CS8026@36 "?"', 'CS8026@53 "?"']);
  assert.deepEqual(diagnosticsOf(source, '6'), []);
  const { tree } = assertRecoversLikeRoslyn('reference/csharp6/conditional-access-recovery.cs');
  const bindings = [...tree.root.descendantNodes()].filter(node => /BindingExpression$/.test(node.kind));
  assert.equal(bindings.length, 6, 'each ?. and ?[ keeps its binding node with missing tokens');
});
