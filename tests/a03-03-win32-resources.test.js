import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';
import { writeWin32Resources, readWin32Resources, readPE, Writer, Reader, loadAssembly } from '@sharpforge/cil';

function icon() {
  const dib = new Writer().u32(40).u32(1).u32(2).u16(1).u16(32).u32(0).u32(4).zero(16).u32(0xff0066cc).u32(0).finish();
  return new Writer().u16(0).u16(1).u16(1).u8(1).u8(1).u8(0).u8(0).u16(1).u16(32).u32(dib.length).u32(22).bytes(dib).finish();
}
const manifest = '<?xml version="1.0" encoding="UTF-8"?><assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"/>';
const win32Resources = { version: { fileVersion: '1.2.345.65535', productVersion: '9.8.7.6', productName: 'SharpForge' },
  manifest, icon: icon() };
function compile(options = {}) {
  const result = compileToIL('Console.WriteLine(42);', { win32Resources, ...options });
  assert(result.success, JSON.stringify(result.diagnostics));
  return result;
}

test('A03 Win32 version, manifest and icon resources form an ordered native tree', () => {
  const result = compile();
  const pe = readPE(result.assembly), resources = readWin32Resources(pe, { includeBytes: true });
  assert.deepEqual(pe.sections.map(section => section.name), ['.text', '.rsrc']);
  assert.deepEqual(resources.map(resource => resource.type), [3, 14, 16, 24]);
  assert(resources.every(resource => resource.language === 0x409 && resource.name === 1));
  assert.equal(new TextDecoder().decode(resources[3].bytes), manifest);
  const fixed = new Reader(resources[2].bytes, 40, 52);
  assert.equal(fixed.u32(), 0xfeef04bd);
  assert.equal(fixed.u32(), 0x10000);
  assert.equal(fixed.u32(), 0x00010002);
  assert.equal(fixed.u32(), 345 * 65536 + 65535);
  assert.equal(fixed.u32(), 0x00090008);
  assert.equal(fixed.u32(), 0x00070006);
  const group = new Reader(resources[1].bytes);
  assert.deepEqual([group.u16(), group.u16(), group.u16()], [0, 1, 1]);
  group.take(12);
  assert.equal(group.u16(), 1);
  assert.equal(resources[0].size, 48);
  assert.equal(loadAssembly(result.assembly).entryPoint, result.image.entryPoint);
  assert.deepEqual(compile().assembly, result.assembly);
});

for (const options of [{ platform: 'anycpu' }, { platform: 'x64', framework: 'mscorlib4' }]) {
  test(`A03 ${options.platform} Win32 sections coexist with PDB attachment and executable thunks`, () => {
    const result = compile(options), pe = readPE(result.assembly);
    const dataSize = new DataView(pe.bytes.buffer, pe.bytes.byteOffset, pe.bytes.byteLength).getUint32(pe.optionalStart + 8, true);
    assert.equal(dataSize, pe.sections.filter(section => !(section.characteristics & 0x20)).reduce((size, section) => size + section.size, 0));
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

test('A03 named resource directories sort before numeric identifiers and replay byte-identically', () => {
  const entries = [
    { type: 100, name: 3, language: 0, bytes: Uint8Array.of(4) },
    { type: 'CUSTOM', name: 'Ω', language: 1045, bytes: Uint8Array.of(3), codePage: 65001 },
    { type: 'CUSTOM', name: 'A', language: 0, bytes: new Uint8Array() },
  ];
  const result = compile({ win32Resources: { entries } });
  const resources = readWin32Resources(readPE(result.assembly), { includeBytes: true });
  assert.deepEqual(resources.map(({ type, name }) => [type, name]), [['CUSTOM', 'A'], ['CUSTOM', 'Ω'], [100, 3]]);
  assert.equal(resources[1].codePage, 65001);
  assert.equal(loadAssembly(result.assembly).entryPoint, result.image.entryPoint);
  assert.deepEqual(writeWin32Resources({ entries }, { sectionRva: 0x4000 }),
    writeWin32Resources({ entries: [...entries].reverse() }, { sectionRva: 0x4000 }));
});

test('A03 malformed versions, icons, duplicate keys and unexpected options are explicit', () => {
  for (const options of [null, { version: { fileVersion: '1.2' } }, { version: { fileVersion: '1.2.3.65536' } },
    { version: { fileVersion: '1.2.3.4', companyName: 'bad\0name' } }, { manifest: '' }, { icon: new Uint8Array(6) },
    { language: -1 }, { unknown: true }, { entries: [], manifest }, { entries: new Array(65536) },
    { entries: [{ type: 1, name: 1, language: 0, bytes: [] }] }]) {
    assert.throws(() => writeWin32Resources(options, { sectionRva: 0x4000 }), /Win32|Truncated/);
  }
  const entry = { type: 1, name: 1, language: 0, bytes: new Uint8Array() };
  assert.throws(() => writeWin32Resources({ entries: [entry, entry] }, { sectionRva: 0x4000 }), /Duplicate/);
  const ico = icon();
  new DataView(ico.buffer).setUint32(18, 0xffffffff, true);
  assert.throws(() => writeWin32Resources({ icon: ico }, { sectionRva: 0x4000 }), /image range/);
  assert.throws(() => writeWin32Resources({}, { sectionRva: 0xfffffff0 }), /section RVA/);
});

test('A03 resource tree readers bound all offsets and reject cycles or excess depth', () => {
  const result = compile({ portablePdb: false });
  for (const mutation of ['cycle', 'offset', 'size']) {
    const bytes = result.assembly.slice(), pe = readPE(bytes);
    const offset = pe.offsetOf(pe.directories.resource.rva), view = new DataView(bytes.buffer);
    if (mutation === 'cycle') view.setUint32(offset + 20, 0x80000000, true);
    if (mutation === 'offset') view.setUint32(offset + 20, 0x8fffffff, true);
    if (mutation === 'size') pe.directories.resource.size = 15;
    assert.throws(() => readWin32Resources(pe), /Win32/);
  }
});


test('A03 Win32 resource copies own Buffer payloads from offset subarrays', () => {
  const compiled = compile();
  const carrier = Buffer.alloc(compiled.assembly.length + 16, 0x78);
  const bytes = carrier.subarray(5, 5 + compiled.assembly.length);
  bytes.set(compiled.assembly);
  const before = Buffer.from(carrier);
  for (const resource of readWin32Resources(readPE(bytes), { includeBytes: true })) resource.bytes.fill(0);
  assert.equal(loadAssembly(bytes).entryPoint, compiled.image.entryPoint);
  assert.deepEqual(carrier, before);
});


test('A03 fresh Win32 payloads match independent LLVM resource tree and byte observations', () => {
  const reference = JSON.parse(readFileSync(new URL('./fixtures/a03-win32-resources/llvm.json', import.meta.url), 'utf8'));
  assert.match(reference.version, /LLVM version 22\.1\.8/);
  const result = compileToIL('public class VersionedLibrary {}', {
    outputKind: 'library', name: 'SF-Win32', portablePdb: false,
    win32Resources: { icon: icon(), version: { fileVersion: '1.2.345.65535', productName: 'SharpForge' },
      manifest: '<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"/>' },
  });
  assert(result.success, JSON.stringify(result.diagnostics));
  const observed = [...reference.output.matchAll(/Type: [^\n]+ \(ID (\d+)\) \[([\s\S]*?)(?=\n  Type:|\n\]\n|$)/g)].map(match => {
    const body = match[2];
    const hex = [...body.matchAll(/^\s*[0-9A-F]+: ([0-9A-F ]+)\s+\|/gm)].map(line => line[1].replaceAll(' ', '')).join('');
    return { type: Number(match[1]), name: Number(body.match(/Name: \(ID (\d+)\)/)[1]),
      language: Number(body.match(/Language: \(ID (\d+)\)/)[1]), codePage: Number(body.match(/Codepage: (\d+)/)[1]),
      size: Number(body.match(/DataSize: (\d+)/)[1]), bytes: new Uint8Array(Buffer.from(hex, 'hex')) };
  });
  assert.equal(observed.length, 4);
  assert.deepEqual(readWin32Resources(readPE(result.assembly), { includeBytes: true }), observed);
});
