import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { LanguageService } from '@sharpforge/language';
import { Workspace } from '@sharpforge/workspace';
import { compile } from '@sharpforge/compiler';
import { NativeMetadataReferenceService } from '../packages/msbuild/src/native-metadata.js';
import { startMSBuildHost } from '../packages/msbuild/src/server.js';
import { MSBuildClient } from '../packages/msbuild/src/client.js';
import { projectContextCompilationInput } from '../packages/msbuild/src/project-context.js';

test('native metadata reads require an authorized context reference and enforce file/count/total budgets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sf-metadata-budget-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = await readFile(new URL('fixtures/metadata/VersionedLib.1.0.0.0.dll', import.meta.url));
  await writeFile(join(root, 'Library.dll'), bytes);
  await writeFile(join(root, 'Malformed.dll'), 'invalid');
  let authorized = 0;
  const context = { id: 'context', project: 'App.csproj', references: [{ path: 'Library.dll' }, { path: 'Malformed.dll' }] };
  const designTime = { async context(request) {
    assert.equal(request.trusted, true);
    return { context };
  }, engine: { workspace: { root }, async authorize() { authorized++; } } };
  const service = new NativeMetadataReferenceService(designTime);
  const request = { trusted: true, references: ['Library.dll'] };
  const result = await service.read(request);
  assert.equal(result.contextId, 'context');
  assert.deepEqual(Buffer.from(result.references[0].base64, 'base64'), bytes);
  assert.equal(result.references[0].sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(authorized, 1);
  await assert.rejects(service.read({ ...request, references: [join(root, 'Library.dll')] }), { code: 'SFMSB_METADATA_REFERENCE' });
  await assert.rejects(service.read({ ...request, references: ['Malformed.dll'] }), { code: 'SFMSB_METADATA_INVALID' });
  await assert.rejects(new NativeMetadataReferenceService(designTime, { maxFileBytes: 1 }).read(request), { code: 'SFMSB_METADATA_LIMIT' });
  await assert.rejects(new NativeMetadataReferenceService(designTime, { maxTotalBytes: 1 }).read(request), { code: 'SFMSB_METADATA_LIMIT' });
  await assert.rejects(new NativeMetadataReferenceService(designTime, { maxReferences: 1 }).read({ ...request, references: ['Library.dll', 'Malformed.dll'] }),
    /count/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(service.read(request, { signal: controller.signal }), { name: 'AbortError' });
});

test('actual native contexts deliver SDK metadata over authenticated HTTP for LINQ completion and semantic binding', {
  skip: process.env.SHARPFORGE_DOTNET ? false : 'Set SHARPFORGE_DOTNET for the native metadata/IDE qualification', timeout: 90000
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'sf-metadata-ide-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sdk = process.env.SHARPFORGE_NATIVE_SDK ?? '10.0.201';
  const framework = 'net' + sdk.split('.')[0] + '.0';
  await mkdir(join(root, 'App'));
  await writeFile(join(root, 'global.json'), JSON.stringify({ sdk: { version: sdk, rollForward: 'disable' } }));
  await writeFile(join(root, 'NuGet.Config'), '<configuration><packageSources><clear/></packageSources></configuration>');
  await writeFile(join(root, 'App/App.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
    + `<TargetFramework>${framework}</TargetFramework><OutputType>Exe</OutputType>`
    + '<ImplicitUsings>enable</ImplicitUsings>'
    + '<GenerateAssemblyInfo>false</GenerateAssemblyInfo><GenerateTargetFrameworkAttribute>false</GenerateTargetFrameworkAttribute>'
    + '</PropertyGroup></Project>');
  const source = 'class P { public static int Main() { return Enumerable.Count(Enumerable.Range(0, 3)); } }';
  await writeFile(join(root, 'App/Program.cs'), source);
  const host = await startMSBuildHost({ root, port: 0, executable: process.env.SHARPFORGE_DOTNET, trusted: true });
  t.after(() => host.close());
  const client = new MSBuildClient({ token: host.token, fetch: (path, options) => fetch(new URL(path, host.origin), options) });
  const request = { project: 'App/App.csproj', framework, configuration: 'Debug', trusted: true };
  const build = await host.engine.wait((await host.engine.start({ ...request, action: 'build', restore: true })).id);
  assert.equal(build.status, 'succeeded', build.error);
  await assert.rejects(client.projectMetadata({ ...request, trusted: false }), /trust/i);
  const { context } = await client.projectContext(request);
  const metadata = await client.projectMetadata(request);
  assert.equal(metadata.contextId, context.id);
  assert(metadata.references.some(reference => basename(reference.path) === 'System.Linq.dll'));
  assert(metadata.references.length > 10);
  await assert.rejects(client.projectMetadata({ ...request, references: ['/outside/not-a-context-reference.dll'] }),
    { code: 'SFMSB_METADATA_REFERENCE', status: 403 });
  const records = new Map();
  for (const file of context.sources) records.set(file.path, await client.read(file.path));
  const input = projectContextCompilationInput(context, records);
  assert(input.files.some(file => file.generated && /global using (?:global::)?System\.Linq;/.test(file.text)));
  const options = { ...input.options, name: 'App', references: metadata.references.map(reference => ({
    bytes: new Uint8Array(Buffer.from(reference.base64, 'base64')), display: reference.display, aliases: reference.aliases
  })) };
  const workspace = new Workspace({ compilationOptions: options });
  for (const file of input.files) workspace.update(file.uri, file.text, file.version);
  const language = new LanguageService(workspace);
  const coldStarted = performance.now();
  const errors = language.diagnostics('App/Program.cs').filter(diagnostic => diagnostic.severity === 'error');
  const coldMetadataMs = performance.now() - coldStarted;
  assert.deepEqual(errors, []);
  const offset = source.indexOf('Range') + 1;
  assert.match(language.hover('App/Program.cs', offset).contents, /Enumerable\.Range/);
  assert.equal(language.definition('App/Program.cs', offset), null);
  const model = language.metadata.current();
  assert.equal(model.resolveType('App/Program.cs', 'System.Linq.Enumerable').assembly, 'System.Linq');
  workspace.update('App/Program.cs', 'class P { void M() { Enumerable. } }');
  const position = workspace.documents.get('App/Program.cs').source.text.indexOf('Enumerable.') + 'Enumerable.'.length;
  const completions = language.completions('App/Program.cs', position);
  for (const name of ['Range', 'Repeat', 'Select', 'Where']) assert(completions.some(item => item.label === name), name);
  assert.equal(language.metadata.current(), model);
  const samples = [];
  for (let index = 0; index < 25; index++) {
    const started = performance.now();
    language.completions('App/Program.cs', position);
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  t.diagnostic(JSON.stringify({ sdk, node: process.version, backend: 'SDK metadata with compiler semantic model',
    referenceCount: metadata.references.length, referenceBytes: metadata.totalBytes, coldMetadataMs,
    warmCompletionMedianMs: samples[12], warmCompletionP95Ms: samples[23], reusedModel: true }));
  const executable = compile(input.files, options);
  assert.equal(executable.success, false);
  assert(executable.diagnostics.some(diagnostic => diagnostic.code === 'SF2200'), JSON.stringify(executable.diagnostics));
  workspace.dispose();
});
