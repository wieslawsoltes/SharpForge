/** Test-only direct csc/native interop, using an installed SDK and its actual reference pack. */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { locateReferencePack, readReferenceFiles } from '@sharpforge/compiler/node';
import { createReferenceSet } from '@sharpforge/compiler';

function sdkOrder(left, right) {
  const a = left.split(/[.-]/).map(Number);
  const b = right.split(/[.-]/).map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (b[index] ?? 0) - (a[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

/** Discovery is read-only; absent SDKs are explicit skips, never substituted with a fabricated reference result. */
export function locateInteropToolchain() {
  const pack = locateReferencePack();
  if (!pack) return null;
  const root = resolve(pack.directory, '../../../../..');
  const dotnet = process.env.DOTNET ?? join(root, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');
  const sdkDirectory = join(root, 'sdk');
  if (!existsSync(dotnet) || !existsSync(sdkDirectory)) return null;
  const sdk = readdirSync(sdkDirectory).filter(name => /^\d+\.\d+\.\d+/.test(name) && Number(name.split('.')[0]) >= 10).sort(sdkOrder)[0];
  if (!sdk) return null;
  const compiler = join(sdkDirectory, sdk, 'Roslyn', 'bincore', 'csc.dll');
  if (!existsSync(compiler)) return null;
  return { dotnet, compiler, sdk, pack, references: createReferenceSet(readReferenceFiles(pack.files)) };
}

/** Each test owns a bounded temporary directory and removes it even when compilation or execution fails. */
export function interopScratch(toolchain) {
  const directory = mkdtempSync(join(tmpdir(), 'sharpforge-extension-export-'));
  const references = ['System.Runtime.dll', 'System.Console.dll'].map(name => '-r:' + join(toolchain.pack.directory, name));
  const options = ['-nologo', '-noconfig', '-nostdlib+', '-langversion:14.0', '-nullable:enable', '-deterministic+', '-optimize+'];
  return {
    directory,
    write(name, bytes) { writeFileSync(join(directory, name), bytes); },
    compile(source, { name = 'Consumer', library = 'ExtensionExports', target = 'exe', warnAsError = false } = {}) {
      const path = join(directory, name + '.cs');
      writeFileSync(path, source);
      const flags = [...options, '-target:' + target, '-out:' + join(directory, name + '.dll'), ...references];
      if (library) flags.push('-r:' + join(directory, library + '.dll'));
      if (warnAsError) flags.push('-warnaserror+');
      const result = spawnSync(toolchain.dotnet, [toolchain.compiler, ...flags, path], { encoding: 'utf8', timeout: 30_000 });
      if (result.error) throw result.error;
      return { status: result.status, output: String(result.stdout ?? '') + String(result.stderr ?? '') };
    },
    run(name = 'Consumer') {
      writeFileSync(join(directory, name + '.runtimeconfig.json'), JSON.stringify({ runtimeOptions: {
        tfm: toolchain.pack.targetFramework, framework: { name: 'Microsoft.NETCore.App', version: toolchain.pack.version },
      } }));
      return execFileSync(toolchain.dotnet, [join(directory, name + '.dll')], { encoding: 'utf8', timeout: 30_000 }).replace(/\r\n/g, '\n');
    },
    close() { rmSync(directory, { recursive: true, force: true }); },
  };
}
