import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToIL } from '@sharpforge/compiler';
import { readPE, Reader, loadAssembly } from '@sharpforge/cil';

function ascii(bytes, offset) {
  let text = '';
  while (bytes[offset]) text += String.fromCharCode(bytes[offset++]);
  return text;
}

for (const platform of ['anycpu', 'x86', 'x64']) {
  test(`A03 ${platform} desktop CLR entry stub has imports and relocations`, () => {
    const compiled = compileToIL('Console.WriteLine(7);', { framework: 'mscorlib4', platform });
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    const pe = readPE(compiled.assembly);
    assert.deepEqual(pe.sections.map(section => section.name), ['.text', '.reloc']);
    assert(pe.addressOfEntryPoint > 0);
    const imports = new Reader(pe.bytes, pe.offsetOf(pe.directories.import.rva), pe.directories.import.size);
    const lookup = imports.u32();
    imports.take(8);
    const library = imports.u32(), addresses = imports.u32();
    assert.equal(ascii(pe.bytes, pe.offsetOf(library)), 'mscoree.dll');
    const hint = new Reader(pe.bytes, pe.offsetOf(lookup)).u32();
    assert.equal(ascii(pe.bytes, pe.offsetOf(hint) + 2), '_CorExeMain');
    assert.equal(addresses, pe.directories.importAddressTable.rva);
    assert.equal(pe.directories.baseRelocation.size, 12);
    assert.equal(pe.bytes[pe.offsetOf(pe.addressOfEntryPoint)], 0xff);
    assert.equal(loadAssembly(compiled.assembly).entryPoint, compiled.image.entryPoint);
  });
}

test('A03 library desktop stubs use CorDllMain and unsupported ARM64 is explicit', () => {
  const library = compileToIL('public class Library {}', { framework: 'mscorlib4', outputKind: 'library' });
  assert(library.success, JSON.stringify(library.diagnostics));
  assert(new TextDecoder().decode(library.assembly).includes('_CorDllMain'));
  const rejected = compileToIL('Console.WriteLine(1);', { framework: 'mscorlib4', platform: 'arm64' });
  assert.equal(rejected.success, false);
  assert(rejected.diagnostics.some(diagnostic => diagnostic.message.includes('ARM64')));
});

test('A03 canonical multi-section loading rejects modified desktop import/stub bytes', () => {
  const compiled = compileToIL('Console.WriteLine(7);', { framework: 'mscorlib4' });
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  for (const kind of ['stub', 'imports']) {
    const bytes = compiled.assembly.slice();
    const pe = readPE(bytes);
    const at = kind === 'stub' ? pe.offsetOf(pe.addressOfEntryPoint) : pe.offsetOf(pe.directories.importAddressTable.rva);
    bytes[at] ^= 1;
    assert.throws(() => loadAssembly(bytes), /not canonical/);
  }
});
