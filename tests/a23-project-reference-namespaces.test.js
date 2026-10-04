import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceText } from '@sharpforge/text';
import { parse } from '@sharpforge/syntax';
import { compileToIL, sourceTypeDefinitions } from '@sharpforge/compiler';
import { AssemblyInspector, loadAssembly } from '@sharpforge/cil';

const tree = (text, uri = 'Code.cs') => parse(new SourceText(text, uri));
const reference = bytes => ({ bytes, runtimeProfile: 'sharpforge' });

test('source declaration metadata matches semantic full names and legacy simple names without splitting generated names', () => {
  const files = [tree('namespace Models; public partial class Counter { }'),
    tree('namespace Models; partial class Counter { }', 'Part.cs')];
  const full = sourceTypeDefinitions(files, { types: [{ name: 'Models.Counter' }, { name: '<>Closure.Models.Counter' }] });
  assert.deepEqual(full['Models.Counter'], { name: 'Counter', namespace: 'Models', access: 'public' });
  assert.deepEqual(full['<>Closure.Models.Counter'], { name: '<>Closure.Models.Counter', namespace: '', access: 'internal' });
  const simple = sourceTypeDefinitions(files, { types: [{ name: 'Counter' }] });
  assert.deepEqual(simple.Counter, full['Models.Counter']);
  const colliding = sourceTypeDefinitions([tree('namespace Left { public class Item { } } namespace Right { class Item { } }')],
    { types: [{ name: 'Left.Item' }, { name: 'Right.Item' }] });
  assert.deepEqual(colliding['Left.Item'], { name: 'Item', namespace: 'Left', access: 'public' });
  assert.deepEqual(colliding['Right.Item'], { name: 'Item', namespace: 'Right', access: 'internal' });
});

test('source declaration metadata rejects malformed and excessive input explicitly', () => {
  assert.throws(() => sourceTypeDefinitions([{}], { types: [] }), /parsed compilation units/);
  assert.throws(() => sourceTypeDefinitions(new Array(20001), { types: [] }), /20000 parsed files/);
  assert.throws(() => sourceTypeDefinitions([], { types: new Array(100001) }), /definition limit/);
});

test('public compileToIL emits real source namespaces that a separate consumer binds through metadata', () => {
  const library = compileToIL('namespace Company.Models; public class Counter { '
    + 'public int Value; public Counter(int value) { Value = value; } public void Add(int value) { Value += value; } }',
  { name: 'Models', outputKind: 'library' });
  assert.equal(library.success, true, JSON.stringify(library.diagnostics));
  const inspector = new AssemblyInspector(library.assembly);
  const counter = inspector.types.find(type => type.name === 'Company.Models.Counter');
  assert(counter, 'The assembly must expose Company.Models.Counter');
  const row = inspector.metadata.row(counter.token);
  assert.equal(inspector.metadata.string(row[1]), 'Counter');
  assert.equal(inspector.metadata.string(row[2]), 'Company.Models');
  assert.equal(counter.flags & 7, 1);
  assert.equal(loadAssembly(library.assembly).outputKind, 'library');
  const application = compileToIL('using Company.Models; var c = new Counter(40); c.Add(2); System.Console.WriteLine(c.Value);',
    { name: 'App', references: [reference(library.assembly)] });
  assert.equal(application.success, true, JSON.stringify(application.diagnostics));
  assert.equal(application.image.externalReferences.types[0].name, 'Company.Models.Counter');
  assert.equal(new AssemblyInspector(application.assembly).types.some(type => type.name.endsWith('Counter')), false);
});

test('public compileToIL preserves internal source visibility across a separate assembly boundary', () => {
  const library = compileToIL('namespace Company.Models; class Hidden { public static int Answer() { return 42; } }',
    { name: 'Models', outputKind: 'library' });
  assert.equal(library.success, true, JSON.stringify(library.diagnostics));
  const hidden = new AssemblyInspector(library.assembly).types.find(type => type.name === 'Company.Models.Hidden');
  assert(hidden);
  assert.equal(hidden.flags & 7, 0);
  const application = compileToIL('System.Console.WriteLine(Company.Models.Hidden.Answer());',
    { name: 'App', references: [reference(library.assembly)] });
  assert.equal(application.success, false);
  assert(application.diagnostics.some(diagnostic => diagnostic.code === 'CS0122'), JSON.stringify(application.diagnostics));
});
