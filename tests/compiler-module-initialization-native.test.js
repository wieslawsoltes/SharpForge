import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileToAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { dotnetHost, sdkVersion } from '../packages/compiler/test/differential/tools/dotnet-axis.mjs';

const directory = fileURLToPath(new URL('./fixtures/module-initialization/', import.meta.url));
const librarySource = readFileSync(join(directory, 'Library.cs'), 'utf8');
const hostSource = readFileSync(join(directory, 'LibraryHost.cs'), 'utf8');
const pack = loadReferencePack();
const dotnet = dotnetHost();
const sdk = pack ? sdkVersion(dotnet) : null;
const nativeOptions = { skip: pack && sdk ? false : 'no .NET SDK and reference pack are installed' };
const processOptions = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const expectedLibraryOutput = 'first\nsecond\nread\n2\nread\n2\n';

function compilerPath() {
  const sdks = execFileSync(dotnet, ['--list-sdks'], processOptions).trim().split(/\r?\n/);
  const selected = sdks.map(line => /^(\S+)\s+\[(.+)\]$/.exec(line)).find(match => match?.[1] === sdk);
  assert.ok(selected, `SDK ${sdk} has a compiler directory`);
  return join(selected[2], sdk, 'Roslyn', 'bincore', 'csc.dll');
}

function runtimeConfig(path, name) {
  const version = sdk.split('.').slice(0, 2).join('.');
  writeFileSync(join(path, `${name}.runtimeconfig.json`), JSON.stringify({ runtimeOptions: {
    tfm: `net${version}`,
    framework: { name: 'Microsoft.NETCore.App', version: `${version}.0` },
    configProperties: { 'System.Globalization.Invariant': true },
  } }));
}

function emit(source, options) {
  const result = compileToAssembly(source, options);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.ok(result.assembly);
  return result.assembly;
}

test('module initialization native: a real Roslyn host observes library startup once', nativeOptions, context => {
  const scratch = mkdtempSync(join(tmpdir(), 'sharpforge-module-library-'));
  const compiler = compilerPath();
  const common = ['-nologo', '-langversion:14', '-deterministic+', '-nostdlib+', ...pack.pack.files.map(file => `-r:${file}`)];
  const version = execFileSync(dotnet, [compiler, '-version'], processOptions).trim();
  try {
    let oracleOutput;
    for (const backend of ['roslyn', 'registry', 'references']) {
      const path = join(scratch, backend);
      mkdirSync(path);
      const library = join(path, 'ModuleLibrary.dll');
      const host = join(path, 'LibraryHost.dll');
      writeFileSync(join(path, 'Library.cs'), librarySource);
      writeFileSync(join(path, 'LibraryHost.cs'), hostSource);
      if (backend === 'roslyn') {
        execFileSync(dotnet, [compiler, ...common, '-target:library', `-out:${library}`, join(path, 'Library.cs')], processOptions);
      } else {
        writeFileSync(library, emit(librarySource, { name: 'ModuleLibrary', outputKind: 'library',
          ...(backend === 'references' ? { references: pack.references } : {}),
        }));
      }
      execFileSync(dotnet, [compiler, ...common, '-target:exe', `-r:${library}`, `-out:${host}`,
        join(path, 'LibraryHost.cs')], processOptions);
      runtimeConfig(path, 'LibraryHost');
      const output = execFileSync(dotnet, [host], processOptions).replace(/\r\n/g, '\n');
      if (backend === 'roslyn') oracleOutput = output;
      assert.equal(output, expectedLibraryOutput, backend);
      assert.equal(output, oracleOutput, `${backend} agrees with the independently compiled Roslyn library`);
      const bytes = readFileSync(library);
      context.diagnostic(JSON.stringify({ backend, output, libraryBytes: bytes.length, librarySha256: sha256(bytes) }));
    }
    context.diagnostic(`Roslyn ${version}; .NET SDK ${sdk}; reference pack ${pack.pack.version}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

const synthesizedEntries = [
  { name: 'TopLevel', expected: 'module\nmain\n', source: `using System;
Console.WriteLine("main");
static class Startup {
  [System.Runtime.CompilerServices.ModuleInitializer] internal static void Initialize() { Console.WriteLine("module"); }
}` },
  { name: 'AsyncMain', expected: 'module\nbefore\n42\nafter\n', source: `using System;
using System.Threading.Tasks;
static class Startup {
  [System.Runtime.CompilerServices.ModuleInitializer] internal static void Initialize() { Console.WriteLine("module"); }
}
class Program {
  static async Task Main() {
    Console.WriteLine("before"); Console.WriteLine(await Task.FromResult(42)); Console.WriteLine("after");
  }
}` },
];

for (const fixture of synthesizedEntries) {
  const vmScope = fixture.name === 'AsyncMain' ? 'explicit VM admission boundary' : 'native CLR and CIL VM';
  test(`module initialization native: ${fixture.name} kickoff runs once (${vmScope})`, nativeOptions, context => {
    const scratch = mkdtempSync(join(tmpdir(), 'sharpforge-module-entry-'));
    try {
      const bytes = emit(fixture.source, { name: fixture.name, references: pack.references });
      writeFileSync(join(scratch, `${fixture.name}.dll`), bytes);
      runtimeConfig(scratch, fixture.name);
      const output = execFileSync(dotnet, [join(scratch, `${fixture.name}.dll`)], processOptions).replace(/\r\n/g, '\n');
      assert.equal(output, fixture.expected);
      context.diagnostic(JSON.stringify({ entry: fixture.name, output, assemblyBytes: bytes.length,
        assemblySha256: sha256(bytes), vmScope }));
      if (fixture.name === 'AsyncMain') {
        // Native async startup is qualified above. The VM currently refuses these framework members before execution;
        // retain that observable boundary instead of treating native execution as a VM pass or bypassing verification.
        const unavailable = ['Task::GetAwaiter', 'TaskAwaiter::GetResult', 'AsyncTaskMethodBuilder::Create',
          'AsyncTaskMethodBuilder::Start', 'AsyncTaskMethodBuilder::get_Task'];
        assert.throws(() => new CilVirtualMachine(bytes), error => error.issues?.length === unavailable.length &&
          unavailable.every(member => error.issues.some(issue => issue.code === 'IL_REFERENCE' && issue.message.includes(member))));
      } else {
        const vm = new CilVirtualMachine(bytes);
        try {
          const result = vm.run();
          assert.equal(result.state, 'terminated', result.fault?.stack);
          assert.equal(result.output, output);
        } finally { vm.stop(); }
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
}
