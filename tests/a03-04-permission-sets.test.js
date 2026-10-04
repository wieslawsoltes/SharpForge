import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Writer, utf8, encodeCustomAttribute, decodeBinaryPermissionSet, CilError } from '@sharpforge/cil';

const root = new URL('./fixtures/permission-sets/', import.meta.url);
const fixture = () => JSON.parse(readFileSync(new URL('native.json', root), 'utf8'));
const bytes = name => Buffer.from(fixture().cases.find(value => value.name === name).blob, 'hex');

function permissionSet(arguments_, count = 1) {
  const encoded = encodeCustomAttribute([], [], arguments_);
  const body = new Writer().compressed(arguments_.length).bytes(encoded.subarray(4)).finish();
  const name = utf8('Example.Permission');
  const writer = new Writer().u8(0x2e).compressed(count);
  for (let index = 0; index < count; index++) writer.compressed(name.length).bytes(name).compressed(body.length).bytes(body);
  return writer.finish();
}

test('binary permission sets match native SRM empty, SecurityPermission and multi-attribute fixtures', () => {
  const reference = fixture();
  const source = readFileSync(new URL('oracle/Program.cs', root), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(createHash('sha256').update(source).digest('hex'), reference.sourceSha256);
  assert.match(reference.sdk, /^10\./);
  for (let count = 0; count < reference.cases.length; count++) {
    const result = decodeBinaryPermissionSet(Buffer.from(reference.cases[count].blob, 'hex'));
    assert.equal(result.format, 'binary');
    assert.deepEqual(result.attributes.map(attribute => ({ typeName: attribute.typeName,
      values: attribute.namedArguments.map(argument => ({ name: argument.name, isField: argument.isField,
        type: argument.value.type, value: argument.value.value })) })), reference.expected.slice(0, count));
  }
});

test('compressed named-argument counts exceed one byte and preserve field/property distinctions', () => {
  const named = Array.from({ length: 130 }, (_, index) => ({ name: 'Flag' + index, isField: Boolean(index % 2),
    type: 'bool', value: Boolean(index % 3) }));
  const result = decodeBinaryPermissionSet(permissionSet(named));
  assert.equal(result.attributes[0].namedArguments.length, 130);
  assert.equal(result.attributes[0].namedArguments[129].name, 'Flag129');
  assert.equal(result.attributes[0].namedArguments[129].isField, true);
});

test('typed array/null values reuse the custom-attribute grammar and own their input', () => {
  const input = Buffer.from(permissionSet([{ name: 'Names', isField: false,
    type: { kind: 'szarray', element: 'string' }, value: ['first', null] }]));
  const result = decodeBinaryPermissionSet(input.subarray(0));
  input.fill(0);
  assert.deepEqual(result.attributes[0].namedArguments[0].value.value.map(value => value.value), ['first', null]);
});

test('bad format, truncation and trailing bytes are explicit diagnostics', () => {
  for (const malformed of [new Uint8Array(), Uint8Array.of(0x2e), Uint8Array.of(0x2e, 1),
    Uint8Array.of(0x2e, 1, 0xff, 0), Uint8Array.of(0x2e, 0, 0),
    bytes('security').subarray(0, bytes('security').length - 1)]) {
    assert.throws(() => decodeBinaryPermissionSet(malformed), error => error instanceof CilError && error.code === 'MD0141');
  }
  assert.throws(() => decodeBinaryPermissionSet(utf8('<PermissionSet/>')), { code: 'MD0140' });
  assert.throws(() => decodeBinaryPermissionSet(null), { code: 'MD0141' });
  const badNamed = bytes('security');
  const namedTag = badNamed.indexOf(Buffer.from([0x54, 2, 9]));
  assert(namedTag > 0);
  badNamed[namedTag] = 0x55;
  assert.throws(() => decodeBinaryPermissionSet(badNamed), { code: 'MD0105' });
});

test('aggregate attributes, named values and string sizes are bounded without copying blobs', () => {
  assert.throws(() => decodeBinaryPermissionSet(bytes('multiple'), { maxAttributes: 1 }), { code: 'MD0142' });
  assert.throws(() => decodeBinaryPermissionSet(Uint8Array.of(0x2e, 0), { maxBytes: 1 }), { code: 'MD0142' });
  for (const value of [-1, NaN, 100001]) {
    assert.throws(() => decodeBinaryPermissionSet(bytes('empty'), { maxAttributes: value }), { code: 'MD0142' });
  }
  assert.throws(() => decodeBinaryPermissionSet(bytes('security'), { maxStringBytes: 2 }), { code: 'MD0108' });
  const named = [{ name: 'Flag', isField: false, type: 'bool', value: true }];
  assert.doesNotThrow(() => decodeBinaryPermissionSet(permissionSet(named), { maxNodes: 4 }));
  assert.throws(() => decodeBinaryPermissionSet(permissionSet(named, 2), { maxNodes: 4 }), { code: 'MD0108' });
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => decodeBinaryPermissionSet(bytes('empty'), { signal: controller.signal }), { code: 'MD0143' });
});
