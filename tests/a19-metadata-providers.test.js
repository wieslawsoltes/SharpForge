import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectMetadata} from '../apps/studio/workbench/metadata/assembly-model.js';
import {MetadataCatalog} from '../apps/studio/workbench/metadata/catalog.js';
import {createStudioMetadataSources} from '../apps/studio/workbench/metadata/source-provider.js';
import {findMetadataDefinition, metadataDefinition} from '../apps/studio/workbench/metadata/definition.js';
import {metadataTree} from '../apps/studio/workbench/metadata/tree.js';
import {metadataLimits} from '../apps/studio/workbench/metadata/limits.js';
import {frameworkDefinition} from '../apps/studio/workbench/tools/code-definition.js';
import {metadataQuery, resolveCodeDefinition} from '../apps/studio/workbench/tools/code-definition-provider.js';

// Checked-in real C# compiler output, built with .NET SDK 10.0.201; no executable code is loaded by these providers.
const fixture = name => new Uint8Array(readFileSync(new URL('./fixtures/metadata/' + name, import.meta.url)));
const miniBytes = fixture('MiniStandard.dll');
const source = {id: 'p:MiniStandard.dll', path: 'lib/MiniStandard.dll', projectId: 'p', version: '4:1', workspaceEpoch: 4};
const inspect = (bytes, identity) => inspectMetadata(bytes, {source: identity});

test('PE metadata exposes actual generic List members, names, parameter signatures, properties and namespaces', async () => {
  const assembly = inspect(miniBytes, source);
  assert.equal(assembly.name, 'MiniStandard');
  assert.equal(assembly.version, '2.1.0.0');
  assert.match(assembly.identity, /^MiniStandard, Version=2\.1\.0\.0, Culture=neutral, PublicKey=[0-9a-f]+$/u);
  assert.match(assembly.mvid, /^[0-9a-f]{32}$/u);
  const list = assembly.types.find(type => type.name === 'System.Collections.Generic.List`1');
  assert.equal(list.namespace, 'System.Collections.Generic');
  assert.equal(list.displayName, 'System.Collections.Generic.List<T>');
  assert.match(list.members.find(member => member.name === 'Add').signature, /void Add\(T item\)/u);
  assert.match(list.members.find(member => member.kind === 'property' && member.name === 'Item').signature, /T Item\[int arg0\] \{ get; set; \}/u);
  assert(list.members.every(member => !Object.hasOwn(member, 'instructions')), 'Object Browser does not decode method bodies');
  const roots = await metadataTree([assembly]);
  const namespace = roots[0].children.find(node => node.label === 'System.Collections.Generic');
  assert(namespace.children.find(node => node.label === 'List<T>').children.some(node => node.label === 'Add' && /T item/u.test(node.detail)));
});

test('metadata source carries the exact PE identity, source version and matching overload selection', async () => {
  const assembly = inspect(miniBytes, source);
  const match = findMetadataDefinition([assembly], {owner: 'System.Console', name: 'WriteLine', argumentCount: 0});
  assert.equal(match.members.length, 1);
  const result = await metadataDefinition(match, {sourceVersion: 8, projectId: 'p'});
  assert.equal(result.readOnly, true);
  assert.equal(result.assemblyIdentity, assembly.identity);
  assert.equal(result.mvid, assembly.mvid);
  assert.equal(result.metadataSourceVersion, '4:1');
  assert.equal(result.sourceVersion, 8);
  assert.match(result.text.slice(result.selection.start, result.selection.end), /void WriteLine\(\);/u);
  assert(result.uri.includes(encodeURIComponent(assembly.identity)));
});

test('metadata versions never collapse same-name assemblies or infer an ambiguous owner', async () => {
  const first = inspect(fixture('VersionedLib.1.0.0.0.dll'), {...source, id: 'p:a', version: '1'});
  const second = inspect(fixture('VersionedLib.2.0.0.0.dll'), {...source, id: 'p:b', version: '2'});
  assert.notEqual(first.identity, second.identity);
  assert.notEqual(first.mvid, second.mvid);
  assert.throws(() => findMetadataDefinition([first, second], {expression: 'Lib.Widget'}), {code: 'METADATA_DEFINITION_AMBIGUOUS'});
  const one = await metadataDefinition(findMetadataDefinition([first, second], {expression: 'Lib.Widget', assemblyIdentity: first.identity}));
  const two = await metadataDefinition(findMetadataDefinition([first, second], {expression: 'Lib.Widget', assemblyIdentity: second.identity}));
  assert.notEqual(one.uri, two.uri);
});

test('framework member caret resolves Console.WriteLine rather than treating it as a type name', async () => {
  const result = await frameworkDefinition('Console.WriteLine');
  assert(result);
  assert.equal(result.readOnly, true);
  assert.match(result.assemblyIdentity, /SharpForge Framework ABI/u);
  assert.match(result.text.slice(result.selection.start, result.selection.end), /WriteLine\(/u);
  assert(result.overloadCount >= 1);
  assert.equal(await frameworkDefinition('Missing.Type.Method'), null);
});

test('core intrinsic metadata uses accepted arities, canonical owners, instance parameters and property shape', async () => {
  const metadata = new MetadataCatalog();
  const write = await metadata.definition({owner: 'System.Console', name: 'WriteLine', argumentCount: 0});
  assert.equal(write.overloadCount, 1);
  assert.match(write.text.slice(write.selection.start, write.selection.end), /void WriteLine\(\);/u);
  const substring = await metadata.definition({owner: 'System.String', name: 'Substring', argumentCount: 1});
  assert.equal(substring.overloadCount, 1, 'overlapping registered/core signatures are shown once');
  const signature = substring.text.slice(substring.selection.start, substring.selection.end);
  assert.match(signature, /^string Substring\(int arg0\);$/u);
  assert.doesNotMatch(signature, /static/u);
  const tick = await metadata.definition({owner: 'System.Environment', name: 'TickCount'});
  assert.match(tick.text.slice(tick.selection.start, tick.selection.end), /static int TickCount \{ get; \}/u);
  metadata.dispose();
});

test('bound assembly simple identity selects actual PE metadata and rejects multiple matching versions', async () => {
  const first = inspect(fixture('VersionedLib.1.0.0.0.dll'), {...source, id: 'p:a', version: '1'});
  const second = inspect(fixture('VersionedLib.2.0.0.0.dll'), {...source, id: 'p:b', version: '2'});
  assert.equal(findMetadataDefinition([first], {expression: 'Lib.Widget', assemblyIdentity: 'VersionedLib'}).assembly, first);
  assert.throws(() => findMetadataDefinition([first, second], {expression: 'Lib.Widget', assemblyIdentity: 'VersionedLib'}),
    {code: 'METADATA_DEFINITION_AMBIGUOUS'});
  const metadata = new MetadataCatalog({sources: async () => [{...source, read: async () => miniBytes}], inspect});
  const result = await metadata.definition({owner: 'System.Console', name: 'WriteLine', assemblyIdentity: 'MiniStandard'});
  assert.match(result.assemblyIdentity, /^MiniStandard, Version=2\.1\.0\.0/u);
  metadata.dispose();
});

test('reference sources use authorized HintPath bytes, transitive project visibility and no source text getters', async () => {
  const file = {path: 'lib/MiniStandard.dll', version: 2, bytes: miniBytes};
  const huge = {path: 'Large.cs', get text() { throw new Error('Whole source must not be read'); }};
  const projects = new Map([
    ['a.csproj', {path: 'a.csproj', references: [], projectReferences: [{path: 'b.csproj'}]}],
    ['b.csproj', {path: 'b.csproj', references: [{name: 'MiniStandard', hintPath: file.path}], projectReferences: []}]
  ]);
  const current = {workspaceEpoch: 7, projectSystem: {projects, files: new Map([[file.path, file], [huge.path, huge]])}};
  const sources = createStudioMetadataSources({state: () => current});
  let reads = 0;
  const catalog = new MetadataCatalog({sources, inspect: (bytes, identity) => { reads++; assert.equal(bytes, miniBytes); return inspect(bytes, identity); }});
  const first = await catalog.load({projectId: 'a.csproj'});
  assert.equal(first.diagnostics.length, 0);
  assert.equal(first.assemblies.at(-1).name, 'MiniStandard');
  await catalog.load({projectId: 'a.csproj'});
  assert.equal(reads, 1);
  file.version++;
  await catalog.load({projectId: 'a.csproj'});
  assert.equal(reads, 2);
  current.workspaceEpoch++;
  await catalog.load({projectId: 'a.csproj'});
  assert.equal(reads, 3);
  catalog.dispose();
});

test('unavailable, ambiguous and invalid PE references return explicit Object Browser diagnostic rows', async () => {
  const records = [{path: 'a/Lib.dll', bytes: miniBytes}, {path: 'b/Lib.dll', bytes: miniBytes}];
  const state = {projectSystem: {files: new Map(records.map(record => [record.path, record])), projects: new Map([
    ['p', {path: 'p', references: [{name: 'Missing'}, {name: 'Lib'}, {name: 'Bad', hintPath: 'Bad.dll'}]}]
  ])}};
  state.projectSystem.files.set('Bad.dll', {path: 'Bad.dll', bytes: new Uint8Array(32)});
  const catalog = new MetadataCatalog({sources: createStudioMetadataSources({state: () => state}), inspect});
  const result = await catalog.load({projectId: 'p'});
  assert.equal(result.diagnostics.length, 3);
  assert.deepEqual(result.diagnostics.slice(0, 2).map(item => item.code), ['METADATA_REFERENCE_UNAVAILABLE', 'METADATA_REFERENCE_AMBIGUOUS']);
  const roots = await metadataTree(result.assemblies, result);
  assert.equal(roots.filter(node => node.label.endsWith('metadata unavailable')).length, 3);
  catalog.dispose();
});

test('metadata inspection rejects byte and declaration limits before returning a partial model', () => {
  assert.throws(() => inspectMetadata(new Uint8Array(32)), /PE|signature/u);
  assert.throws(() => inspectMetadata(miniBytes, {limits: {...metadataLimits, bytes: miniBytes.length - 1}}), {code: 'METADATA_BYTES_LIMIT'});
  assert.throws(() => inspectMetadata(miniBytes, {limits: {...metadataLimits, symbols: 2}}), {code: 'METADATA_SYMBOL_LIMIT'});
});

test('catalog cancellation terminates its dedicated metadata worker and does not cache late replies', async () => {
  let worker, started;
  const ready = new Promise(resolve => { started = resolve; });
  const catalog = new MetadataCatalog({sources: async () => [{...source, read: async () => miniBytes}], createWorker: () => {
    worker = {terminated: false, postMessage: () => started(), terminate() { this.terminated = true; }};
    return worker;
  }});
  const controller = new AbortController(), pending = catalog.load({signal: controller.signal});
  await ready;
  controller.abort();
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(worker.terminated, true);
  worker.onmessage({data: {type: 'result', result: inspect(miniBytes, source)}});
  assert.equal(catalog.cache.size, 0);
  catalog.dispose();
  await assert.rejects(catalog.definition({expression: 'Console'}), {name: 'AbortError'});
});

test('Code Definition reads only a bounded caret fragment and prioritizes structured bound owners', async () => {
  const snippet = 'Console . WriteLine("hello");';
  const file = {uri: 'Large.cs', version: 5, get text() { throw new Error('Whole large source read'); }};
  const documents = {get: uri => uri === file.uri ? file : null,
    models: new Map([[file.uri, {length: 100_000_000, getText: (start, end) => {
      assert(end - start <= 1024);
      return snippet + ' '.repeat(end - start - snippet.length);
    }}]])};
  const current = {uri: file.uri, offset: 14, projectId: 'p'};
  assert.equal(metadataQuery(documents, file, current).expression, 'Console.WriteLine');
  assert.deepEqual(metadataQuery(documents, file, current, {metadata: {owner: 'System.Console', name: 'Console', kind: 'class'}}),
    {expression: 'System.Console', type: 'System.Console', assemblyIdentity: undefined});
  const metadata = new MetadataCatalog();
  const result = await resolveCodeDefinition({documents, metadata, request: async method => method === 'definition' ? null :
    {contents: 'Human prose is deliberately irrelevant', metadata: {owner: 'System.Console', name: 'WriteLine', kind: 'method'}}}, current);
  assert.match(result.target.text.slice(result.definition.start, result.definition.end), /WriteLine/u);
  assert.equal(result.sourceVersion, 5);
  metadata.dispose();
});

test('Code Definition source definitions bypass metadata and retain exact selection', async () => {
  const file = {uri: 'A.cs', text: 'void Run() {}', version: 3}, target = {uri: 'B.cs', text: 'void Run() {}', version: 4};
  const definition = {uri: target.uri, start: 5, end: 8};
  const result = await resolveCodeDefinition({documents: {get: uri => uri === file.uri ? file : target},
    request: async () => definition, metadata: {definition() { throw new Error('Metadata should not be queried'); }}}, {uri: file.uri, offset: 6});
  assert.equal(result.target, target);
  assert.equal(result.definition, definition);
});
