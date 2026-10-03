import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';
import { readPE, buildId, deterministicContentId, peChecksum, finalizeDeterministicPE, loadAssembly } from '@sharpforge/cil';
import { attachPortablePdb } from '@sharpforge/symbols';

function compile(source = 'Console.WriteLine(42);', options = {}) {
  const result = compileToIL(source, options);
  assert(result.success, JSON.stringify(result.diagnostics));
  return result;
}
function checksumReference(bytes, offset) {
  let sum = 0n;
  for (let index = 0; index < bytes.length; index++) {
    if (index >= offset && index < offset + 4) continue;
    sum += BigInt(bytes[index]) << BigInt(index % 2 * 8);
  }
  while (sum > 65535n) sum = (sum & 65535n) + (sum >> 16n);
  return Number(sum + BigInt(bytes.length));
}

test('A03 SHA-256 identifiers use SRM content GUID and high-bit timestamp layout', () => {
  const input = new TextEncoder().encode('deterministic PE content');
  const hash = new Uint8Array(createHash('sha256').update(input).digest());
  const expected = hash.slice(0, 16);
  expected[7] = (expected[7] & 15) | 0x40;
  expected[8] = (expected[8] & 63) | 0x80;
  const identity = deterministicContentId(input);
  assert.deepEqual(identity.id, expected);
  assert.deepEqual(buildId(input), expected);
  assert.equal(identity.timestamp, (new DataView(hash.buffer).getUint32(16, true) | 0x80000000) >>> 0);
});

for (const platform of ['anycpu', 'x86', 'x64', 'arm64']) {
  test(`A03 ${platform} deterministic images and attached PDB checksums reproduce exactly`, () => {
    const first = compile(undefined, { platform }), second = compile(undefined, { platform });
    assert.deepEqual(first.assembly, second.assembly);
    assert.deepEqual(first.pdb, second.pdb);
    const pe = readPE(first.assembly);
    assert(pe.timestamp & 0x80000000);
    assert.equal(pe.checksum, peChecksum(first.assembly));
    assert.equal(pe.checksum, checksumReference(first.assembly, pe.optionalStart + 64));
    assert.equal(loadAssembly(first.assembly).entryPoint, first.image.entryPoint);
    for (const Engine of [VirtualMachine, CilVirtualMachine]) {
      const vm = new Engine(first.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.message);
        assert.equal(result.output, '42\n');
      } finally { vm.stop(); }
    }
  });
}

test('A03 changing one IL byte changes MVID and deterministic timestamp', () => {
  const first = compile(undefined, { portablePdb: false });
  const bytes = first.assembly.slice(), before = readPE(bytes);
  const mvid = before.metadata.guid(before.metadata.rows[0][0][2]);
  const body = before.methodBody(before.entryPoint);
  bytes[body.code.byteOffset - bytes.byteOffset] ^= 1;
  const changed = readPE(finalizeDeterministicPE(bytes));
  assert.notDeepEqual(changed.metadata.guid(changed.metadata.rows[0][0][2]), mvid);
  assert.notEqual(changed.timestamp, before.timestamp);
  assert.deepEqual(finalizeDeterministicPE(first.assembly), first.assembly, 'Finalization is idempotent');
});

test('A03 checksum ignores its old field and supports odd-length overlay data', () => {
  const first = compile(undefined, { portablePdb: false });
  const bytes = new Uint8Array(first.assembly.length + 1);
  bytes.set(first.assembly);
  bytes[bytes.length - 1] = 0xab;
  const pe = readPE(bytes), offset = pe.optionalStart + 64;
  const expected = checksumReference(bytes, offset);
  new DataView(bytes.buffer).setUint32(offset, 0xffffffff, true);
  assert.equal(peChecksum(bytes), expected);
  for (const input of [null, new Uint8Array(1), new Uint8Array(100)]) assert.throws(() => peChecksum(input));
});

test('A03 symbol reattachment recomputes checksum and detects checksum tampering', () => {
  const result = compile();
  const attached = attachPortablePdb(result.assembly, result.pdb, { embedded: true });
  assert.equal(readPE(attached).checksum, peChecksum(attached));
  const bytes = result.assembly.slice(), pe = readPE(bytes);
  bytes[pe.optionalStart + 64] ^= 1;
  assert.throws(() => loadAssembly(bytes), /not canonical/);
  const compatibility = compile(undefined, { deterministic: false });
  assert.equal(readPE(compatibility.assembly).timestamp, 0);
  assert.equal(readPE(compatibility.assembly).checksum, 0);
  assert.equal(loadAssembly(compatibility.assembly).entryPoint, compatibility.image.entryPoint);
});


test('A03 deterministic finalization owns its Buffer copy without mutating an offset subarray', () => {
  const compiled = compile(undefined, { portablePdb: false });
  const carrier = Buffer.alloc(compiled.assembly.length + 16, 0x5a);
  const bytes = carrier.subarray(7, 7 + compiled.assembly.length);
  bytes.set(compiled.assembly);
  const before = Buffer.from(carrier), finalized = finalizeDeterministicPE(bytes);
  assert.deepEqual(finalized, compiled.assembly);
  finalized.fill(0);
  assert.deepEqual(carrier, before);
});


test('A03 checksum excludes its four bytes even with an odd PE header offset', () => {
  const original = compile(undefined, { portablePdb: false }).assembly;
  const pe = readPE(original), bytes = new Uint8Array(original.length + 1);
  const peOffset = pe.optionalStart - 24;
  bytes.set(original.subarray(0, peOffset));
  bytes.set(original.subarray(peOffset), peOffset + 1);
  new DataView(bytes.buffer).setUint32(0x3c, peOffset + 1, true);
  const checksumOffset = pe.optionalStart + 65;
  assert.equal(peChecksum(bytes), checksumReference(bytes, checksumOffset));
});


test('A03 deterministic identity matches native System.Reflection.Metadata BlobContentId', () => {
  const reference = JSON.parse(readFileSync(new URL('./fixtures/a03-determinism/srm.json', import.meta.url), 'utf8'));
  assert.match(reference.runtime, /^\.NET /);
  for (const value of reference.cases) {
    const identity = deterministicContentId(Buffer.from(value.input, 'base64'));
    assert.equal(Buffer.from(identity.id).toString('hex'), value.guid);
    assert.equal(identity.timestamp, value.timestamp);
  }
});
