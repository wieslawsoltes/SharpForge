import test from 'node:test';
import assert from 'node:assert/strict';
import {FileWatch} from '../apps/studio/workbench/file-watch.js';
import {boundedDocuments, readDocumentRange} from '../apps/studio/workbench/document-size.js';
import {Bookmarks, trackOffset} from '../apps/studio/workbench/tools/bookmarks.js';
import {OutputModel} from '../apps/studio/workbench/tools/output.js';
import {ScopeSelector} from '../apps/studio/workbench/tools/scope-selector.js';
import {ReferenceResults} from '../apps/studio/workbench/tools/references.js';
import {SearchService} from '../apps/studio/workbench/search-service.js';
import {searchDocuments} from '../apps/studio/workbench/search-engine.js';
import {effectiveBindings, keyboardConflicts} from '../apps/studio/workbench/options/keyboard-page.js';
import {TestProviders} from '../apps/studio/workbench/tools/test-explorer.js';
import {filterFindResults} from '../apps/studio/workbench/tools/find-results.js';
import {registerStatusRegions} from '../apps/studio/workbench/status-bar.js';
import {SettingsStore} from '../apps/studio/workbench/settings-store.js';
import {SolutionExplorerViews} from '../apps/studio/workbench/tools/solution-explorer-views.js';
import {StatusPosition} from '../apps/studio/workbench/status-position.js';
import {SourceText} from '@sharpforge/text';

test('status updates read model positions and EOL metadata without flattening a 100 MB document', () => {
  const file = {uri: 'huge.cs', version: 1, get text() { throw new Error('Status flattened the document'); }};
  const model = {length: 100_000_000, metadata: {encoding: 'utf-16le', dominantEol: '\r\n', mixedEol: true},
    positionAt: offset => ({line: 999, character: offset - 9000})};
  const documents = {get: () => file, models: new Map([[file.uri, model]])};
  const regions = new Map();
  registerStatusRegions({register: region => regions.set(region.id, region)}, {
    context: () => ({uri: file.uri, offset: 9002, visualColumn: 2}), documents,
    tasks: {running: [], subscribe() {}}, notifications: {unread: 0, subscribe() {}},
    settings: {get() {}}, execute() {}
  });
  assert.equal(regions.get('cursor').value(), 'Ln 1000, Col 3, Ch 3');
  assert.equal(regions.get('encoding').value(), 'utf-16le');
  assert.equal(regions.get('line-ending').value(), 'CRLF (mixed)');
  model.metadata = {...model.metadata, dominantEol: '\r', mixedEol: false};
  assert.equal(regions.get('line-ending').value(), 'CR');
});

test('status visual columns distinguish tabs, CJK, zero-width clusters and UTF-16 characters', () => {
  const source = new SourceText('first\n\t中e\u0301\u200b😀');
  const offset = source.length;
  const position = source.positionAt(offset);
  const status = new StatusPosition();
  assert.equal(position.line, 1);
  assert.equal(position.character, 7);
  assert.equal(status.column(source, position, {offset, tabSize: 4}), 9);
  assert.equal(status.column(source, position, {offset, tabSize: 8}), 13);
  assert.equal(status.column(source, source.positionAt(offset - 1), {offset: offset - 1, tabSize: 4}), 7);
  status.dispose();
});

test('status uses cancellable exact model columns and ignores stale carets without flattening source', async () => {
  const requests = [];
  let updates = 0;
  const model = {version: 1, length: 100_000_000,
    get text() { throw new Error('Status flattened source'); }, getText() { throw new Error('Status bypassed column index'); },
    cachedVisualColumnAtOffset: () => null,
    visualColumnAtOffset: (offset, {signal}) => new Promise(resolve => requests.push({offset, signal, resolve}))};
  const status = new StatusPosition({onChange: () => updates++});
  assert.equal(status.column(model, {line: 0, character: 90_000_000}, {offset: 90_000_000}), null);
  await Promise.resolve();
  assert.equal(status.pending, true);
  assert.equal(status.column(model, {line: 0, character: 80_000_000}, {offset: 80_000_000}), null);
  await Promise.resolve();
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve(90000000);
  requests[1].resolve(42);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(updates, 1);
  assert.equal(status.column(model, {line: 0, character: 80_000_000}, {offset: 80_000_000}), 42);
  assert.equal(status.pending, false);
  status.dispose();
  assert.equal(requests[1].signal.aborted, true);
});

test('reading one setting preserves workspace null overrides without cloning unrelated layouts', () => {
  const settings = new SettingsStore({storage: null});
  settings.apply({layouts: {current: {id: 'user-layout'}, named: {one: {id: 'one'}}}});
  settings.apply({layouts: {current: null}, editor: {tabSize: 2}}, {scope: 'workspace'});
  let reads = 0;
  Object.defineProperty(settings.user.layouts.named, 'expensive', {enumerable: true, get() { reads++; return {id: 'large-layout'}; }});
  assert.equal(settings.get('editor', 'tabSize'), 2);
  assert.equal(settings.get('layouts', 'current'), null);
  assert.equal(reads, 0);
  const names = settings.get('layouts', 'named');
  names.one.id = 'modified';
  assert.equal(settings.get('layouts', 'named').one.id, 'one');
  assert.equal(reads, 2);
});

test('Solution Explorer filtering never reads document content synchronously', () => {
  const file = {uri: 'huge.cs', version: 1, get text() { throw new Error('Explorer flattened the document'); }};
  const documents = {list: () => [file], get: () => file, models: new Map([[file.uri, {length: 100_000_000}]])};
  const model = new SolutionExplorerViews({documents, context: () => ({}), getData: () => ({
    name: 'Project', mode: 'folder', files: [{path: 'huge.cs'}]
  })});
  const view = model.create();
  assert.equal(model.nodes(view)[0].children[0].children[0].path, 'huge.cs');
  view.search = 'needle';
  view.contentSearch = true;
  assert.doesNotThrow(() => model.nodes(view));
});

test('definition range reads stay bounded at a caret near the end of a large indexed document', () => {
  const file = {uri: 'huge.cs', get text() { throw new Error('Definition flattened the document'); }};
  const reads = [];
  const model = {length: 100_000_000, getText: (start, end) => { reads.push([start, end]); return 'x'.repeat(end - start); }};
  const documents = {models: new Map([[file.uri, model]])};
  const excerpt = readDocumentRange(documents, file, {start: model.length - 1024});
  assert.deepEqual(reads, [[99_998_976, 100_000_000]]);
  assert.equal(excerpt.text.length, 1024);
  assert.equal(excerpt.truncated, true);
  assert.throws(() => readDocumentRange(documents, file, {start: 0, end: model.length}), /limit/);
  assert.deepEqual(reads, [[99_998_976, 100_000_000]]);
});

test('Explorer content searches retain actual worker URI matches and reject stale or cancelled results', async () => {
  const file = {uri: 'a.cs', version: 1, text: 'class Needle {}'};
  const documents = {list: () => [file], get: () => file};
  let finish;
  const search = {createWorker() {}, search: () => new Promise(resolve => { finish = resolve; })};
  const model = new SolutionExplorerViews({documents, search, context: () => ({}), getData: () => ({files: [{path: file.uri}]})});
  const view = model.create();
  view.search = 'Needle';
  view.contentSearch = true;
  const first = model.findContents(view);
  finish({matches: [{uri: file.uri}]});
  await first;
  assert.deepEqual([...view.contentMatches], ['a.cs']);
  assert.equal(model.nodes(view)[0].children[0].children[0].path, file.uri);
  view.search = 'Changed';
  const stale = model.findContents(view);
  file.version++;
  finish({matches: [{uri: file.uri}]});
  await assert.rejects(stale, {name: 'AbortError'});
  assert.equal(view.contentMatches.size, 0);
  const cancelled = model.findContents(view);
  model.dispose();
  finish({matches: [{uri: file.uri}]});
  await assert.rejects(cancelled, {name: 'AbortError'});
});

test('automatic recovery and bookmark construction never materialize a 100 MB model-backed file', async () => {
  let reads = 0, diskReads = 0;
  const file = {uri: 'huge.cs', version: 1, dirty: true, get text() { reads++; throw new Error('Lazy text was materialized'); }};
  const model = {buffer: {length: 100_000_001}};
  const documents = {list: () => [file], get: () => file, models: new Map([[file.uri, model]])};
  const bookmarks = new Bookmarks({documents});
  bookmarks.trackChanges({type: 'changed', uri: file.uri, changes: [{start: 0, end: 0, text: 'x'}]});
  const notices = [];
  const watch = new FileWatch({documents, notify: item => notices.push(item), readDisk: async () => { diskReads++; }});
  assert.equal(watch.snapshot(), null);
  await watch.poll();
  assert.equal(reads, 0);
  assert.equal(diskReads, 0);
  assert.equal(notices.length, 1);
  assert.throws(() => boundedDocuments(documents, [file]), /size limit/);
  assert.equal(reads, 0);
  watch.dispose();
});

test('existing recovery is retained until the user restores or discards it', () => {
  const values = new Map([['sharpforge.workbench.recovery.default', '{"version":1,"files":[{"uri":"old.cs","text":"unsaved"}]}']]);
  const storage = {getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
  const watch = new FileWatch({documents: {list: () => []}, storage});
  watch.snapshot();
  assert.equal(watch.recovery().files[0].text, 'unsaved');
  watch.recoveryPending = false;
  watch.snapshot();
  assert.equal(watch.recovery(), null);
  watch.dispose();
});

test('bookmark edit transformation handles several pre-edit coordinates and wraps across files', () => {
  const changes = [{start: 0, end: 2, text: ''}, {start: 8, end: 8, text: 'abc'}];
  assert.equal(trackOffset(10, changes), 11);
  assert.equal(trackOffset(1, changes), 0);
  const files = [{uri: 'a.cs', text: 'a\nb\nc', version: 1}, {uri: 'b.cs', text: 'one', version: 1}];
  const model = new Bookmarks({documents: {list: () => files, get: uri => files.find(file => file.uri === uri)}});
  model.toggle('a.cs', 0);
  model.toggle('a.cs', 2);
  model.toggle('b.cs', 0);
  assert.equal(model.next('a.cs', 4, true).offset, 2);
  assert.equal(model.next('b.cs', 2, true).uri, 'b.cs');
  assert.equal(model.next('b.cs', 2).uri, 'a.cs');
});

test('Output filters project and session identity from shared channel entries', () => {
  const channel = {id: 'Build', revision: 1, count: 2};
  const entries = [{id: 1, text: 'a.cs(1): first', metadata: {projectId: 'a', sessionId: 'one'}},
    {id: 2, text: 'b.cs(2): second', metadata: {projectId: 'b', sessionId: 'two'}}];
  const scope = new ScopeSelector({initial: 'session:two'});
  const model = new OutputModel({scope, channels: {get: () => channel, list: () => [channel], read: () => entries}});
  assert.equal(model.choices().length, 1);
  assert.deepEqual(model.rows().map(row => row.projectId), ['b']);
  assert.equal(model.rows()[0].location.uri, 'b.cs');
});

test('Find Results changes retained project or session scope without requesting another search', () => {
  const result = {matches: [{id: 'a', uri: 'a.cs', projectId: 'a'}, {id: 'b', uri: 'b.cs', projectId: 'b'}]};
  const search = {sessionProject: id => id === 'two' ? 'b' : 'a', context: () => ({projectId: 'a'}),
    run() { throw new Error('Scope changes must not rerun search'); }};
  assert.deepEqual(filterFindResults(result, new ScopeSelector({initial: 'current-project'}), search).map(row => row.id), ['a']);
  assert.deepEqual(filterFindResults(result, new ScopeSelector({initial: 'session:two'}), search).map(row => row.id), ['b']);
  assert.equal(result.matches.length, 2);
});

test('locked result windows remain bounded without silently discarding retained results', async () => {
  const references = new ReferenceResults();
  for (let index = 0; index < 20; index++) references.set([], {keep: true}).locked = true;
  assert.throws(() => references.set([], {keep: true}), /20 reference/);
  assert.equal(references.windows.size, 20);
  const service = new SearchService({documents: {list: () => [], get() {}}, createWorker: null});
  for (let index = 0; index < 20; index++) (await service.run('x', {keepResults: true})).locked = true;
  await assert.rejects(service.run('x', {keepResults: true}), /20 search/);
  assert.equal(service.results.size, 20);
  service.dispose();
  await assert.rejects(service.run('x'), {name: 'AbortError'});
});

test('regex replacement retains lookbehind, named captures and original string substitutions', () => {
  const text = 'a Foo12 z';
  const pattern = '(?<=a )(?<name>Foo)(\\d+)';
  const replacement = "$<name>:$2:$`:$':$$:$&";
  const result = searchDocuments([{uri: 'a.cs', text, version: 1}], pattern, {regex: true, matchCase: true, replacement});
  const row = result.matches[0];
  assert.equal(text.slice(0, row.start) + row.replacement + text.slice(row.end), text.replace(new RegExp(pattern, 'u'), replacement));
  assert.equal(searchDocuments([{uri: 'a.cs', text: '𐐀foo foo', version: 1}], 'foo', {wholeWord: true}).matches.length, 1);
});

test('keyboard removal applies to default ids before conflict calculation', () => {
  const defaults = [{id: 'save', command: 'save', keys: 'Ctrl+S', scope: 'Global'}];
  const removed = [{...defaults[0], id: 'removed:save', removed: true}];
  assert.deepEqual(effectiveBindings(defaults, removed), []);
  assert.equal(keyboardConflicts(defaults, {command: 'custom', keys: 'Ctrl+S', scope: 'Text Editor'}).length, 1);
  assert.equal(effectiveBindings(defaults, [{...defaults[0], keys: 'Ctrl+Alt+S'}])[0].keys, 'Ctrl+Alt+S');
});

test('provider failures terminate queued test state instead of leaving a run in progress', async () => {
  const model = new TestProviders();
  model.register('broken', {discover: async () => [{id: 'one', name: 'one'}], run: async () => { throw new Error('provider failed'); }});
  await model.discover();
  await assert.rejects(model.run(), /provider failed/);
  assert.equal(model.tests.get('broken:one').state, 'failed');
  assert.equal(model.runs.size, 0);
  model.dispose();
});
