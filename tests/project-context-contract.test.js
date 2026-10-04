import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTargetFramework, compareFrameworkVersions, isTargetFrameworkCompatible, nearestTargetFramework, targetFrameworkDefines,
  projectContextId, ProjectContextSelection, findProjectContext, resolveProjectReferenceContext,
  PORTABLE_RUNTIME_GRAPH, PORTABLE_RUNTIME_GRAPH_SOURCE, readRuntimeGraph, runtimeFallbacks, resolveRuntimeIdentifiers,
} from '@sharpforge/project-system';

const context = (framework, extra = {}) => {
  const value = {project: 'Library.csproj', path: 'Library.csproj', configuration: 'Debug', platform: 'AnyCPU',
    targetFramework: framework, runtimeIdentifier: '', diagnostics: [], ...extra};
  return {...value, id: projectContextId(value)};
};

test('framework compatibility preserves platform restrictions and prefers the nearest supported family', () => {
  assert.equal(parseTargetFramework('net472').version, '4.7.2');
  assert.equal(parseTargetFramework('net10.0-windows10.0.19041.0').platformVersion, '10.0.19041.0');
  assert.equal(compareFrameworkVersions('4.8', '4.8.0.0'), 0);
  assert(isTargetFrameworkCompatible('net10.0', 'netstandard2.1'));
  assert(!isTargetFrameworkCompatible('net48', 'netstandard2.1'));
  assert(!isTargetFrameworkCompatible('net8.0', 'net8.0-windows'));
  assert.equal(nearestTargetFramework('net8.0', ['netstandard2.1', 'net6.0', 'net9.0']), 'net6.0');
  assert.equal(nearestTargetFramework('net8.0-windows10.0.19041.0', ['net7.0-windows7.0', 'net8.0']), 'net8.0');
  for (const framework of ['', 'custom', 'net8.0-windows-?', 'net8.0-windows1..0']) {
    assert.equal(parseTargetFramework(framework).supported, false);
    assert.equal(nearestTargetFramework('net8.0', [framework]), null);
  }
  assert(targetFrameworkDefines('net10.0-windows').includes('NET8_0_OR_GREATER'));
  assert(targetFrameworkDefines('net10.0-windows').includes('WINDOWS'));
  assert.throws(() => targetFrameworkDefines('net1000000.0'), /limit/);
});

test('context replacement removes stale IDs and diagnostics while preserving another project selection', () => {
  const selection = new ProjectContextSelection();
  const eight = context('net8.0');
  const ten = context('net10.0', {diagnostics: [{code: 'OLD'}]});
  const other = context('net8.0', {project: 'Other.csproj', path: 'Other.csproj'});
  selection.update([eight, ten, other]);
  assert.equal(selection.select('Library.csproj', {targetFramework: 'NET10.0'}), ten);
  assert.equal(findProjectContext([eight, ten], ten.id), ten);
  const replacement = context('net10.0', {configuration: 'Release'});
  selection.update([replacement]);
  assert.equal(selection.get('Library.csproj'), replacement);
  assert.equal(selection.get('Other.csproj'), other);
  assert.deepEqual(selection.diagnostics(), []);
  assert.throws(() => selection.select('Library.csproj', ten.id), {code: 'SFP1903'});
  selection.clear();
  assert.equal(selection.get('Library.csproj'), null);
});

test('project references select compatible framework/runtime records and honor explicit assignments', () => {
  const eight = context('net8.0');
  const ten = context('net10.0');
  const native = context('net10.0', {runtimeIdentifier: 'win-x64'});
  const dependency = {path: 'Library.csproj', contexts: [eight, ten, native]};
  assert.equal(resolveProjectReferenceContext(context('net10.0', {runtimeIdentifier: 'win-x64'}), dependency), native);
  assert.equal(resolveProjectReferenceContext(context('net9.0'), dependency), eight);
  assert.equal(resolveProjectReferenceContext(context('net10.0'), dependency,
    {metadata: {AdditionalProperties: 'Configuration=Debug;TargetFramework=net8.0'}}), eight);
  assert.throws(() => resolveProjectReferenceContext(context('net6.0'), dependency), {code: 'SFP1904'});
  assert.throws(() => resolveProjectReferenceContext(context('net10.0'), dependency,
    {metadata: {TargetFramework: 'net7.0'}}), {code: 'SFP1904'});
});

test('RID expansion retains pinned graph identity, breadth-first order and selected-property semantics', () => {
  assert.equal(Object.keys(PORTABLE_RUNTIME_GRAPH).length, 85);
  assert.match(PORTABLE_RUNTIME_GRAPH_SOURCE.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(runtimeFallbacks('linux-x64').runtimes, ['linux-x64', 'linux', 'unix-x64', 'unix', 'any', 'base']);
  assert.throws(() => PORTABLE_RUNTIME_GRAPH['linux-x64'].push('extra'), TypeError);
  const result = resolveRuntimeIdentifiers({runtimeidentifier: 'win-x64', RUNTIMEIDENTIFIERS: 'linux-x64;win-x64;unknown'});
  assert.deepEqual(result.runtimeIdentifiers, ['win-x64', 'linux-x64', 'unknown']);
  assert.equal(result.runtimeIdentifier, 'win-x64');
  assert.equal(result.diagnostics[0].code, 'NETSDK1083');
  assert.equal(resolveRuntimeIdentifiers({RuntimeIdentifiers: 'linux-x64'}).runtimeIdentifier, '');
});

test('runtime graph snapshots reject malformed, cyclic and oversized declarations', () => {
  const input = {runtimes: {custom: {'#import': ['leaf']}, leaf: {}}};
  const graph = readRuntimeGraph(input);
  input.runtimes.custom['#import'].push('mutated');
  assert.deepEqual(runtimeFallbacks('custom', graph).runtimes, ['custom', 'leaf']);
  for (const value of ['{', {}, {runtimes: []}, {runtimes: {rid: null}}, {runtimes: {rid: {'#import': [1]}}}]) {
    assert.throws(() => readRuntimeGraph(value), {code: 'SFP1910'});
  }
  assert.throws(() => runtimeFallbacks('a', {a: ['b'], b: ['a']}), {code: 'SFP1910'});
  assert.throws(() => readRuntimeGraph(' '.repeat(4194305)), {code: 'SFP1910'});
  assert.throws(() => resolveRuntimeIdentifiers({RuntimeIdentifiers: Array(257).fill('linux-x64').join(';')}), {code: 'SFP1910'});
});
