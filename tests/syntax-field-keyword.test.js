import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntaxTree, parse, boundPhaseCodes } from '@sharpforge/syntax';
import { assertGatesMatchRoslyn, assertMatchesRoslyn, classMembersOf, diagnosticsOf } from './support/syntax-reference.js';

// SF-A01-T51: the C# 14 contextual `field` keyword.
const fieldNodes = node => [...node.descendantNodes(true)].filter(child => child.kind === 'FieldExpression').length;

test('T51 field in property accessors matches Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp13-14/field-keyword.cs');
  assert(kinds.has('FieldExpression'));
  const words = [...tree.root.descendantTokens()].filter(token => token.text === 'field');
  assert.equal(words.filter(token => token.kind === 'FieldKeyword').length, 32);
  assert.equal(words.filter(token => token.kind === 'IdentifierToken').length, 16, 'outside accessors and after a dot it is an identifier');
});

test('T51 field is the keyword only inside the accessors and expression body of a property', () => {
  const [accessors, expression, indexer, event, method, field] = classMembersOf(
    'int A { get => field; set => field = value; } int G => field; int this[int i] { get => field; } ' +
      'event System.Action E { add { field = value; } remove { } } int M() => field; int x = field;'
  );
  assert.equal(fieldNodes(accessors), 2);
  assert.equal(fieldNodes(expression), 1);
  assert.equal(fieldNodes(indexer), 0, 'not in an indexer');
  assert.equal(fieldNodes(event), 0, 'not in an event');
  assert.equal(fieldNodes(method), 0);
  assert.equal(fieldNodes(field), 0);
});

test('T51 inside an accessor, a member access, an escaped name and a declared name stay identifiers', () => {
  const [property] = classMembersOf(
    'int P { get { var a = this.field; var b = @field; var o = new T { field = 1 }; int L() => field; return o.field + field; } }'
  );
  assert.equal(fieldNodes(property), 2, 'only the bare uses: in the local function and in the return');
  const [nameofUse] = classMembersOf('int Q { get => nameof(field).Length; }');
  assert.equal(fieldNodes(nameofUse), 1);
});

test('T51 LangVersion 13 treats field as an identifier', () => {
  const { kinds } = assertMatchesRoslyn('reference/csharp13-14/field-keyword-langversion13.cs');
  assert(!kinds.has('FieldExpression'));
  const source = 'class C { int field; int A { get => field; set => field = value; } }';
  assert.equal(fieldNodes(SyntaxTree.parseText(source, { languageVersion: '13' }).root), 0);
  assert.equal(fieldNodes(SyntaxTree.parseText(source, { languageVersion: '14' }).root), 2);
  assert.deepEqual(diagnosticsOf(source, '13'), [], 'no feature diagnostic: the same text has its older meaning');
  assert.deepEqual(assertGatesMatchRoslyn('gates/csharp14-field.rejected.cs'), [], 'Roslyn reports nothing at 13 either');
});

test('T51 the keyword warns (CS9258) when the type declares a member named field', () => {
  const source = 'class C { int field; int A { get => field; set => field = value; } int B { get => this.field; } int M() => field; }';
  assert.deepEqual(diagnosticsOf(source, '14'), ['CS9258@36 "field"', 'CS9258@50 "field"']);
  const tree = SyntaxTree.parseText(source, { languageVersion: '14' });
  assert(tree.getDiagnostics().every(diagnostic => diagnostic.severity === 'warning'));
  assert.deepEqual(diagnosticsOf('class C { int A { get => field; } }', '14'), [], 'no member named field, no warning');
  assert.deepEqual(diagnosticsOf('class C { int field() => 0; int A { get => field; } }', '14'), ['CS9258@43 "field"'], 'a method counts');
  const nested = 'class Outer { int field; class Inner { int A { get => field; } } int B { get => field; } }';
  assert.deepEqual(diagnosticsOf(nested, '14'), ['CS9258@80 "field"'], 'only the type that declares the member');
});

test('T51 a local or parameter named field inside an accessor reports CS9273', () => {
  assert(boundPhaseCodes.has('CS9273'), 'Roslyn reports it while binding');
  assert.deepEqual(diagnosticsOf('class C { int A { get { int field = 1; return 0; } } }', '14'), ['CS9273@28 "field"']);
  assert.deepEqual(diagnosticsOf('class C { int A { get { int L(int field) => 0; return L(1); } } }', '14'), ['CS9273@30 "int field"']);
  assert.deepEqual(diagnosticsOf('class C { int A { get { int @field = 1; return @field; } } }', '14'), []);
  assert.deepEqual(diagnosticsOf('class C { void M() { int field = 1; } }', '14'), []);
  assert.deepEqual(diagnosticsOf('class C { int A { get { int field = 1; return field; } } }', '13'), []);
});

test('T51 an incremental parse gives the same warnings as a full parse', () => {
  const before = 'class C {\n  int A { get => field; }\n}\n',
    insert = '  int field;\n',
    position = before.indexOf('  int A');
  const tree = SyntaxTree.parseText(before, { languageVersion: '14' });
  assert.deepEqual(tree.getDiagnostics(), []);
  const edited = tree.withChangedText([{ start: position, length: 0, text: insert }]);
  const full = SyntaxTree.parseText(before.slice(0, position) + insert + before.slice(position), { languageVersion: '14' });
  const describe = t => t.getDiagnostics().map(diagnostic => `${diagnostic.code}@${diagnostic.start}`);
  assert.deepEqual(describe(edited), describe(full));
  assert.equal(describe(edited).length, 1);
});

test('T51 the legacy AST still names the backing field `field`, and the back end keeps its own checks', () => {
  const legacy = parse('class C { int field; int A { get => field; set => field = value; } }');
  assert.deepEqual(legacy.diagnostics, [], 'the compiler reports field-keyword problems itself');
  const returned = legacy.root.members[0].members[1].accessors[0].body.statements[0].expression;
  assert.deepEqual([returned.kind, returned.name, returned.escaped], ['Name', 'field', false], 'the compiler finds the backing field by this name');
  assert.deepEqual(
    parse('class C { int field; int A { get => field; } }', undefined, { backEndProfile: false }).diagnostics.map(diagnostic => diagnostic.code),
    ['CS9258']
  );
});
