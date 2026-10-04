import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';
import { MetadataBuilder, readPE, readManagedResources, writeManagedResources, writePE, inspectAssembly, loadAssembly } from '@sharpforge/cil';

const resources = [
  { name: 'visible.bin', bytes: Uint8Array.of(0, 255, 128, 1), visibility: 'public' },
  { name: 'private/空.txt', bytes: new TextEncoder().encode('resource\0data'), visibility: 'private' },
  { name: 'empty', bytes: new Uint8Array() },
];
function compile(options = {}) {
  const result = compileToIL('Console.WriteLine(42);', { managedResources: resources, ...options });
  assert(result.success, JSON.stringify(result.diagnostics));
  return result;
}

test('A03 managed resources preserve bytes, flags, eight-byte offsets and inspector sizes', () => {
  const compiled = compile();
  const pe = readPE(compiled.assembly);
  assert.equal(pe.resources.rva % 8, 0);
  const decoded = readManagedResources(pe, { includeBytes: true });
  assert.deepEqual(decoded.map(resource => resource.name), resources.map(resource => resource.name));
  assert.deepEqual(decoded.map(resource => resource.flags), [1, 2, 1]);
  assert.deepEqual(decoded.map(resource => resource.offset), [0, 8, 32]);
  for (const [index, resource] of decoded.entries()) {
    assert.deepEqual(resource.bytes, resources[index].bytes);
    assert.equal(resource.size, resources[index].bytes.length);
    assert.equal(resource.implementation, 0);
    resource.bytes.fill(42);
  }
  assert.deepEqual(readManagedResources(pe, { includeBytes: true })[0].bytes, resources[0].bytes);
  const summary = inspectAssembly(compiled.assembly);
  assert.deepEqual(summary.resources.map(resource => resource.size), resources.map(resource => resource.bytes.length));
  assert(summary.resources.every(resource => !Object.hasOwn(resource, 'bytes')));
  assert.deepEqual(compile().assembly, compiled.assembly);
});

for (const platform of ['anycpu', 'x86', 'x64', 'arm64']) {
  test(`A03 resources retain both JavaScript execution engines on ${platform}`, () => {
    const compiled = compile({ platform });
    for (const Engine of [VirtualMachine, CilVirtualMachine]) {
      const vm = new Engine(compiled.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.message);
        assert.equal(result.output, '42\n');
      } finally { vm.stop(); }
    }
  });
}

test('A03 resource emission rejects invalid names, duplicates, visibility, payloads and excessive count', () => {
  for (const managedResources of [null, {}, [{ name: '', bytes: new Uint8Array() }],
    [{ name: 'a\0b', bytes: new Uint8Array() }], [{ name: '\ud800', bytes: new Uint8Array() }],
    [{ name: 'x', bytes: [] }], [{ name: 'x', bytes: new Uint8Array(), visibility: 'protected' }],
    [resources[0], resources[0]], new Array(65536)]) {
    const builder = new MetadataBuilder('InvalidResources');
    assert.throws(() => writeManagedResources(managedResources, builder), /managed resource|Managed resource/);
    assert.equal(builder.rows[40]?.length ?? 0, 0, 'Validation must precede metadata mutation');
  }
  const rejected = compileToIL('Console.WriteLine(42);', { managedResources: [resources[0], resources[0]] });
  assert.equal(rejected.success, false);
  assert(rejected.diagnostics.some(diagnostic => /Duplicate managed resource/.test(diagnostic.message)));
});

test('A03 resource reading bounds the length prefix, blob and directory before returning bytes', () => {
  const compiled = compile({ portablePdb: false });
  const pe = readPE(compiled.assembly);
  assert.throws(() => readManagedResources(pe, { maxResourceBytes: 1 }), /size limit/);
  assert.throws(() => readManagedResources(pe, { maxResourceBytes: -1 }), /size limit/);
  const mutated = compiled.assembly.slice();
  const resourceAt = pe.offsetOf(pe.resources.rva, pe.resources.size);
  new DataView(mutated.buffer).setUint32(resourceAt, 0xffffffff, true);
  assert.throws(() => readManagedResources(readPE(mutated)), /Truncated/);
  const outside = readPE(compiled.assembly);
  outside.metadata.rows[40][0][0] = outside.resources.size - 3;
  assert.throws(() => readManagedResources(outside), /offset/);
  const absent = readPE(compiled.assembly);
  absent.resources.size = 0;
  assert.throws(() => readManagedResources(absent), /offset/);
});

test('A03 reader describes external resources without dereferencing their offsets', () => {
  const metadata = new MetadataBuilder('ExternalResources');
  const file = metadata.manifest.file({ Flags: 0, Name: 'external.dat', HashValue: Uint8Array.of(1) });
  metadata.manifest.manifestResource({ Offset: 1234, Flags: 1, Name: 'external', Implementation: file });
  const data = metadata.finish();
  const section = new Uint8Array(72 + data.length);
  section.set(data, 72);
  assert.deepEqual(readManagedResources(readPE(writePE(section, 72, data.length, 0))), [
    { offset: 1234, flags: 1, name: 'external', implementation: file, size: null },
  ]);
});

test('A03 low-level resource ranges cannot overlap metadata or exceed their section', () => {
  const metadata = new MetadataBuilder('ResourceRanges').finish();
  const section = new Uint8Array(80 + metadata.length);
  section.set(metadata, 80);
  for (const resources of [{ offset: 80, size: 4 }, { offset: 71, size: 1 }, { offset: 72, size: 0xffffffff }]) {
    assert.throws(() => writePE(section, 80, metadata.length, 0, { resources }), /resource range/);
  }
});


test('A03 Buffer and offset-subarray resource reads and canonical loads never mutate caller storage', () => {
  const compiled = compile();
  const carrier = Buffer.alloc(compiled.assembly.length + 32, 0x7b);
  const input = carrier.subarray(13, 13 + compiled.assembly.length);
  input.set(compiled.assembly);
  const before = Buffer.from(carrier), pe = readPE(input);
  const resource = readManagedResources(pe, { includeBytes: true })[0];
  resource.bytes.fill(42);
  pe.metadata.guid(pe.metadata.rows[0][0][2]).fill(42);
  assert.deepEqual(carrier, before, 'Payload and GUID copies must own their buffers');
  assert.equal(loadAssembly(input).entryPoint, compiled.image.entryPoint);
  assert.deepEqual(carrier, before, 'Canonical header comparison must not mutate Buffer input');
});

test('A03 low-level PE emission copies Buffer slices before writing the CLI header', () => {
  const metadata = new MetadataBuilder('BufferSection').finish();
  const carrier = Buffer.alloc(100 + metadata.length, 0x5a);
  const section = carrier.subarray(11, 11 + 72 + metadata.length);
  section.fill(0);
  section.set(metadata, 72);
  const before = Buffer.from(carrier);
  const emitted = writePE(section, 72, metadata.length, 0);
  assert.deepEqual(emitted, writePE(new Uint8Array(section), 72, metadata.length, 0));
  assert.deepEqual(carrier, before);
  assert.equal(readPE(emitted).metadata.string(readPE(emitted).metadata.rows[32][0][7]), 'BufferSection');
});
