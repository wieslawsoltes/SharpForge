import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { locateReferencePack } from '@sharpforge/compiler/node';

// `compile --format dotnet` (apps/cli/assembly.js): the CLI writes a real .NET assembly through `compileToAssembly`
// and a runtime configuration. Reference for the output: the fixtures of
// packages/compiler/test/cil-emission/reference-fixtures, whose `.out` files are what the Roslyn build prints on
// .NET 10 (verify-dotnet.mjs --references, SDK 10.0.201, reference pack 10.0.5). Compiling needs the reference pack
// of an installed .NET SDK and running needs the `dotnet` host; each test says so when it is skipped.

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'apps', 'cli', 'main.js');
const fixtures = join(here, '..', 'packages', 'compiler', 'test', 'cil-emission', 'reference-fixtures');
const RUN_TIMEOUT_MS = 60_000;

const pack = locateReferencePack();
const needsPack = pack ? false : 'no .NET reference pack is installed (the .NET SDK, or DOTNET_ROOT)';

/** The `dotnet` host that can run an assembly, or null. */
function findDotnet() {
  const local = join(homedir(), '.dotnet', process.platform === 'win32' ? 'dotnet.exe' : 'dotnet'),
    candidates = [process.env.DOTNET, existsSync(local) ? local : null, 'dotnet'].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--list-runtimes'], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS });
    if (probe.status === 0 && /Microsoft\.NETCore\.App /.test(probe.stdout)) return candidate;
  }
  return null;
}
const dotnet = pack ? findDotnet() : null;
const normalize = text => text.replace(/\r\n/g, '\n');
const runCli = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS });

async function withScratch(run) {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-dotnet-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

for (const name of ['linq', 'anonymous-types']) {
  test(`CLI --format dotnet: ${name}.cs becomes an assembly that prints the pinned Roslyn output on .NET`, { skip: needsPack }, async t => {
    await withScratch(async directory => {
      const output = join(directory, 'app.dll'),
        compiled = runCli(['compile', join(fixtures, name + '.cs'), '--format', 'dotnet', '-o', output]);
      assert.equal(compiled.status, 0, compiled.stderr);
      assert.match(compiled.stdout, /bytes \.NET assembly \(reference pack \d+\.\d+/);
      const bytes = await readFile(output);
      assert.equal(bytes.subarray(0, 2).toString('latin1'), 'MZ');
      const config = JSON.parse(await readFile(join(directory, 'app.runtimeconfig.json'), 'utf8'));
      assert.equal(config.runtimeOptions.framework.name, 'Microsoft.NETCore.App');
      assert.equal(config.runtimeOptions.tfm, pack.targetFramework);
      if (!dotnet) return t.diagnostic('not run: no dotnet host with Microsoft.NETCore.App was found');
      const ran = spawnSync(dotnet, [output], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS });
      assert.equal(ran.status, 0, ran.stderr);
      assert.equal(normalize(ran.stdout), normalize(await readFile(join(fixtures, name + '.out'), 'utf8')));
      return undefined;
    });
  });
}

test('CLI --format dotnet: a project compiles through the same input path; a library gets no runtime configuration', { skip: needsPack }, async t => {
  await withScratch(async directory => {
    const project = (outputType, extra = '') => `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>${outputType}</OutputType><TargetFramework>net10.0</TargetFramework>${extra}</PropertyGroup>
</Project>
`;
    await mkdir(join(directory, 'App'));
    await mkdir(join(directory, 'Library'));
    await writeFile(join(directory, 'App', 'App.csproj'), project('Exe'));
    await writeFile(join(directory, 'App', 'Program.cs'), 'using System.Linq;\nSystem.Console.WriteLine(Texts.Join(new[] { 3, 1, 2 }.OrderBy(n => n)));\n');
    await writeFile(
      join(directory, 'App', 'Texts.cs'),
      'using System.Collections.Generic;\nstatic class Texts { public static string Join(IEnumerable<int> items) => string.Join("-", items); }\n',
    );
    const output = join(directory, 'App.dll'),
      compiled = runCli(['compile', join(directory, 'App', 'App.csproj'), '--format', 'dotnet', '-o', output]);
    assert.equal(compiled.status, 0, compiled.stderr);
    assert.ok(existsSync(join(directory, 'App.runtimeconfig.json')));
    // A solution names the project to build with --project, as for the other formats.
    await writeFile(join(directory, 'Workspace.slnx'), '<Solution>\n  <Project Path="App/App.csproj" />\n</Solution>\n');
    const fromSolution = join(directory, 'FromSolution.dll'),
      solution = runCli(['compile', join(directory, 'Workspace.slnx'), '--project', 'App/App.csproj', '--format', 'dotnet', '-o', fromSolution]);
    assert.equal(solution.status, 0, solution.stderr);
    assert.deepEqual(await readFile(fromSolution), await readFile(output), 'the same program from the solution');
    await writeFile(join(directory, 'Library', 'Library.csproj'), project('Library'));
    await writeFile(join(directory, 'Library', 'Math.cs'), 'public static class Math2 { public static int Twice(int value) => value * 2; }\n');
    const library = join(directory, 'Library.dll'),
      built = runCli(['compile', join(directory, 'Library', 'Library.csproj'), '--format', 'dotnet', '-o', library]);
    assert.equal(built.status, 0, built.stderr);
    assert.ok(existsSync(library) && !existsSync(join(directory, 'Library.runtimeconfig.json')));
    if (!dotnet) return t.diagnostic('not run: no dotnet host with Microsoft.NETCore.App was found');
    const ran = spawnSync(dotnet, [output], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS });
    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(normalize(ran.stdout), '1-2-3\n');
    return undefined;
  });
});

test('CLI --format dotnet: --reference (repeatable) and --reference-pack choose the references', { skip: needsPack }, async () => {
  await withScratch(async directory => {
    const source = join(directory, 'Program.cs'),
      output = join(directory, 'app.dll'),
      reference = name => ['--reference', join(pack.directory, name + '.dll')];
    await writeFile(source, 'System.Console.WriteLine(new System.Text.StringBuilder("a").Append(1).ToString());\n');
    const explicit = runCli(['compile', source, '--format', 'dotnet', '-o', output, ...reference('System.Runtime'), ...reference('System.Console')]);
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.match(explicit.stdout, /\(2 references\)/);
    const fromDirectory = runCli(['compile', source, '--format', 'dotnet', '-o', output, '--reference-pack', pack.directory]);
    assert.equal(fromDirectory.status, 0, fromDirectory.stderr);
    // Without the assembly that declares Console the program does not bind.
    const missing = runCli(['compile', source, '--format', 'dotnet', '-o', join(directory, 'none.dll'), ...reference('System.Runtime')]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /error CS\d{4}/);
    assert.ok(!existsSync(join(directory, 'none.dll')));
  });
});

test('CLI --format dotnet: diagnostics are printed as the CLI prints them and nothing is written', { skip: needsPack }, async () => {
  await withScratch(async directory => {
    const source = join(directory, 'Bad.cs'),
      output = join(directory, 'bad.dll');
    await writeFile(source, 'class P { static void Main() { int x = "s"; } }\n');
    const compiled = runCli(['compile', source, '--format', 'dotnet', '-o', output]);
    assert.equal(compiled.status, 1);
    assert.match(normalize(compiled.stderr), /Bad\.cs\(1,40\): error CS0029: /);
    assert.ok(!existsSync(output) && !existsSync(join(directory, 'bad.runtimeconfig.json')));
  });
});

test('CLI --format dotnet: misuse fails with a message', async () => {
  await withScratch(async directory => {
    const source = join(directory, 'Program.cs');
    await writeFile(source, 'System.Console.WriteLine(1);\n');
    const asRun = runCli(['run', source, '--format', 'dotnet']);
    assert.equal(asRun.status, 1);
    assert.match(asRun.stderr, /--format dotnet is for compile/);
    const withoutFormat = runCli(['compile', source, '--reference', 'x.dll', '-o', join(directory, 'a.dll')]);
    assert.equal(withoutFormat.status, 1);
    assert.match(withoutFormat.stderr, /need --format dotnet/);
    const noPack = runCli(['compile', source, '--format', 'dotnet', '-o', join(directory, 'a.dll'), '--reference-pack', join(directory, 'missing')]);
    assert.equal(noPack.status, 1);
    assert.match(noPack.stderr, /Reference pack directory not found/);
    const noReference = runCli(['compile', source, '--format', 'dotnet', '-o', join(directory, 'a.dll'), '--reference', join(directory, 'missing.dll')]);
    assert.equal(noReference.status, 1);
    assert.match(noReference.stderr, /Reference not found/);
  });
});

test('CLI help names the .NET assembly output and its options', () => {
  const help = runCli(['help']);
  assert.equal(help.status, 0);
  for (const text of ['--format dotnet', '--reference PATH', '--reference-pack DIR', 'compile Program.cs -o app.dll']) {
    assert.ok(help.stdout.includes(text), text);
  }
});
