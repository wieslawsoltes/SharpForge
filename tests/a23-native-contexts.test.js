import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCscArguments, expandCscResponseFiles } from '../packages/msbuild/src/csc-args.js';
import { contextFromEvaluation, projectContextId, ProjectContextSelection } from '../packages/msbuild/src/project-context.js';
import { createDesignTimeRequest } from '../packages/msbuild/src/design-time.js';
import { DesignTimeCache } from '../packages/msbuild/src/design-time-cache.js';
import { BuildScheduler } from '../packages/msbuild/src/scheduler.js';
import { runtimeFallbacks, readRuntimeGraph } from '../packages/msbuild/src/rid.js';

const commandLines = [
  ['/define:A;B /langversion:preview', value => assert.deepEqual(value.defines, ['A', 'B'])],
  ['/nullable:enable /unsafe+ /checked+', value => assert(value.unsafe && value.checked && value.nullable === 'enable')],
  ['/reference:alias1,alias2="a b.dll"', value => assert.deepEqual(value.references[0], { path: 'a b.dll', aliases: ['alias1', 'alias2'] })],
  ['/analyzer:a.dll /additionalfile:data.json', value => assert.deepEqual(value.additionalFiles, ['data.json'])],
  ['/analyzerconfig:rules.editorconfig', value => assert.deepEqual(value.analyzerConfigFiles, ['rules.editorconfig'])],
  ['/nowarn:CS1000,CS1001 /warnaserror:CS1002', value => assert.deepEqual(value.warningsAsErrors, ['CS1002'])],
  ['/warnaserror+ /warnaserror-:CS2000', value => assert(value.allWarningsAsErrors && value.warningsNotAsErrors[0] === 'CS2000')],
  ['/out:App.dll /target:exe', value => assert(value.target === 'exe' && value.output === 'App.dll')],
  ['/unknown:kept Program.cs', value => assert.deepEqual(value.unknown, ['/unknown:kept'])],
  ['/unsafe- /checked- /d:ONE,ONE', value => assert(!value.unsafe && !value.checked && value.defines.length === 1)]
];
for (const [line, verify] of commandLines) test('compiler option preservation: ' + line, () => verify(parseCscArguments(line)));
test('compiler response expansion rejects cycles and preserves unknown arguments', async () => {
  const files = { 'a.rsp': '/define:ONE @b.rsp', 'b.rsp': '/future:flag Program.cs' };
  const argumentsList = await expandCscResponseFiles(['@a.rsp'], path => files[path]);
  assert.deepEqual(parseCscArguments(argumentsList).unknown, ['/future:flag']);
  files['b.rsp'] = '@a.rsp';
  await assert.rejects(() => expandCscResponseFiles(['@a.rsp'], path => files[path]), /cycle/);
});
test('compiler inputs preserve absolute source paths and bound aggregate argument/response text', async () => {
  assert.deepEqual(parseCscArguments(['/tmp/Program.cs', '/Program.cs', '/future:Program.cs']).sources, ['/tmp/Program.cs', '/Program.cs']);
  assert.throws(() => parseCscArguments(['abcd', 'efgh'], { maxCharacters: 7 }), /character limit/);
  await assert.rejects(expandCscResponseFiles(['@a.rsp', '@b.rsp'], () => 'Program.cs', { maxCharacters: 15 }), /text limit/);
});
test('design-time requests avoid assembly emission and request semantic compiler inputs', () => {
  const request = createDesignTimeRequest({ project: 'App.csproj', trusted: true });
  assert.equal(request.properties.SkipCompilerExecution, 'true');
  assert.equal(request.properties.ProvideCommandLineArgs, 'true');
  assert(request.itemNames.includes('CscCommandLineArgs'));
  assert.equal(request.designTime, true);
});
test('contexts retain independent TFM/RID identity and inactive diagnostic labels', () => {
  const evaluation = { Properties: { TargetFramework: 'net10.0', RuntimeIdentifier: 'linux-x64', DefineConstants: 'A;B', Nullable: 'enable' },
    Items: { Compile: [{ FullPath: '/workspace/Program.cs' }], ReferencePath: [{ FullPath: '/sdk/System.Runtime.dll' }] } };
  const context = contextFromEvaluation('App.csproj', evaluation, { diagnostics: [{ code: 'CS1000', message: 'failure' }] });
  const other = contextFromEvaluation('App.csproj', { ...evaluation, Properties: { ...evaluation.Properties, TargetFramework: 'net8.0' } });
  assert.notEqual(context.id, other.id);
  assert.deepEqual(context.defines, ['A', 'B']);
  assert.equal(context.diagnostics[0].targetFramework, 'net10.0');
  const selection = new ProjectContextSelection();
  selection.update([context, other]);
  selection.select('App.csproj', other.id);
  assert.equal(selection.get('App.csproj'), other);
  assert.equal(selection.diagnostics()[0].contextId, context.id);
});
test('shared import edits invalidate every cached project context', async () => {
  const fingerprints = new Map([['App.csproj', '1'], ['Lib.csproj', '1'], ['Directory.Build.props', '1']]);
  const cache = new DesignTimeCache({ fingerprint: async path => fingerprints.get(path) });
  await cache.set({ project: 'App.csproj' }, { sources: ['A.cs'] }, ['App.csproj', 'Directory.Build.props']);
  await cache.set({ project: 'Lib.csproj' }, { sources: ['B.cs'] }, ['Lib.csproj', 'Directory.Build.props']);
  assert.deepEqual(await cache.get({ project: 'App.csproj' }), { sources: ['A.cs'] });
  fingerprints.set('Directory.Build.props', '2');
  assert.equal(await cache.get({ project: 'App.csproj' }), null);
  assert.equal(await cache.get({ project: 'Lib.csproj' }), null);
});
test('queued user builds precede superseding design-time requests', async () => {
  const scheduler = new BuildScheduler(), order = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = scheduler.enqueue({ project: 'A' }, async () => { await gate; order.push('first'); return { status: 'succeeded' }; });
  await Promise.resolve();
  const old = scheduler.enqueue({ project: 'A' }, async () => { order.push('old'); }, { coalesceKey: 'A', priority: 0 });
  const latest = scheduler.enqueue({ project: 'A' }, async () => { order.push('latest'); return { status: 'succeeded' }; }, { coalesceKey: 'A', priority: 0 });
  const user = scheduler.enqueue({ project: 'B' }, async () => { order.push('user'); return { status: 'succeeded' }; }, { priority: 10 });
  release();
  await Promise.all([first, latest, user].map(id => scheduler.wait(id)));
  assert.deepEqual(order, ['first', 'user', 'latest']);
  assert.equal(scheduler.get(old).cancelReason, 'superseded');
  await scheduler.close();
});
test('runtime fallback graphs reject cycles and diagnose unknown RIDs', () => {
  assert.deepEqual(runtimeFallbacks('win-x64').runtimes, ['win-x64', 'win', 'any', 'base']);
  assert.equal(runtimeFallbacks('unregistered-rid').diagnostics[0].code, 'NETSDK1083');
  const graph = readRuntimeGraph({ runtimes: { a: { '#import': ['b'] }, b: { '#import': ['a'] } } });
  assert.throws(() => runtimeFallbacks('a', graph), /cycle/);
});
