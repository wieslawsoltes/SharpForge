import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, decodeCoded, decodeCustomAttribute } from '@sharpforge/cil';
import { compileToAssembly, compileToReferenceAssembly } from '@sharpforge/compiler';

const source = `using System;
[AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
public class TagAttribute : Attribute { public TagAttribute(string value) { } }
[Tag("before")][Serializable][Tag("after")]
public class Interleaved {
  [Tag("field-before")][NonSerialized][Tag("field-after")]
  public int Field;
}
[Tag("delegate-type")]
[return: Tag("delegate-return")]
public delegate string Callback(int value);`;

function attributesOf(inspector) {
  const metadata = inspector.metadata;
  return (metadata.rows[12] ?? []).map(([parent, constructor, blob]) => {
    const method = decodeCoded('CustomAttributeType', constructor);
    const owner = inspector.resolveToken(method).owner;
    const attribute = { parent: decodeCoded('HasCustomAttribute', parent), owner };
    if (owner === 'TagAttribute') {
      const decoded = decodeCustomAttribute(metadata.blob(blob), method, { metadata });
      assert.equal(decoded.success, true);
      attribute.label = decoded.constructorArguments[0].value;
    }
    return attribute;
  });
}

test('A03-T22 lazy attribute dispatch preserves interleaving and exact delegate return targets', () => {
  for (const [mode, emit, options] of [
    ['executable', compileToAssembly, {}],
    ['metadata', compileToReferenceAssembly, {}],
    ['refout', compileToReferenceAssembly, { refout: true }],
  ]) {
    const result = emit(source, { name: 'AttributeDispatch', outputKind: 'library', ...options });
    assert.equal(result.success, true, `${mode}: ${JSON.stringify(result.diagnostics)}`);
    const inspector = new AssemblyInspector(result.assembly);
    const metadata = inspector.metadata;
    const attributes = attributesOf(inspector);
    const tags = attributes.filter(attribute => attribute.owner === 'TagAttribute');
    const labels = parent => tags.filter(attribute => attribute.parent === parent).map(attribute => attribute.label);
    const interleaved = inspector.types.find(type => type.name === 'Interleaved');
    const field = interleaved.fields.find(field => field.name === 'Field');
    assert.deepEqual(labels(interleaved.token), ['before', 'after'], mode);
    assert.deepEqual(labels(field.token), ['field-before', 'field-after'], mode);
    assert.equal(interleaved.flags & 0x2000, 0x2000, mode);
    assert.equal(field.flags & 0x80, 0x80, mode);
    assert.equal(attributes.some(attribute => attribute.owner === 'System.SerializableAttribute'
      || attribute.owner === 'System.NonSerializedAttribute'), false, mode);

    const callback = inspector.types.find(type => type.name === 'Callback');
    assert.deepEqual(labels(callback.token), ['delegate-type'], mode);
    const returnTargets = [];
    for (const name of ['Invoke', 'EndInvoke', 'BeginInvoke', '.ctor']) {
      const method = callback.methods.find(method => method.name === name);
      assert.ok(method, `${mode}: missing ${name}`);
      const returns = metadata.list(method.token, 'ParamList').filter(parameter => metadata.row(parameter)[1] === 0);
      if (name === 'Invoke' || name === 'EndInvoke') {
        assert.equal(returns.length, 1, `${mode}: ${name}`);
        assert.deepEqual(labels(returns[0]), ['delegate-return'], `${mode}: ${name}`);
        returnTargets.push(returns[0]);
      } else {
        assert.deepEqual(returns, [], `${mode}: ${name} must not inherit delegate return attributes`);
      }
    }
    assert.deepEqual(tags.filter(attribute => attribute.label === 'delegate-return').map(attribute => attribute.parent),
      returnTargets, `${mode}: return attributes belong only to Invoke and EndInvoke return parameters`);
  }
});
