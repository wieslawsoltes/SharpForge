import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileToIL } from '@sharpforge/compiler';
import { Writer } from '@sharpforge/cil';

const [directory, reader] = process.argv.slice(2);
if (!directory || !reader) throw new Error('Usage: node capture.js OUTPUT_DIRECTORY LLVM_READOBJ_PATH');
mkdirSync(directory, { recursive: true });
const image = new Writer().u32(40).u32(1).u32(2).u16(1).u16(32).u32(0).u32(4).zero(16).u32(0xff0066cc).u32(0).finish();
const icon = new Writer().u16(0).u16(1).u16(1).u8(1).u8(1).u8(0).u8(0).u16(1).u16(32).u32(image.length).u32(22).bytes(image).finish();
const result = compileToIL('public class VersionedLibrary {}', {
  outputKind: 'library', name: 'SF-Win32', portablePdb: false,
  win32Resources: { icon, version: { fileVersion: '1.2.345.65535', productName: 'SharpForge' },
    manifest: '<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"/>' },
});
if (!result.success) throw new Error(JSON.stringify(result.diagnostics));
const path = join(directory, 'SF-Win32.dll');
writeFileSync(path, result.assembly);
function run(args) {
  const process = spawnSync(reader, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (process.error) throw process.error;
  if (process.status !== 0) throw new Error(process.stderr);
  return process.stdout.replaceAll(path, '<fixture>').replaceAll('\r\n', '\n');
}
writeFileSync(new URL('./llvm.json', import.meta.url), JSON.stringify({ version: run(['--version']),
  output: run(['--coff-resources', '--file-headers', path]) }, null, 2) + '\n');
