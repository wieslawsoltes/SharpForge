import test from 'node:test';
import assert from 'node:assert/strict';
import {searchDocuments, compileFileGlobs} from '../apps/studio/workbench/search-engine.js';
import {SearchService, WorkspaceSymbolIndex, fuzzyMatch} from '../apps/studio/workbench/search-service.js';
import {ErrorListModel} from '../apps/studio/workbench/tools/error-list.js';
import {ScopeSelector} from '../apps/studio/workbench/tools/scope-selector.js';
import {OutputModel, outputLocation} from '../apps/studio/workbench/tools/output.js';
import {Bookmarks} from '../apps/studio/workbench/tools/bookmarks.js';
import {ReferenceResults} from '../apps/studio/workbench/tools/references.js';

function documents(files) {
  return {list: () => files, get: uri => files.find(file => file.uri === uri)};
}

test('search supports captures literal metacharacters exact versions whole words and bounded empty regex matches', () => {
  const files = [{uri: 'src/Program.cs', text: 'foo1\nFoo22 foot\n.', version: 3, projectId: 'a'}];
  const result = searchDocuments(files, '(foo)(\\d+)', {regex: true, replacement: '$2:$1'});
  assert.deepEqual(result.matches.map(match => [match.start, match.line, match.replacement, match.version]),
    [[0, 0, '1:foo', 3], [5, 1, '22:Foo', 3]]);
  assert.equal(searchDocuments(files, '.').matches.length, 1);
  assert.equal(searchDocuments(files, 'foo', {wholeWord: true}).matches.length, 0);
  assert.equal(searchDocuments(files, '^', {regex: true}).matches.length, 1);
  assert.equal(searchDocuments(files, 'o', {maxMatches: 1}).truncated, true);
  assert.throws(() => searchDocuments(files, '[', {regex: true}), SyntaxError);
  assert(compileFileGlobs('*.cs;*.xaml')('src/Program.cs'));
  assert(!compileFileGlobs('*.cs')('README.md'));
  assert(fuzzyMatch('ParticleRenderer', 'PR'));
});

test('replacement preview skips changed documents and preserves unchecked matches as one batch per document', async () => {
  const files = [{uri: 'a.cs', text: 'foo foo', version: 1}, {uri: 'b.cs', text: 'foo', version: 1}];
  const edits = [];
  const service = new SearchService({documents: documents(files), createWorker: null,
    applyEdits: async batch => edits.push(batch)});
  const result = await service.run('foo', {replacement: 'bar', scope: 'solution'});
  files[1].version++;
  const applied = await service.replace(result.id, [result.matches[0].id, result.matches[2].id]);
  assert.equal(edits.length, 1); assert.equal(edits[0].length, 1); assert.equal(edits[0][0].start, 0);
  assert.deepEqual(applied.changedDocuments, ['a.cs']); assert.equal(applied.skipped.length, 1);
  service.results.get(result.id).locked = true;
  await assert.rejects(service.run('foo'), /locked/);
  assert.notEqual((await service.run('foo', {keepResults: true})).id, result.id);
  service.dispose();
});

test('worker cancellation terminates a pathological query without affecting a second results instance', async () => {
  const workers = [];
  class Worker {
    postMessage(message) { this.message = message; }
    terminate() { this.terminated = true; }
  }
  const service = new SearchService({documents: documents([{uri: 'a.cs', text: 'x', version: 1}]),
    createWorker: () => { const worker = new Worker(); workers.push(worker); return worker; }});
  const controller = new AbortController();
  const first = service.run('(x+)+y', {regex: true, signal: controller.signal, instance: 'find-results-1'});
  const second = service.run('x', {instance: 'find-results-2'});
  controller.abort();
  await assert.rejects(first, {name: 'AbortError'});
  assert.equal(workers[0].terminated, true); assert.equal(workers[1].terminated, undefined);
  workers[1].onmessage({data: {type: 'result', result: {matches: [], scannedFiles: 1}}});
  assert.equal((await second).id, 'find-results-2'); service.dispose();
});

test('workspace symbol results reject superseded requests and changed document versions', async () => {
  const file = {uri: 'a.cs', text: 'class A {}', version: 1};
  const pending = [];
  const index = new WorkspaceSymbolIndex({documents: documents([file]), request: () => new Promise(resolve => pending.push(resolve))});
  const first = index.query('A'); const second = index.query('B');
  pending[0]([{id: 'a', name: 'A'}]);
  await assert.rejects(first, {name: 'AbortError'});
  file.version = 2; pending[1]([{id: 'b', name: 'B'}]);
  assert.deepEqual(await second, []); index.dispose();
});

test('Error List combines source scope severity search and sort over 5000 real diagnostic records', () => {
  const diagnostics = Array.from({length: 5000}, (_, index) => ({id: String(index), code: 'CS' + index,
    severity: index % 3 ? 'warning' : 'error', source: index % 2 ? 'analysis' : 'build',
    projectId: index % 5 ? 'a' : 'b', uri: index % 7 ? 'a.cs' : 'b.cs',
    message: index % 11 ? 'ordinary' : 'target', start: index, length: 2, range: {start: {line: index}}}));
  const scope = new ScopeSelector({initial: 'current-project'});
  const model = new ErrorListModel({diagnostics: {query: () => diagnostics}, scope, context: () => ({projectId: 'a'})});
  model.source = 'build'; model.severities = new Set(['error']); model.search = 'target'; model.sort = 'line'; model.descending = true;
  const expected = diagnostics.filter(item => item.projectId === 'a' && item.source === 'build' && item.severity === 'error' && item.message === 'target');
  const rows = model.rows(); assert.equal(rows.length, expected.length);
  assert(rows.every((row, index) => index === 0 || rows[index - 1].line > row.line));
  assert(model.copy(rows).includes('suppression'));
});

test('Output model bounds 100000 line inputs and compiler message links preserve location', () => {
  const entries = [{id: 1, timestamp: 0, text: Array.from({length: 100005}, (_, index) => 'line ' + index).join('\n')}];
  const channel = {id: 'Build', count: 1, revision: 1, projectId: 'a'};
  const model = new OutputModel({channels: {get: () => channel, read: () => entries, list: () => [channel]}});
  assert.equal(model.rows().length, 100000); assert.equal(model.rows()[0].text, 'line 5');
  assert.deepEqual(outputLocation('src/Program.cs(12,4): error CS1000', 'a'), {uri: 'src/Program.cs', line: 11, character: 3, projectId: 'a'});
  assert.deepEqual(outputLocation('C:\\src\\Program.cs:3:2: warning', 'a'), {uri: 'C:\\src\\Program.cs', line: 2, character: 1, projectId: 'a'});
});

test('bookmarks move with source insertions and locked reference results remain unchanged', () => {
  const file = {uri: 'a.cs', text: 'one\ntwo\n', version: 1};
  const model = new Bookmarks({documents: documents([file])}); model.toggle('a.cs', 4);
  file.text = '// before\n' + file.text; file.version++; model.trackChanges();
  assert.equal(model.rows()[0].line, 3); assert.equal(model.items[0].offset, 14);
  const references = new ReferenceResults();
  const first = references.set([{uri: 'a.cs', start: 1, end: 2, kind: 'write', projectId: 'a'}]); first.locked = true;
  const second = references.set([{uri: 'b.cs', start: 1, end: 2, kind: 'read', projectId: 'b'}]);
  assert.notEqual(first.id, second.id); assert.equal(references.windows.get(first.id).rows[0].uri, 'a.cs');
  assert.equal(references.groups(second.id, {kind: 'write'}).length, 0);
});
