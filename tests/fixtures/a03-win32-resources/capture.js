import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileToIL } from '@sharpforge/compiler';

const [directory, reader] = process.argv.slice(2);
if (!directory || !reader) throw new Error('Usage: node capture.js OUTPUT_DIRECTORY LLVM_READOBJ_PATH');
mkdirSync(directory, { recursive: true });
const result = compileToIL('public class VersionedLibrary {}', {
  outputKind: 'library', name: 'SF-Win32', portablePdb: false,
  win32Resources: { version: { fileVersion: '1.2.345.65535', productName: 'SharpForge' },
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
