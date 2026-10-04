import test from 'node:test';
import assert from 'node:assert/strict';
import {Workspace} from '@sharpforge/workspace';
import {SyntaxTree} from '@sharpforge/syntax';
import {applyWorkspaceEdits} from '@sharpforge/refactoring';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {emitAssembly} from '@sharpforge/cil';
import {outlineReorder} from '../packages/refactoring/src/outline-reorder.js';

const uri = 'Program.cs';
function setup(text) {
  const workspace = new Workspace();
  workspace.update(uri, text, 7);
  const move = (from, to, position = 'before', extra = {}) => outlineReorder(workspace, {uri, version: 7,
    sourceStart: text.indexOf(from), targetStart: text.indexOf(to), position, ...extra});
  return {workspace, move};
}

function edited(text, action) {
  const edit = action.edits[0];
  return text.slice(0, edit.start) + edit.newText + text.slice(edit.end);
}

test('Outline moves a complete CRLF member with XML docs and trailing comments, without changing the workspace', () => {
  const first = '    /// first 😀\r\n    public int First() { return 1; } // first end\r\n';
  const second = '    /// second\r\n    public int Second() { return 2; } // second end\r\n';
  const text = 'class C\r\n{\r\n' + first + second + '}\r\n';
  const {workspace, move} = setup(text), action = move('First()', 'Second()', 'after');
  assert.equal(edited(text, action), 'class C\r\n{\r\n' + second + first + '}\r\n');
  assert.equal(workspace.documents.get(uri).source.text, text);
  assert.equal(action.version, 7);
  assert.equal(action.edits[0].version, 7);
  assert.equal(edited(text, action).slice(action.selection.start, action.selection.start + 5), 'First');
  assert.equal(SyntaxTree.parseText(edited(text, action)).getDiagnostics().length, 0);
});

test('Outline moves a callable across fields without changing field initialization order or either runtime result', () => {
  const text = 'Console.WriteLine(C.Sum()); class C { static int first=1; public static int Sum(){return first+second;} ' +
    'static int second=3; public static int Other(){return 9;} }';
  const {workspace, move} = setup(text), action = move('Sum(){', 'Other(){', 'after');
  const output = () => {
    const compilation = workspace.compile();
    assert(compilation.success, JSON.stringify(compilation.diagnostics));
    const source = new VirtualMachine(compilation.image).run();
    const cil = new CilVirtualMachine(emitAssembly(compilation.image)).run();
    assert.equal(source.state, 'terminated');
    assert.equal(cil.state, 'terminated');
    assert.equal(cil.output, source.output);
    return source.output;
  };
  const before = output();
  applyWorkspaceEdits(workspace, action.edits);
  assert.equal(output(), before);
  const result = workspace.documents.get(uri).source.text;
  assert(result.indexOf('first=1') < result.indexOf('second=3'));
  assert(result.indexOf('Other(){') < result.indexOf('Sum(){'));
});

for (const declaration of ['int Value => 1;', 'int Value { get { return 1; } set { } }', 'C() { }',
  'int this[int i] { get { return i; } }']) {
  test('Outline accepts storage-free declaration: ' + declaration, () => {
    const text = 'class C { ' + declaration + ' int End(){return 2;} }';
    const {move} = setup(text), action = move(declaration, 'End()', 'after');
    assert(edited(text, action).indexOf(declaration) > edited(text, action).indexOf('End()'));
  });
}

for (const declaration of ['int value = 1;', 'int Value { get; set; }', 'int Value { get; } = 1;',
  '[ModuleInitializer] static void Init() {}', '[Alias] static void Init() {}']) {
  test('Outline rejects order-sensitive or hidden-storage declaration: ' + declaration, () => {
    const {move} = setup('class C { ' + declaration + ' int End(){return 2;} }');
    assert.throws(() => move(declaration, 'End()'), {code: 'OUTLINE_UNSAFE'});
  });
}

test('Outline rejects different containers, stale/read-only versions and invalid offsets without partial mutation', () => {
  const text = 'class C { int A(){return 1;} } class D { int B(){return 2;} }';
  const {workspace, move} = setup(text);
  assert.throws(() => move('A()', 'B()'), {code: 'OUTLINE_CONTAINER'});
  assert.throws(() => move('A()', 'A()', 'before', {version: 6}), {code: 'OUTLINE_STALE'});
  assert.throws(() => move('A()', 'A()', 'before', {sourceStart: -1}), RangeError);
  assert.throws(() => move('A()', 'A()', 'inside'), RangeError);
  workspace.documents.get(uri).readOnly = true;
  assert.throws(() => move('A()', 'A()'), {code: 'OUTLINE_READ_ONLY'});
  assert.equal(workspace.documents.get(uri).source.text, text);
});

test('Outline rejects crossing region/directive trivia and malformed source members', () => {
  const text = 'class C {\nint A(){return 1;}\n#region Kept\nint B(){return 2;}\n#endregion\n}';
  assert.throws(() => setup(text).move('A()', 'B()', 'after'), {code: 'OUTLINE_DIRECTIVE'});
  assert.throws(() => setup('class C { int A(){return 1} int B(){return 2;} }').move('A()', 'B()'),
    error => ['OUTLINE_UNSAFE', 'OUTLINE_SYNTAX_ERROR'].includes(error.code));
});

test('Outline returns a stable no-op for the same member and preserves same-line separators for real moves', () => {
  const text = 'class C { int A(){return 1;} int B(){return 2;} }';
  const {move} = setup(text);
  assert.deepEqual(move('A()', 'A()').edits, []);
  const result = edited(text, move('B()', 'A()'));
  assert.equal(result, 'class C { int B(){return 2;} int A(){return 1;} }');
});
