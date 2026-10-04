import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceText } from '@sharpforge/text';
import { parse } from '@sharpforge/syntax';
import { compile, compileToIL, sourceMemberDefinitions, sourceTypeDefinitions } from '@sharpforge/compiler';
import { AssemblyInspector, loadAssembly } from '@sharpforge/cil';

const accesses = { public: 6, internal: 3, private: 1, protected: 4, protectedInternal: 5, privateProtected: 2 };
const apiSource = `namespace Boundary;
public class Api {
  public int PublicField;
  internal int InternalField;
  private int PrivateField;
  protected int ProtectedField;
  protected internal int ProtectedInternalField;
  private protected int PrivateProtectedField;
  public static int PublicMethod() { return 42; }
  internal static int InternalMethod() { return 42; }
  private static int PrivateMethod() { return 42; }
  protected static int ProtectedMethod() { return 42; }
  protected internal static int ProtectedInternalMethod() { return 42; }
  private protected static int PrivateProtectedMethod() { return 42; }
  public Api(int value) { PublicField = value; }
  internal Api() { PublicField = 1; }
  public int Value { get; private set; }
  public int ReadOnlyValue { get; } = 5;
}`;

function library(source = apiSource, options = {}) {
  const result = compileToIL(source, { name: 'Boundary', outputKind: 'library', ...options });
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}

test('source member definitions cover every image slot with exact access and private generated backing storage', () => {
  const files = [parse(new SourceText(apiSource, 'Api.cs'))];
  const compiled = compile(files, { name: 'Boundary', outputKind: 'library' });
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const definitions = sourceMemberDefinitions(files, compiled.image);
  assert.equal(definitions.version, 1);
  assert.equal(definitions.methods.length, compiled.image.methods.length);
  assert.equal(definitions.fields.length, compiled.image.types.reduce((total, type) => total + type.fields.length, 0));
  assert.equal(definitions.statics.length, compiled.image.statics.length);
  const owner = compiled.image.types.find(type => type.name.endsWith('Api'));
  for (const [access] of Object.entries(accesses)) {
    const prefix = access[0].toUpperCase() + access.slice(1);
    const field = owner.fields.find(item => item.name === prefix + 'Field');
    const method = compiled.image.methods.find(item => item.name === prefix + 'Method');
    assert.equal(definitions.fields.find(item => item.type === owner.id && item.index === field.index).access, access);
    assert.equal(definitions.methods.find(item => item.id === method.id).access, access);
  }
  for (const field of owner.fields.filter(item => item.name.includes('k__BackingField'))) {
    const definition = definitions.fields.find(item => item.type === owner.id && item.index === field.index);
    assert.equal(definition.access, 'private');
    assert.equal(definition.isReadOnly, field.name.includes('ReadOnlyValue'));
  }
  const setter = compiled.image.methods.find(item => item.name === 'set_Value');
  assert.equal(definitions.methods.find(item => item.id === setter.id).access, 'private');
});

test('source member metadata disambiguates overloads and partial classes by source location', () => {
  const files = [
    parse(new SourceText('namespace N; public partial class Api { public static int M(int x) { return x; } }', 'A.cs')),
    parse(new SourceText('namespace N; public partial class Api { internal static string M(string x) { return x; } }', 'B.cs')),
  ];
  const compiled = compile(files, { outputKind: 'library' });
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const definitions = sourceMemberDefinitions(files, compiled.image);
  for (const method of compiled.image.methods.filter(method => method.name === 'M')) {
    assert.equal(definitions.methods.find(item => item.id === method.id).access,
      method.parameters[0].type === 'int' ? 'public' : 'internal');
  }
  assert.throws(() => sourceMemberDefinitions(files, { types: [], methods: null, statics: [] }), /Invalid image members/);
  assert.throws(() => sourceMemberDefinitions(files, { types: [], methods: new Array(200001), statics: [] }), /definition limit/);
  assert.throws(() => sourceMemberDefinitions(files, { types: [{ name: 'Api' }], methods: [], statics: [] }), /field tables/);
});

test('compileToIL emits source access flags, constructor access and readonly backing fields into real metadata', () => {
  const result = library();
  const inspector = new AssemblyInspector(result.assembly);
  const api = inspector.types.find(type => type.name === 'Boundary.Api');
  assert(api);
  for (const [access, flags] of Object.entries(accesses)) {
    const prefix = access[0].toUpperCase() + access.slice(1);
    assert.equal(api.fields.find(field => field.name === prefix + 'Field').flags & 7, flags);
    assert.equal(api.methods.find(method => method.name === prefix + 'Method').flags & 7, flags);
  }
  const constructors = api.methods.filter(method => method.name === '.ctor')
    .filter(method => !inspector.signature(method.token).parameters.some(type => type.includes('AllocationToken')));
  assert.equal(constructors.find(method => inspector.signature(method.token).parameters.length === 1).flags & 7, 6);
  assert.equal(constructors.find(method => inspector.signature(method.token).parameters.length === 0).flags & 7, 3);
  assert.equal(api.methods.find(method => method.name === 'get_Value').flags & 7, 6);
  assert.equal(api.methods.find(method => method.name === 'set_Value').flags & 7, 1);
  const backing = api.fields.find(field => field.name === '<ReadOnlyValue>k__BackingField');
  assert.equal(backing.flags & 7, 1);
  assert.equal(backing.flags & 0x20, 0x20);
  assert.equal(loadAssembly(result.assembly).outputKind, 'library', 'Canonical loading retains metadata profile choices');
});

const tree = (text, uri = 'Code.cs') => parse(new SourceText(text, uri));

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

