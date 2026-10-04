import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  PORTABLE_RUNTIME_GRAPH, PORTABLE_RUNTIME_GRAPH_SOURCE, ProjectSystem,
  readRuntimeGraph, runtimeFallbacks, resolveRuntimeIdentifiers
} from '@sharpforge/project-system';
import { runtimeFallbacks as nativeFallbacks } from '../packages/msbuild/src/rid.js';
import { resolveNativeReference, compileNativeJsonProgram } from './helpers/project-native-reference.js';

test('both engines share the full immutable portable graph and NuGet breadth-first ordering', () => {
  assert.equal(Object.keys(PORTABLE_RUNTIME_GRAPH).length, 85);
  assert.equal(nativeFallbacks, runtimeFallbacks);
  assert.deepEqual(runtimeFallbacks('linux-x64').runtimes, ['linux-x64', 'linux', 'unix-x64', 'unix', 'any', 'base']);
  assert.deepEqual(runtimeFallbacks('win-x64').runtimes, ['win-x64', 'win', 'any', 'base']);
  assert.deepEqual(runtimeFallbacks('browser-wasm').runtimes, ['browser-wasm', 'browser', 'any', 'base']);
  assert.throws(() => PORTABLE_RUNTIME_GRAPH['win-x64'].push('incorrect'), TypeError);
  const unknown = runtimeFallbacks('unregistered-rid');
  assert.deepEqual(unknown.runtimes, []);
  assert.equal(unknown.diagnostics[0].code, 'NETSDK1083');
});

test('runtime graph input is copied and malformed, cyclic or oversized graphs fail explicitly', () => {
  const input = { runtimes: { custom: { '#import': ['leaf'] }, leaf: {} } };
  const graph = readRuntimeGraph(input);
  input.runtimes.custom['#import'].push('mutated');
  assert.deepEqual(runtimeFallbacks('custom', graph).runtimes, ['custom', 'leaf']);
  for (const value of ['{', {}, { runtimes: [] }, { runtimes: { rid: null } },
    { runtimes: { rid: { '#import': [1] } } }, { runtimes: { rid: { '#import': 'parent' } } }]) {
    assert.throws(() => readRuntimeGraph(value), { code: 'SFP1910' });
  }
  assert.throws(() => readRuntimeGraph(' '.repeat(4194305)), /source limit/);
  assert.throws(() => runtimeFallbacks('a', { a: ['b'], b: ['a'] }), /cycle/);
  assert.throws(() => runtimeFallbacks('a', { a: ['a'] }), /cycle/);
  assert.throws(() => runtimeFallbacks('a', { a: Array(100001).fill('b') }), { code: 'SFP1910' });
});

test('20,000-deep graphs resolve iteratively and the next node is rejected by the graph budget', () => {
  const runtimes = Object.create(null);
  for (let index = 0; index < 20000; index++) {
    runtimes['rid' + index] = { '#import': index === 19999 ? [] : ['rid' + (index + 1)] };
  }
  assert.equal(runtimeFallbacks('rid0', readRuntimeGraph({ runtimes })).runtimes.length, 20000);
  runtimes.extra = {};
  assert.throws(() => readRuntimeGraph({ runtimes }), /node limit/);
});

test('RuntimeIdentifier and RuntimeIdentifiers retain selection, unique fallback chains and context diagnostics', () => {
  const resolution = resolveRuntimeIdentifiers({ RuntimeIdentifier: 'win-x64', RuntimeIdentifiers: 'linux-x64;win-x64;unregistered-rid' });
  assert.deepEqual(resolution.runtimeIdentifiers, ['win-x64', 'linux-x64', 'unregistered-rid']);
  assert.equal(resolution.runtimeIdentifier, 'win-x64');
  assert.equal(resolution.diagnostics[0].code, 'NETSDK1083');
  assert.equal(resolveRuntimeIdentifiers({ RuntimeIdentifiers: 'linux-x64' }).runtimeIdentifier, '');
  const system = new ProjectSystem([{ path: 'App.csproj', text: '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
    + '<TargetFrameworks>net8.0;net10.0</TargetFrameworks><RuntimeIdentifier>win-x64</RuntimeIdentifier>'
    + '<RuntimeIdentifiers>linux-x64;unregistered-rid</RuntimeIdentifiers></PropertyGroup></Project>' }]);
  system.load('App.csproj');
  const project = system.projects.get('App.csproj');
  assert.equal(project.contexts.length, 2);
  for (const context of project.contexts) {
    assert.deepEqual(context.runtimeFallbackChains[0].runtimes, ['win-x64', 'win', 'any', 'base']);
    const diagnostic = context.diagnostics.find(value => value.code === 'NETSDK1083');
    assert.equal(diagnostic.contextId, context.id);
    assert.equal(diagnostic.targetFramework, context.targetFramework);
  }
  const custom = new ProjectSystem([{ path: 'App.csproj', text: '<Project><PropertyGroup>'
    + '<RuntimeIdentifier>custom</RuntimeIdentifier></PropertyGroup></Project>' }],
  { runtimeGraph: readRuntimeGraph({ runtimes: { custom: { '#import': ['any'] } } }) });
  custom.load('App.csproj');
  assert.deepEqual(custom.projects.get('App.csproj').runtimeFallbackChains[0].runtimes, ['custom', 'any']);
  assert(!custom.diagnostics.some(value => value.code === 'NETSDK1083'));
});

const source = `using System;
using System.Linq;
using System.Text.Json;
using NuGet.RuntimeModel;
class Program {
  static void Main(string[] args) {
    var graph = JsonRuntimeFormat.ReadRuntimeGraph(args[0]);
    var values = JsonSerializer.Deserialize<string[]>(args[1]);
    Console.WriteLine(JsonSerializer.Serialize(new {
      expansions = values.Select(rid => graph.ExpandRuntime(rid).ToArray()).ToArray(),
      nuget = typeof(RuntimeGraph).Assembly.GetName().Version.ToString()
    }));
  }
}`;

test('all 85 portable RID expansions match the installed NuGet.RuntimeModel implementation', {
  skip: process.env.SHARPFORGE_DOTNET ? false : 'Set SHARPFORGE_DOTNET for the offline NuGet RID oracle', timeout: 90000
}, t => {
  const toolchain = resolveNativeReference(process.env.SHARPFORGE_DOTNET, process.env.SHARPFORGE_NATIVE_SDK);
  const directory = mkdtempSync(join(tmpdir(), 'sf-rid-reference-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'runtime.json');
  writeFileSync(path, JSON.stringify({ runtimes: Object.fromEntries(Object.entries(PORTABLE_RUNTIME_GRAPH)
    .map(([rid, imports]) => [rid, { '#import': imports }])) }));
  if (toolchain.sdk === PORTABLE_RUNTIME_GRAPH_SOURCE.sdk) {
    const installed = readFileSync(join(toolchain.sdkDirectory, 'PortableRuntimeIdentifierGraph.json'));
    assert.equal(createHash('sha256').update(installed).digest('hex'), PORTABLE_RUNTIME_GRAPH_SOURCE.sha256);
    assert.deepEqual({ ...readRuntimeGraph(installed.toString('utf8')) }, PORTABLE_RUNTIME_GRAPH);
  }
  const references = ['NuGet.Packaging.dll', 'NuGet.Versioning.dll', 'NuGet.Common.dll',
    'NuGet.Frameworks.dll', 'Newtonsoft.Json.dll'].map(name => join(toolchain.sdkDirectory, name));
  const invoke = compileNativeJsonProgram(toolchain, directory, source, { references });
  const values = Object.keys(PORTABLE_RUNTIME_GRAPH);
  const native = invoke([path, JSON.stringify(values)]);
  assert.deepEqual(values.map(rid => runtimeFallbacks(rid).runtimes), native.expansions);
  t.diagnostic(JSON.stringify({ sdk: toolchain.sdk, runtime: toolchain.runtime, nuget: native.nuget,
    ridVectors: values.length, graphSource: PORTABLE_RUNTIME_GRAPH_SOURCE }));
});
