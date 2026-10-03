import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { root, pin, sha256, readJSON } from './common.js';
import { resolveToolchain } from '../oracle/toolchain.js';
import { loadFixture } from '../oracle/fixtures.js';
import { compileFixture, assertDeterministic } from '../oracle/roslyn-compile.js';
import { runProcess } from '../oracle/process.js';

let compiled;
export async function extractNative(mode, inputs, { signal, toolchain } = {}) {
  toolchain ??= await resolveToolchain();
  const sourceRoot = path.join(root, 'tests/conformance/inventory/metadata');
  compiled ??= compileFixture(await loadFixture({ id: 'reference-metadata-reader', source: 'Program.cs', langVersion: '12.0' }, sourceRoot), toolchain, { signal });
  const compilation = await compiled;
  if (!compilation.assembly) throw new Error(`Native metadata reader did not compile: ${JSON.stringify(compilation.result)}`);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-inventory-'));
  try {
    const assembly = path.join(directory, 'Oracle.dll');
    await writeFile(assembly, compilation.assembly);
    await writeFile(path.join(directory, 'Oracle.runtimeconfig.json'), JSON.stringify({ runtimeOptions: { tfm: pin.targetFramework, rollForward: 'Disable', framework: { name: 'Microsoft.NETCore.App', version: pin.runtime } } }));
    const outputs = [];
    for (let run = 0; run < 2; run++) {
      const file = path.join(directory, `metadata-${run}.json`);
      const result = await runProcess(toolchain.dotnet, [assembly, mode, file, ...inputs], { cwd: directory, signal, timeoutMs: 120000 });
      if (result.exitCode !== 0 || result.signal) throw new Error(`Native ${mode} reference extraction failed: ${result.stdout}${result.stderr}`);
      outputs.push(await readJSON(file));
    }
    assertDeterministic(outputs[0], outputs[1], `${mode} native reference metadata`);
    return { ...outputs[0], extractor: { sourceSHA256: sha256(await readFile(path.join(sourceRoot, 'Program.cs'))), assemblySHA256: compilation.result.assemblySHA256, sdk: pin.sdk, runtime: pin.runtime } };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function bclMetadata(options = {}) {
  const toolchain = options.toolchain ?? await resolveToolchain();
  return extractNative('metadata', toolchain.references, { ...options, toolchain });
}

export async function winuiMetadata(options = {}) {
  const packageRoot = process.env.NUGET_PACKAGES || path.join(os.homedir(), '.nuget/packages');
  const lock = await readJSON(path.join(root, 'tests/conformance/oracle/WinUI/packages.lock.json'));
  const framework = Object.values(lock.dependencies).find(value => value['Microsoft.WindowsAppSDK.WinUI']);
  const version = framework['Microsoft.WindowsAppSDK.WinUI'].resolved;
  const metadata = path.join(packageRoot, 'microsoft.windowsappsdk.winui', version, 'metadata');
  const files = (await readdir(metadata)).filter(name => name.endsWith('.winmd')).sort().map(name => path.join(metadata, name));
  if (!files.length) throw new Error('Pinned Windows App SDK package has no WinMD inputs; restore oracle/WinUI in locked mode first');
  return { ...await extractNative('metadata', files, options), windowsAppSDK: pin.windowsAppSDK, winuiPackage: version };
}

export async function diagnosticMetadata(options = {}) {
  const toolchain = options.toolchain ?? await resolveToolchain();
  return extractNative('diagnostics', [path.join(path.dirname(toolchain.csc), 'Microsoft.CodeAnalysis.CSharp.dll')], { ...options, toolchain });
}
