import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  SyntaxTree,
  previewRevisions,
  languageFeatures,
  unsupportedPreview,
  previewContextualKeywordKinds,
  isTokenKind,
  isNodeKind
} from '@sharpforge/syntax';
import { fixtureRoot, diagnosticsOf, shapeOf } from './support/syntax-reference.js';

// SF-A01-T09 / T10.1: C# 15 preview grammar - unions, closed classes and enums, the `safe` modifier and unsafe
// expressions - gated behind LangVersion preview and pinned to csharplang proposal revisions. The pinned Roslyn build
// does not parse these, so the trees are asserted directly.
const members = (text, options) => SyntaxTree.parseText(text, options).root.members;
const codes = (text, version) => diagnosticsOf(text, version).map(d => d.split(' ')[0].split('@')[0]);
test('T09.1 unions: the pinned proposal examples parse under preview', () => {
  const examples = `// Union of existing types
public union Pet(Cat, Dog, Bird);

// Union with function member
public union OneOrMore<T>(T, IEnumerable<T>)
{
    public IEnumerable<T> AsEnumerable() => Value switch
    {
        IEnumerable<T> list => list,
        T value => [value],
    };
}

// "Discriminated" union with freshly declared case types
public record class None();
public record class Some<T>(T value);
public union Option<T>(None, Some<T>);
union Pet2(Cat, Dog) : IPet;
union StringOrInt(string, int?);
union Pet3(Cat, Dog) { public void Deconstruct(out object value) { value = this.Value; } }
[Serializable] internal partial union Result<TValue, TError>(TValue, TError) : IResult where TValue : notnull where TError : Exception { }
`;
  const tree = SyntaxTree.parseText(examples, { languageVersion: 'preview' });
  assert.deepEqual(
    tree.getDiagnostics().map(d => d.code + ' ' + d.message),
    []
  );
  assert.equal(tree.toFullString(), examples);
  const unions = tree.root.members.filter(m => m.kind === 'UnionDeclaration');
  assert.equal(unions.length, 7);
  assert.deepEqual(
    unions.map(u => [
      u.identifier.text,
      u.caseTypes.types.map(t => t.toString()).join('|'),
      u.typeParameterList?.parameters.length ?? 0,
      !!u.baseList,
      u.members.length,
      !!u.semicolonToken && !u.openBraceToken
    ]),
    [
      ['Pet', 'Cat|Dog|Bird', 0, false, 0, true],
      ['OneOrMore', 'T|IEnumerable<T>', 1, false, 1, false],
      ['Option', 'None|Some<T>', 1, false, 0, true],
      ['Pet2', 'Cat|Dog', 0, true, 0, true],
      ['StringOrInt', 'string|int?', 0, false, 0, true],
      ['Pet3', 'Cat|Dog', 0, false, 1, false],
      ['Result', 'TValue|TError', 2, true, 0, false]
    ]
  );
  assert.equal(
    shapeOf(unions[0]),
    'UnionDeclaration(public union Pet UnionCaseTypeList(( IdentifierName(Cat) , IdentifierName(Dog) , IdentifierName(Bird) )) ;)'
  );
  assert.equal(unions[0].keyword.kind, 'UnionKeyword');
  assert.equal(unions[6].constraintClauses.length, 2);
  assert.equal(unions[6].attributeLists.length, 1);
  assert.deepEqual(
    unions[6].modifiers.map(m => m.kind),
    ['InternalKeyword', 'PartialKeyword']
  );
  assert.equal(members('class Outer { union Inner(A, B); int f; }')[0].members[0].kind, 'UnionDeclaration', 'unions nest in types');
});
test('T09.1 unions: `union` remains an identifier in non-declaration positions and for valid code below preview', () => {
  const identifiers =
    'class C { int union; union field2; union M(int x) { return null; } union<int> G(union<int> p) { return p; } void N(union union) { union = null; object y = union; union(); union.M(1); } union P { get; set; } }\nclass union { }\nclass union<T> { }\n';
  const shapes = [];
  for (const version of ['2', '8', '14', 'preview']) {
    const tree = SyntaxTree.parseText(identifiers, { languageVersion: version });
    assert.deepEqual(
      tree.getDiagnostics().map(d => d.code),
      [],
      version
    );
    shapes.push(shapeOf(tree.root));
    assert.deepEqual(
      tree.root.members[0].members.map(m => m.kind),
      ['FieldDeclaration', 'FieldDeclaration', 'MethodDeclaration', 'MethodDeclaration', 'MethodDeclaration', 'PropertyDeclaration'],
      version
    );
    assert(![...tree.root.descendantNodes()].some(n => n.kind === 'UnionDeclaration'));
  }
  assert.equal(new Set(shapes).size, 1, 'the tree is the same at every language version');
  const declaration = 'public union Pet(Cat, Dog);';
  assert.deepEqual(
    diagnosticsOf(declaration, '14'),
    ['CS8652@7 "union"'],
    'a union declaration below preview is reported as a preview feature, not as a pile of syntax errors'
  );
  assert.deepEqual(diagnosticsOf(declaration, 'preview'), []);
  assert(
    SyntaxTree.parseText(declaration, { languageVersion: '14' })
      .getDiagnostics()[0]
      .message.includes('csharplang/proposals/csharp-15.0/unions.md revision 1')
  );
  assert.equal(members('union M(int x) { }')[0].kind, 'GlobalStatement', 'a parameter list with names is a function, not a case-type list');
  assert.equal(members('union M();')[0].kind, 'GlobalStatement');
});
test('T09.1 / T09.2: forms outside the pinned revisions report the explicit unsupported-preview diagnostic', () => {
  const recordUnion = SyntaxTree.parseText('public record union U(A, B);', { languageVersion: 'preview' });
  assert.deepEqual(
    recordUnion.getDiagnostics().map(d => d.code),
    ['SF1098']
  );
  assert.equal(recordUnion.root.members[0].kind, 'UnionDeclaration');
  assert.equal(recordUnion.toFullString(), 'public record union U(A, B);');
  assert.match(
    recordUnion.getDiagnostics()[0].message,
    /'record union' is not a union declaration form in the pinned preview grammar \(csharplang\/proposals\/csharp-15\.0\/unions\.md revision 1\)/
  );
  for (const text of [
    'closed struct S { }',
    'closed interface I { }',
    'closed delegate void D();',
    'class C { closed static int F; }',
    'closed record struct R;'
  ]) {
    const tree = SyntaxTree.parseText(text, { languageVersion: 'preview' });
    assert.deepEqual(
      tree.getDiagnostics().map(d => d.code),
      ['SF1098'],
      text
    );
    assert.equal(tree.toFullString(), text);
    assert.match(
      tree.getDiagnostics()[0].message,
      /'closed' applies only to classes and enums in the pinned preview grammar \(csharplang\/proposals\/csharp-15\.0\/closed-hierarchies\.md revision 1\); this form is not supported/
    );
  }
  assert.deepEqual(unsupportedPreview('Unions', 'X')[0], 'SF1098');
});
test('T09.2 closed classes and closed enums parse under preview', () => {
  const text = `// Assembly 1
public closed record class GateState;
public record class Closed : GateState;
public record class Open(float Percent) : GateState;
public closed class CC { }
public class CO : CC { }
public closed enum Color
{
    Red,
    Green,
    Blue
}
closed partial class P { closed class Nested { } closed enum E : byte { A } }
internal closed record R(int X);
`;
  const tree = SyntaxTree.parseText(text, { languageVersion: 'preview' });
  assert.deepEqual(
    tree.getDiagnostics().map(d => d.code + ' ' + d.message),
    []
  );
  assert.equal(tree.toFullString(), text);
  const closed = [...tree.root.descendantNodes()].filter(n => n.modifiers?.some?.(m => m.kind === 'ClosedKeyword'));
  assert.deepEqual(
    closed.map(n => n.kind),
    ['RecordDeclaration', 'ClassDeclaration', 'EnumDeclaration', 'ClassDeclaration', 'ClassDeclaration', 'EnumDeclaration', 'RecordDeclaration']
  );
  assert.equal(tree.root.members[1].identifier.text, 'Closed', 'a type named Closed is unaffected');
  assert.deepEqual(diagnosticsOf('public closed class Animal { }', '14'), ['CS8652@7 "closed"']);
  assert.deepEqual(diagnosticsOf('closed enum E { A }', '14'), ['CS8652@0 "closed"']);
  assert(
    SyntaxTree.parseText('closed enum E { A }', { languageVersion: '14' })
      .getDiagnostics()[0]
      .message.includes('csharplang/proposals/closed-enums.md revision 1')
  );
  const identifiers =
    'class C { int closed; closed field2; closed M(closed p) { closed local = p; closed = 1; return local; } bool closed2 => closed == 0; }\nclass closed { }\n';
  for (const version of ['6', '14', 'preview']) {
    const parsed = SyntaxTree.parseText(identifiers, { languageVersion: version });
    assert.deepEqual(
      parsed.getDiagnostics().map(d => d.code),
      [],
      version
    );
    assert.deepEqual(
      parsed.root.members[0].members.map(m => m.kind),
      ['FieldDeclaration', 'FieldDeclaration', 'MethodDeclaration', 'PropertyDeclaration']
    );
  }
});
test('T09.3 every preview fixture names its proposal revision and the stamp matches preview-revisions.js', () => {
  const directory = join(fixtureRoot, 'matrix/15-preview'),
    readme = readFileSync(join(directory, 'README.txt'), 'utf8');
  assert.match(readme, /revision stamp/);
  assert.match(readme, /preview-revisions\.js/);
  const features = readdirSync(directory)
      .filter(name => name !== 'README.txt')
      .sort(),
    preview = languageFeatures
      .filter(f => f.preview)
      .map(f => f.id)
      .sort();
  assert.deepEqual(features, preview, 'one fixture directory per preview feature');
  assert(preview.includes('Unions') && preview.includes('ClosedClasses') && preview.includes('ClosedEnums'));
  for (const id of features) {
    const stamp = previewRevisions[id],
      positive = readFileSync(join(directory, id, 'positive.cs'), 'utf8'),
      header = /^\/\/ preview: (\S+) revision (\d+) commit ([0-9a-f]{12})\n/.exec(positive);
    assert(header, id + ': positive.cs starts with its revision stamp');
    assert.deepEqual(
      [header[1], Number(header[2]), header[3]],
      [stamp.proposal, stamp.revision, stamp.commit.slice(0, 12)],
      `${id}: the fixture was reviewed against a different stamp; review it and update its first line`
    );
    assert.match(stamp.commit, /^[0-9a-f]{40}$/);
    assert.equal(typeof stamp.roslyn, 'boolean');
    assert.equal(
      existsSync(join(directory, id, 'positive.cs.json')),
      stamp.roslyn,
      id + ': a Roslyn tree exists exactly when the pinned Roslyn parses the feature'
    );
    assert.deepEqual(SyntaxTree.parseText(positive, { languageVersion: 'preview' }).getDiagnostics(), [], id);
    // A feature with an older meaning is not rejected at C# 14: its syntax parses as what it used to mean.
    assert.deepEqual(
      SyntaxTree.parseText(positive, { languageVersion: '14' })
        .getDiagnostics()
        .map(d => d.code),
      languageFeatures.find(feature => feature.id === id).olderMeaning ? [] : ['CS8652'],
      id
    );
  }
  for (const kind of Object.values(previewContextualKeywordKinds)) assert(isTokenKind(kind), kind);
  for (const kind of ['UnionDeclaration', 'UnionCaseTypeList', 'UnsafeExpression']) assert(isNodeKind(kind), kind);
});
test('T10.1 memory safety: the `safe` modifier and unsafe expressions parse under preview', () => {
  const text = `class Native
{
    safe extern static int Strlen(byte* text);
    static safe extern void Free(void* memory);
    unsafe extern static void* Alloc(int size);
    public safe int Field;
    safe partial void Hook();
    protected safe virtual System.IntPtr Handle { get; }
    safe event System.Action Changed;
    safe Native() { }
    public static safe Native operator +(Native a, Native b) => a;
    safe class Inner { }
    int Read(int* p, bool flag) => flag ? unsafe(*p) : unsafe(p[1] + *(p + 2));
    async System.Threading.Tasks.Task M() { await unsafe(NowUnsafeCall(1)); var x = unsafe(Peek()) + 1; unsafe(Poke()); }
    int field = unsafe(sizeof(Native*));
}
safe struct Layout { }
`;
  const tree = SyntaxTree.parseText(text, { languageVersion: 'preview' });
  assert.deepEqual(
    tree.getDiagnostics().map(d => d.code + ' ' + d.message),
    []
  );
  assert.equal(tree.toFullString(), text);
  const safe = [...tree.root.descendantTokens()].filter(t => t.kind === 'SafeKeyword');
  assert.equal(safe.length, 10);
  assert(safe.every(t => t.text === 'safe'));
  assert.deepEqual(
    tree.root.members[0].members.slice(0, 3).map(m => m.modifiers.map(x => x.text).join(' ')),
    ['safe extern static', 'static safe extern', 'unsafe extern static']
  );
  const expressions = [...tree.root.descendantNodes()].filter(n => n.kind === 'UnsafeExpression');
  assert.equal(expressions.length, 6);
  assert.equal(shapeOf(expressions[0]), 'UnsafeExpression(unsafe ( PointerIndirectionExpression(* IdentifierName(p)) ))');
  assert.equal(expressions[0].unsafeKeyword.kind, 'UnsafeKeyword');
  assert.equal(expressions[2].parent.kind, 'AwaitExpression');
  assert.deepEqual(diagnosticsOf('class C { safe extern static void M(); }', '14'), ['CS8652@10 "safe"']);
  assert.deepEqual(diagnosticsOf('class C { int M(int* p) => unsafe(*p); }', '14'), ['CS8652@27 "unsafe"']);
  assert(
    SyntaxTree.parseText('class C { safe extern static void M(); }', { languageVersion: '14' })
      .getDiagnostics()[0]
      .message.includes('csharplang/proposals/unsafe-evolution.md revision 1')
  );
  const blocks = 'class C { unsafe void M() { unsafe { int* p = null; } } unsafe int* f; }';
  assert.deepEqual(codes(blocks, '14'), [], 'unsafe blocks and the unsafe modifier are unchanged');
  assert(![...SyntaxTree.parseText(blocks).root.descendantNodes()].some(n => n.kind === 'UnsafeExpression'));
});
