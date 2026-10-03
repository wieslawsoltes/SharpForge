import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileToIL } from '@sharpforge/compiler';
import { readPE, win32VersionFromAssembly } from '@sharpforge/cil';

const [directory, assemblyPath, reader] = process.argv.slice(2);
if (!directory || !assemblyPath || !reader) throw new Error('Usage: capture.js OUTPUT_DIRECTORY ROSLYN_ASSEMBLY LLVM_READOBJ');
mkdirSync(directory, { recursive: true });
const assembly = readFileSync(assemblyPath), version = win32VersionFromAssembly(readPE(assembly));
const result = compileToIL('public class Versioned {}', { name: 'Projected', outputKind: 'library', portablePdb: false,
  win32Resources: { version } });
if (!result.success) throw new Error(JSON.stringify(result.diagnostics));
const path = join(directory, 'Projected.dll');
writeFileSync(path, result.assembly);
function run(args) {
  const result = spawnSync(reader, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.replaceAll(path, '<fixture>').replaceAll('\r\n', '\n');
}
writeFileSync(new URL('./native.json', import.meta.url), JSON.stringify({
  compiler: 'Roslyn 5.3.0-2.26153.122 / SDK 10.0.201', assemblyBase64: assembly.toString('base64'),
  llvmVersion: run(['--version']), llvmOutput: run(['--coff-resources', path]),
}, null, 2) + '\n');
