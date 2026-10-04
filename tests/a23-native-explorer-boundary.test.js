import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssemblyInspector } from '@sharpforge/cil';
import { runNativeProcess } from '@sharpforge/msbuild/node';

test('native ExplorerWorkshop preserves its public assembly boundary and produces both answers', {
  skip: process.env.SHARPFORGE_DOTNET ? false : 'Set SHARPFORGE_DOTNET for the native example compiler oracle',
  timeout: 90000
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'sf-explorer-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(fileURLToPath(new URL('../examples/projects/ExplorerWorkshop/', import.meta.url)), root, { recursive: true });
  const sdk = process.env.SHARPFORGE_NATIVE_SDK ?? '10.0.201';
  await writeFile(join(root, 'global.json'), JSON.stringify({ sdk: { version: sdk, rollForward: 'disable' } }));
  await writeFile(join(root, 'NuGet.Config'), '<configuration><packageSources><clear/></packageSources></configuration>');
  const invoke = arguments_ => runNativeProcess({ executable: process.env.SHARPFORGE_DOTNET,
    arguments: arguments_, cwd: root, timeoutMs: 60000, maxOutputBytes: 2 * 1024 * 1024 });
  const buildArgs = ['build', 'App/App.csproj', '--disable-build-servers', '-nologo', '-m:1', '-p:NuGetAudit=false'];
  const build = await invoke(buildArgs);
  assert.equal(build.exitCode, 0, build.stdout + build.stderr);
  const library = new AssemblyInspector(new Uint8Array(await readFile(join(root, 'Library/bin/Debug/net10.0/Library.dll'))));
  const application = new AssemblyInspector(new Uint8Array(await readFile(join(root, 'App/bin/Debug/net10.0/App.dll'))));
  assert.equal(library.types.find(type => type.name === 'Counter')?.flags & 7, 1, 'Counter must be public in the Library assembly');
  assert.equal(application.types.some(type => type.name === 'Counter'), false, 'App must not redefine Library types');
  assert(application.summary({ includeMethods: false }).references.some(reference => reference.name === 'Library'));
  const executed = await invoke([join(root, 'App/bin/Debug/net10.0/App.dll')]);
  assert.equal(executed.exitCode, 0, executed.stderr);
  assert.equal(executed.stdout.replaceAll('\r\n', '\n'), '42\n42\n');
  for (const name of ['Counter.cs', 'Counter.Operations.cs']) {
    const path = join(root, 'Library/Models', name);
    const source = await readFile(path, 'utf8');
    assert.match(source, /public partial class Counter/);
    await writeFile(path, source.replace('public partial class Counter', 'partial class Counter'));
  }
  const invalid = await invoke([...buildArgs, '--no-restore', '-t:Rebuild']);
  assert.notEqual(invalid.exitCode, 0);
  assert.match(invalid.stdout + invalid.stderr, /CS0122/, 'The native compiler must reject a reverted internal Counter');
  t.diagnostic(JSON.stringify({ sdk, platform: process.platform, architecture: process.arch,
    distinctAssemblies: true, output: '42\n42\n', internalCounterDiagnostic: 'CS0122' }));
});
