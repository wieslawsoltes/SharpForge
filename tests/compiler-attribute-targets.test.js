import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, decodeCoded, decodeCustomAttribute } from '@sharpforge/cil';
import { compileToAssembly, compileToReferenceAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';

const declarations = `using System;
[assembly: Tag("assembly")]
[module: Tag("module")]
[AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
public class TagAttribute : Attribute { public TagAttribute(string name) { } }
[return: Tag("delegate-return")]
public delegate string Callback();
public class Container<[Tag("type-parameter")] T> {
  public class Nested<[Tag("nested-parameter")] U> { }
  [field: Tag("property-field")]
  [property: Tag("property")]
  public string Name { get; set; }
  [field: Tag("event-field")]
  [method: Tag("event-method")]
  [event: Tag("event")]
  public event Action Changed;
  [return: Tag("return")]
  public string Method<[Tag("method-parameter")] V>([Tag("argument")] int value) { return ""; }
  public int Number {
    [return: Tag("getter-return")] get { return 1; }
    [param: Tag("setter-value")] set { }
  }
}`;

function inspect(source, emit, options = {}) {
  const result = emit(source, { name: 'AttributeTargets', outputKind: 'library', ...options });
  assert.deepEqual(result.diagnostics.filter(entry => entry.severity === 'error'), []);
  assert.ok(result.assembly instanceof Uint8Array);
  const pe = new AssemblyInspector(result.assembly), metadata = pe.metadata;
  const attributes = (metadata.rows[12] ?? []).map(([parent, constructor, blob]) => {
    const ctor = decodeCoded('CustomAttributeType', constructor);
    const decoded = decodeCustomAttribute(metadata.blob(blob), ctor, { metadata });
    const owner = pe.resolveToken(ctor).owner;
    return { parent: decodeCoded('HasCustomAttribute', parent), owner, decoded };
  });
  const tags = new Map(attributes.filter(attribute => attribute.owner === 'TagAttribute').map(attribute => {
    assert.equal(attribute.decoded.success, true);
    return [attribute.decoded.constructorArguments[0].value, attribute.parent];
  }));
  return { pe, metadata, attributes, tags };
}

const pack = loadReferencePack();
for (const [name, emit] of [['executable', compileToAssembly], ['reference', compileToReferenceAssembly]]) {
  test(`A02-T41 ${name} attributes use module, return, backing-field, accessor and type-parameter targets`, () => {
    const { pe, metadata, attributes, tags } = inspect(declarations, emit);
    const type = pe.types.find(type => type.name === 'Container`1');
    const method = name => type.methods.find(method => method.name === name);
    assert.equal(tags.get('assembly'), 0x20000001);
    assert.equal(tags.get('module'), 0x00000001);
    assert.equal(tags.get('property-field'), type.fields.find(field => field.name === '<Name>k__BackingField').token);
    assert.equal(tags.get('property'), type.properties.find(property => property.name === 'Name').token);
    assert.equal(tags.get('event-field'), type.fields.find(field => field.name === 'Changed').token);
    assert.equal(tags.get('event'), type.events.find(event => event.name === 'Changed').token);
    const eventMethods = attributes.filter(attribute => attribute.owner === 'TagAttribute'
      && attribute.decoded.constructorArguments[0].value === 'event-method').map(attribute => attribute.parent);
    assert.deepEqual(eventMethods, [method('add_Changed').token, method('remove_Changed').token]);
    for (const tag of ['delegate-return', 'return', 'getter-return']) {
      const token = tags.get(tag);
      assert.equal(token >>> 24, 8, tag);
      assert.equal(metadata.row(token)[1], 0, tag);
    }
    const delegateReturns = attributes.filter(attribute => attribute.owner === 'TagAttribute'
      && attribute.decoded.constructorArguments[0].value === 'delegate-return');
    assert.equal(delegateReturns.length, 2, 'Invoke and EndInvoke both carry the return attribute');
    const setter = tags.get('setter-value');
    assert.equal(setter >>> 24, 8);
    assert.equal(metadata.string(metadata.row(setter)[2]), 'value');
    assert.equal(tags.get('argument') >>> 24, 8);
    for (const tag of ['type-parameter', 'nested-parameter', 'method-parameter']) assert.equal(tags.get(tag) >>> 24, 42, tag);
    const repeatedOuter = attributes.filter(attribute => attribute.owner === 'TagAttribute'
      && attribute.decoded.constructorArguments[0].value === 'type-parameter');
    assert.equal(repeatedOuter.length, 2, 'nested definitions redeclare outer generic parameters');
  });
}

test('A02-T41 constructed, nested, open generic, array and pointer typeof arguments serialize as reflection type names', {
  skip: pack ? false : 'no .NET reference pack installed',
}, () => {
  const source = `using System; using System.Collections.Generic;
    [AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
    public class ShapeAttribute : Attribute { public ShapeAttribute(Type value) { } }
    public class Outer<T> { public class Inner<U> { } }
    [Shape(typeof(Dictionary<string, Outer<int>.Inner<long>[]>))]
    [Shape(typeof(Dictionary<,>))]
    public class Shapes { }
    public unsafe class Pointer { [Shape(typeof(int*))] public int Field; }`;
  const { attributes } = inspect(source, compileToAssembly, { references: pack.references, allowUnsafe: true });
  const values = attributes.filter(attribute => attribute.owner === 'ShapeAttribute').map(attribute => {
    assert.equal(attribute.decoded.success, true);
    return attribute.decoded.constructorArguments[0].value;
  });
  assert.equal(values.length, 3);
  const dictionary = values.find(value => value.startsWith('System.Collections.Generic.Dictionary`2[['));
  assert.match(dictionary, /^System\.Collections\.Generic\.Dictionary`2\[\[System\.String, /);
  assert.match(dictionary, /Outer`1\+Inner`1\[\[System\.Int32, .*\],\[System\.Int64, .*\]\]\[\]/);
  assert.ok(values.some(value => /^System\.Collections\.Generic\.Dictionary`2, /.test(value)));
  assert.ok(values.some(value => /^System\.Int32\*, /.test(value)));
});

test('A02-T41 boxed typeof and array arguments carry their actual descriptor', () => {
  const source = `using System;
    [AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
    public class ShapeAttribute : Attribute { public ShapeAttribute(object value) { } }
    [Shape(typeof(int[]))] [Shape(new int[] { 2, 5 })] public class Shapes { }`;
  const { attributes } = inspect(source, compileToReferenceAssembly);
  const shapes = attributes.filter(attribute => attribute.owner === 'ShapeAttribute');
  assert.equal(shapes.length, 2);
  assert.ok(shapes.every(attribute => attribute.decoded.success));
  assert.equal(shapes[0].decoded.constructorArguments[0].value, 'System.Int32[]');
  assert.deepEqual(shapes[1].decoded.constructorArguments[0].value.map(element => element.value), [2, 5]);
});
