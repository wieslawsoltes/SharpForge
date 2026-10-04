import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compileToIL } from '@sharpforge/compiler';
import { readPE, loadAssembly, MetadataBuilder, writePE } from '@sharpforge/cil';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

const keys = JSON.parse(readFileSync(new URL('./fixtures/clr-identity/public-keys.json', import.meta.url), 'utf8')).cases;
const publicKey = new Uint8Array(Buffer.from(keys[1].key, 'hex'));
function compile(options = {}) {
  const result = compileToIL('Console.WriteLine(42);', { publicKey, ...options });
  assert(result.success, JSON.stringify(result.diagnostics));
  return result;
}
function reservation(pe) {
  const directory = pe.strongNameSignature, offset = pe.offsetOf(directory.rva, directory.size);
  return pe.bytes.subarray(offset, offset + directory.size);
}

for (const mode of ['publicSign', 'delaySign']) {
  for (const platform of ['anycpu', 'x86', 'x64', 'arm64']) {
    test(`A03 ${mode} ${platform} preserves public identity, zero reservation and both JS engines`, () => {
      const result = compile({ [mode]: true, platform }), pe = readPE(result.assembly);
      const assembly = pe.metadata.rows[32][0];
      assert.equal(assembly[5] & 1, 1);
      assert.deepEqual(pe.metadata.blob(assembly[6]), publicKey);
      assert.equal(Buffer.from(createHash('sha1').update(publicKey).digest().subarray(-8)).reverse().toString('hex'), keys[1].token);
      assert.equal(pe.corFlags & 8, mode === 'publicSign' ? 8 : 0);
      assert.equal(pe.strongNameSignature.size, 128);
      assert.equal(pe.strongNameSignature.rva % 4, 0);
      assert(reservation(pe).every(byte => byte === 0));
      assert.equal(loadAssembly(result.assembly).entryPoint, result.image.entryPoint);
      assert.deepEqual(compile({ [mode]: true, platform }).assembly, result.assembly);
      for (const Engine of [VirtualMachine, CilVirtualMachine]) {
        const vm = new Engine(result.assembly);
        try {
          const execution = vm.run();
          assert.equal(execution.state, 'terminated', execution.fault?.message);
          assert.equal(execution.output, '42\n');
        } finally { vm.stop(); }
      }
    });
  }
}

test('A03 public-sign diagnostics reject unsupported signing and malformed key inputs', () => {
  const malformed = publicKey.slice();
  malformed[8] ^= 1;
  for (const options of [{}, { publicSign: true, delaySign: true }, { publicSign: 1 }, { delaySign: 'true' },
    { publicSign: true, publicKey: [] }, { publicSign: true, publicKey: new Uint8Array(8) },
    { publicSign: true, publicKey: malformed }, { publicSign: true, privateKey: new Uint8Array(128) },
    { keyFile: 'private.snk' }, { signAssembly: true }]) {
    const result = compileToIL('Console.WriteLine(42);', { publicKey, ...options });
    assert.equal(result.success, false, JSON.stringify(options));
    assert(result.diagnostics.some(value => value.code === 'SF3001'));
  }
});

test('A03 public-key Buffer subarrays are read-only and reservations coexist with embedded resources', () => {
  const carrier = Buffer.alloc(publicKey.length + 16, 0x5a), input = carrier.subarray(7, 7 + publicKey.length);
  input.set(publicKey);
  const before = Buffer.from(carrier);
  const result = compile({ publicKey: input, publicSign: true,
    managedResources: [{ name: 'data', bytes: Uint8Array.of(1, 2, 3) }] });
  assert.deepEqual(carrier, before);
  const pe = readPE(result.assembly);
  assert(pe.resources.rva + pe.resources.size <= pe.strongNameSignature.rva);
  assert(pe.strongNameSignature.rva + pe.strongNameSignature.size <= pe.metadataDirectory.rva);
  const tampered = result.assembly.slice();
  tampered[pe.offsetOf(pe.strongNameSignature.rva, 1)] = 1;
  assert.throws(() => loadAssembly(tampered), /RSA strong-name signing is unsupported/);
});

test('A03 low-level strong-name reservation rejects metadata overlap, nonzero bytes and invalid ranges', () => {
  const metadata = new MetadataBuilder('SignatureRanges').finish(), section = new Uint8Array(200 + metadata.length);
  section.set(metadata, 200);
  for (const strongNameSignature of [{ offset: 72, size: 128, publicSign: true }, { offset: 72, size: 128, publicSign: false }]) {
    const pe = readPE(writePE(section, 200, metadata.length, 0, { strongNameSignature }));
    assert.equal(pe.corFlags & 8, strongNameSignature.publicSign ? 8 : 0);
  }
  for (const signature of [{ offset: 71, size: 128 }, { offset: 76, size: 128 }, { offset: 72, size: 63 },
    { offset: 72, size: 2049 }, { offset: 72, size: 128, publicSign: 1 }]) {
    assert.throws(() => writePE(section, 200, metadata.length, 0,
      { strongNameSignature: { publicSign: true, ...signature } }), /strong-name signature range/);
  }
  section[72] = 1;
  assert.throws(() => writePE(section, 200, metadata.length, 0,
    { strongNameSignature: { offset: 72, size: 128, publicSign: true } }), /must be zero/);
});

test('A03 emitted public/delay-sign identities match native AssemblyName and PEReader observations', () => {
  const native = JSON.parse(readFileSync(new URL('./fixtures/a03-public-sign/native.json', import.meta.url), 'utf8'));
  assert.match(native.runtime, /^\.NET /);
  assert.equal(native.cases.length, 8);
  for (const value of native.cases) {
    assert.equal(value.publicKeyToken, keys[1].token);
    assert.equal(value.signatureSize, 128);
    assert.equal(value.zeroSignature, true);
    assert.equal(value.publicKeyFlag, true);
    assert.equal(value.strongNameSigned, value.mode === 'publicSign');
  }
});
