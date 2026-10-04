import test from 'node:test';
import assert from 'node:assert/strict';
import {Workspace} from '@sharpforge/workspace';
import {LanguageService} from '@sharpforge/language';
import {RefactoringEngine} from '@sharpforge/refactoring';
import {ExtensionDriver} from '@sharpforge/extensions';
import {LanguageServer} from '@sharpforge/protocol';
import {ReferenceResults} from '../apps/studio/workbench/tools/references.js';
import {hierarchicalSymbols} from '../apps/studio/workbench/tools/tree-host.js';
import {createWorkerProtocol} from '../apps/studio/workers/protocol.js';
import {registerEditorLanguageHandlers} from '../apps/studio/workers/editor-language.js';

function fixture(files, options = {}) {
  const workspace = new Workspace({compilationOptions: {outputKind: 'library'}, ...options});
  for (const [uri, text] of Object.entries(files)) workspace.update(uri, text, 3);
  const language = new LanguageService(workspace);
  const refactoring = new RefactoringEngine(workspace, language);
  const handlers = createWorkerProtocol('compiler');
  registerEditorLanguageHandlers(handlers, {workspace, language, refactoring});
  return {workspace, language, refactoring, handlers};
}

test('source query model is cached per complete source/options revision', () => {
  const {workspace} = fixture({'A.cs': 'public class A {}'});
  const model = workspace.sourceModel();
  assert.equal(workspace.sourceModel(), model);
  workspace.update('A.cs', 'public class A { public int Value; }', 4);
  const changed = workspace.sourceModel();
  assert.notEqual(changed, model);
  assert(changed.documentSymbols('A.cs').some(symbol => symbol.name === 'Value'));
  assert(!model.documentSymbols('A.cs').some(symbol => symbol.name === 'Value'));
  assert.notEqual(workspace.sourceModel({langVersion: '12'}), changed);
});

test('namespace-qualified class bases, interfaces and members build distinct Class View branches', () => {
  const {language} = fixture({'Types.cs': 'namespace One { public interface I {} public class Base {} ' +
    'public class Child : Base, I { public int Value; } } namespace Two { public class Base {} ' +
    'public class Child : Base { public int Value; } }'});
  const symbols = language.documentSymbols('Types.cs');
  const child = symbols.find(symbol => symbol.fullName === 'One.Child');
  assert.equal(child.namespace, 'One');
  assert.equal(child.baseType, 'One.Base');
  assert.deepEqual(child.baseTypes, ['One.Base', 'One.I']);
  assert.equal(symbols.find(symbol => symbol.fullName === 'Two.Child').baseType, 'Two.Base');
  const tree = hierarchicalSymbols(symbols.map(symbol => ({...symbol, projectId: 'types'})));
  assert.deepEqual(tree[0].children.map(node => node.label), ['One', 'Two']);
  for (const namespace of tree[0].children) {
    const branch = namespace.children.find(node => node.label === 'Child');
    assert.equal(branch.children.length, 1);
    assert.equal(branch.children[0].symbol.ownerFullName, namespace.label + '.Child');
  }
});

test('bound reads, writes, declarations, compound updates and ref/out/in retain filterable metadata', () => {
  const text = 'class C { static void Sink(ref int both,out int target,in int input){target=input;both++;}' +
    'static void M(){int x=1;x=2;x+=3;++x;Sink(ref x,out x,in x);System.Console.WriteLine(x);} }';
  const {language, handlers} = fixture({'C.cs': text});
  const start = text.indexOf('int x') + 4;
  const rows = language.references('C.cs', start);
  assert.equal(rows.length, 8);
  const flags = fragment => rows.find(row => row.start === text.indexOf(fragment) + fragment.lastIndexOf('x'));
  assert.deepEqual([flags('x=2').read, flags('x=2').write], [false, true]);
  assert.deepEqual([flags('x+=3').read, flags('x+=3').write], [true, true]);
  assert.deepEqual([flags('++x').read, flags('++x').write], [true, true]);
  assert.deepEqual([flags('out x').read, flags('out x').write], [false, true]);
  assert.deepEqual([flags('in x').read, flags('in x').write], [true, false]);
  assert(rows.find(row => row.start === start).declaration);
  const wire = handlers.dispatch('references', {uri: 'C.cs', version: 3, offset: start, projectId: 'p'});
  assert(wire.every(row => row.projectId === 'p' && row.version === 3 && row.preview && row.definition === 'x'));
  const results = new ReferenceResults();
  const result = results.set(wire);
  const count = kind => results.groups(result.id, {kind}).flatMap(group => group.children).length;
  assert.equal(count('definition'), 1);
  assert.equal(count('write'), 5);
  assert.equal(count('read'), 5);
});

test('a written property does not classify its receiver as written', () => {
  const text = 'class C { public int Value { get; set; } static void M(){var c=new C();' +
    'c.Value=7;c.Value++;System.Console.WriteLine(c.Value);} }';
  const {language} = fixture({'C.cs': text});
  const property = language.references('C.cs', text.indexOf('Value'));
  assert.equal(property.filter(row => row.write).length, 2);
  assert.equal(property.find(row => row.start === text.indexOf('Value=7')).read, false);
  const receiver = language.references('C.cs', text.indexOf('var c') + 4);
  assert(receiver.filter(row => !row.declaration).every(row => row.read && !row.write));
});

test('tuple deconstruction writes are distinct from tuple reads', () => {
  const text = 'class C { void M(){int a=1;int b=2;(a,b)=(b,a);System.Console.WriteLine(a);} }';
  const {language} = fixture({'C.cs': text});
  const rows = language.references('C.cs', text.indexOf('int a') + 4);
  assert.equal(rows.filter(row => row.write).length, 1);
  assert.equal(rows.find(row => row.start === text.indexOf('(a,b)') + 1).read, false);
});

test('partial generic type rename covers aliases, constructors, arrays, qualified names and typeof', () => {
  const files = {
    'Box.cs': 'namespace N { public partial class Box<T> { public Box() {} public Box<T> Self()=>this; } }',
    'Part.cs': 'namespace N { public partial class Box<T> {} } namespace Other { public class Box {} }',
    'Use.cs': 'using Alias=N.Box<int>; namespace Use { class Holder { N.Box<int>[] values; ' +
      'Alias Get()=>new N.Box<int>(); System.Type Kind()=>typeof(N.Box<int>); Other.Box untouched; } }'
  };
  const {workspace, language, refactoring} = fixture(files);
  assert.throws(() => language.rename('Box.cs', files['Box.cs'].indexOf('Box'), 'Crate', {renameFile: true}), /renamePlan/);
  const action = refactoring.rename('Box.cs', files['Box.cs'].indexOf('Box'), 'Crate', {renameFile: true});
  assert.equal(action.edits.filter(edit => edit.uri === 'Box.cs').length, 3);
  assert.equal(action.edits.filter(edit => edit.uri === 'Part.cs').length, 1);
  assert.equal(action.edits.filter(edit => edit.uri === 'Use.cs').length, 4);
  assert.deepEqual(action.resources, [{kind: 'rename', oldUri: 'Box.cs', newUri: 'Crate.cs', version: 3}]);
  assert.equal(workspace.documents.get('Box.cs').source.text, files['Box.cs']);
  const applied = refactoring.rename('Box.cs', files['Box.cs'].indexOf('Box'), 'Crate');
  refactoring.apply(applied);
  assert(workspace.documents.get('Use.cs').source.text.includes('Other.Box untouched'));
  assert(workspace.documents.get('Box.cs').source.text.includes('public Crate()'));
});

test('comment/string options use lexical spans and whole identifiers, including interpolation', () => {
  const text = 'class Widget { static void M(){Widget item=new Widget();' +
    'string a="Widget Widget2";string b=@"Widget";string c=$"Widget {item}"; } } // Widget Widget2\r\n';
  const {refactoring, workspace} = fixture({'Widget.cs': text});
  const plain = refactoring.rename('Widget.cs', text.indexOf('Widget'), 'Gadget');
  assert.equal(plain.edits.length, 3);
  const expanded = refactoring.rename('Widget.cs', text.indexOf('Widget'), 'Gadget', {includeComments: true, includeStrings: true});
  assert.equal(expanded.edits.length, 7);
  refactoring.apply(expanded);
  const result = workspace.documents.get('Widget.cs').source.text;
  assert(result.includes('"Gadget Widget2"'));
  assert(result.includes('// Gadget Widget2\r\n'));
  assert(result.includes('$"Gadget {item}"'));
});

test('rename refuses collisions, captures, generated targets and existing resource destinations', () => {
  const text = 'class Widget { int other; void M(){int value=1;System.Console.WriteLine(other+value);} } class Gadget {}';
  const {workspace, refactoring} = fixture({'Widget.cs': text, 'Taken.cs': '// existing file'});
  assert.throws(() => refactoring.rename('Widget.cs', text.indexOf('Widget'), 'Gadget'), /conflict/);
  assert.throws(() => refactoring.rename('Widget.cs', text.indexOf('value'), 'other'), /capture/);
  assert.throws(() => refactoring.rename('Widget.cs', text.indexOf('Widget'), 'Taken', {renameFile: true}), /destination/);
  assert.equal(workspace.documents.get('Widget.cs').source.text, text);
  const extensions = new ExtensionDriver().registerGenerator({id: 'References', generate(context) {
    context.addSource('Generated.cs', 'class Generated { public Widget value; }');
  }});
  const generated = fixture({'Widget.cs': 'public class Widget {}'}, {extensions});
  assert.throws(() => generated.refactoring.rename('Widget.cs', 13, 'NewWidget'), /generated/);
});

test('renaming Unicode source identifiers preserves UTF-16 offsets after an astral prefix', () => {
  const text = '//😀\r\nclass Δέμα { Δέμα Copy()=>new Δέμα(); }';
  const {workspace, refactoring} = fixture({'Δέμα.cs': text});
  const action = refactoring.rename('Δέμα.cs', text.indexOf('Δέμα'), 'Πακέτο');
  assert.equal(action.edits.length, 3);
  refactoring.apply(action);
  assert.equal(workspace.documents.get('Δέμα.cs').source.text, text.replaceAll('Δέμα', 'Πακέτο'));
});

test('parameter hints follow the selected overload and omit explicitly named arguments', () => {
  const text = 'class C { static int F(int amount)=>amount; static int F(string label)=>0;' +
    'static int Pair(int first,int second)=>first+second; static void M(){F(1);F("hi");' +
    'Pair(second:2,first:1);Pair(1,second:2);} }';
  const {language} = fixture({'C.cs': text});
  const hints = language.inlayHints('C.cs').filter(hint => hint.kind === 2);
  assert.deepEqual(hints.map(hint => hint.label), ['amount:', 'label:', 'first:']);
  assert.deepEqual(hints.map(hint => text.slice(hint.offset, hint.offset + 2)), ['1)', '"h', '1,']);
});

test('constructor and extension hints use parameter mapping without labeling the extension receiver', () => {
  const text = 'static class Extensions { public static int Repeat(this int value,int count)=>value*count; }' +
    'class C { public C(int capacity){} static void M(){var c=new C(4);(1).Repeat(2);} }';
  const {language} = fixture({'C.cs': text});
  const hints = language.inlayHints('C.cs');
  assert(hints.some(hint => hint.label === 'capacity:'));
  assert(hints.some(hint => hint.label === 'count:'));
  assert(!hints.some(hint => hint.kind === 2 && hint.label === 'value:'));
  const offset = text.indexOf('new C(4)') + 6;
  const range = language.inlayHints('C.cs', {start: offset, end: offset + 1});
  assert.deepEqual(range.map(hint => hint.label), ['capacity:']);
});

test('worker and LSP preparation accept source types and return read/write highlights', async () => {
  const text = 'class C { static void M(){int n=0;n=1;System.Console.WriteLine(n);} }';
  const {workspace, handlers} = fixture({'C.cs': text});
  const preparation = handlers.dispatch('prepareRename', {uri: 'C.cs', version: 3, offset: 6});
  assert.deepEqual(preparation.capabilities, ['comments', 'strings', 'file']);
  const server = new LanguageServer({workspace});
  const prepare = await server.handle({jsonrpc: '2.0', id: 1, method: 'textDocument/prepareRename', params: {
    textDocument: {uri: 'C.cs'}, position: {line: 0, character: 6}
  }});
  assert.equal(prepare.result.placeholder, 'C');
  const highlights = handlers.dispatch('documentHighlights', {uri: 'C.cs', version: 3, offset: text.indexOf('int n') + 4});
  assert.deepEqual(highlights.items.map(item => item.kind), [1, 3, 2]);
  assert.throws(() => handlers.dispatch('prepareRename', {uri: 'C.cs', version: 2, offset: 6}), {code: 'SFED1202'});
});

test('pure Outline worker routes the safe semantic reorder leaf and rejects stale versions', () => {
  const text = 'class C { int First()=>1; int Second()=>2; }';
  const {handlers, workspace} = fixture({'C.cs': text});
  const result = handlers.dispatch('outlineReorder', {uri: 'C.cs', version: 3,
    sourceStart: text.indexOf('First'), targetStart: text.indexOf('Second'), position: 'after'});
  assert(result.edits.length);
  assert.equal(workspace.documents.get('C.cs').source.text, text);
  assert.throws(() => handlers.dispatch('outlineReorder', {uri: 'C.cs', version: 1}), {code: 'SFED1202'});
});

test('framework hover carries a structured callable target for metadata navigation', () => {
  const text = 'class C { static void M(){System.Console.WriteLine(42);} }';
  const {language} = fixture({'C.cs': text});
  const hover = language.hover('C.cs', text.indexOf('WriteLine') + 2);
  assert.equal(hover.metadata.name, 'WriteLine');
  assert.match(hover.metadata.owner, /Console$/);
  assert.equal(text.slice(hover.start, hover.end), 'WriteLine');
});

test('nameof and selected method-group conversions retain actual bound source references', () => {
  const text = 'class Widget { static void Target(){} static void Target(int value){} ' +
    'static void M(int input){int local=input;System.Action action=Target;' +
    'System.Console.WriteLine(nameof(Widget)+nameof(local)+nameof(input));} }';
  const {language, refactoring, workspace} = fixture({'Widget.cs': text});
  assert.equal(language.references('Widget.cs', text.indexOf('Widget')).length, 2);
  assert.equal(language.references('Widget.cs', text.indexOf('local')).length, 2);
  assert.equal(language.references('Widget.cs', text.indexOf('input')).length, 3);
  const target = language.references('Widget.cs', text.indexOf('Target'));
  assert.deepEqual(target.map(row => row.start), [text.indexOf('Target'), text.indexOf('action=Target') + 7]);
  const action = refactoring.rename('Widget.cs', text.indexOf('Widget'), 'Gadget');
  refactoring.apply(action);
  assert(workspace.documents.get('Widget.cs').source.text.includes('nameof(Gadget)'));
});
