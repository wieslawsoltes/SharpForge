import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeDesignSources, designSourceSnapshot, DesignDocument} from '@sharpforge/designer';
import {DesignerWorkerAnalysisCache} from '../apps/studio/designer-worker-cache.js';
import {DesignerWorkerQueue} from '../apps/studio/designer-worker-queue.js';
import {designerWorkerHarness} from './fixtures/a18-component-preview.js';

const files = [{uri: 'Views.cs', version: 3, text: `using Microsoft.UI.Xaml.Controls;
class Alpha { public static Grid Create() { var root = new Grid { Width = 120 }; return root; } }
class Beta { public static Grid Create() { var root = new Grid { Width = 240 }; return root; } }`}];
const options = {uri: 'Views.cs', className: 'Alpha', methodName: 'Create'};

test('shared semantic analysis selects a fresh owner and invalidates on source, permission and compiler option changes', () => {
  const alpha = analyzeDesignSources(files, options);
  const beta = analyzeDesignSources(files, {...options, className: 'Beta', reuseAnalysis: alpha});
  assert.equal(alpha.compilationSucceeded, true);
  assert.equal(beta.context.model, alpha.context.model);
  assert.equal(beta.context.parsedFiles, alpha.context.parsedFiles);
  assert.notEqual(beta.context, alpha.context);
  assert.equal(beta.ownership.className, 'Beta');
  assert.equal(beta.document.nodes[0].properties.Width, 240);
  for (const changes of [{version: 4}, {readOnly: true}, {text: files[0].text.replace('Width = 240', 'Width = 260')}]) {
    const changed = analyzeDesignSources([{...files[0], ...changes}], {...options, reuseAnalysis: alpha});
    assert.notEqual(changed.context.model, alpha.context.model);
  }
  const compilerChanged = analyzeDesignSources(files, {...options, reuseAnalysis: alpha, compilationOptions: {langVersion: 'preview'}});
  assert.notEqual(compilerChanged.context.model, alpha.context.model);
});

test('bounded cache keys include owner, method, compiler context, catalog, workspace and retained design identities', () => {
  const analysis = analyzeDesignSources(files, options);
  const previous = designSourceSnapshot(analysis);
  const params = {...options, previous, workspaceId: 'one'};
  const cache = new DesignerWorkerAnalysisCache({maxDocuments: 1});
  cache.set(params, analysis);
  assert.equal(cache.get(params, files), analysis);
  for (const changes of [{className: 'Beta'}, {methodName: 'Other'}, {workspaceId: 'two'},
    {compilationOptions: {langVersion: 'preview'}}, {projectTypes: []},
    {previous: {...previous, document: {...previous.document, name: 'Other'}}}]) {
    assert.equal(cache.get({...params, ...changes}, files), null);
  }
  assert.equal(cache.get(params, [{...files[0], readOnly: true}]), null);
  cache.set({...params, className: 'Beta'}, analysis);
  assert.equal(cache.get(params, files), null);
  assert.equal(cache.entries.size, 1);
  cache.clear();
  assert.equal(cache.characters, 0);
  const disabled = new DesignerWorkerAnalysisCache({maxDocuments: 0});
  disabled.set(params, analysis);
  assert.equal(disabled.get(params, files), null);
  assert.throws(() => new DesignerWorkerAnalysisCache({maxDocuments: -1}), RangeError);
});

test('worker plans do not reuse another class in the same source file or ignore changed edit permissions', async context => {
  const compiler = designerWorkerHarness(context);
  const snapshots = [];
  for (const className of ['Alpha', 'Beta']) {
    const result = await compiler.request('designAnalyze', {...options, className, files, revision: 3, workspaceId: 'one'});
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    snapshots.push(result.analysis);
  }
  for (const [index, previous] of snapshots.entries()) {
    const document = new DesignDocument(previous.document);
    document.setProperty('Width', 400 + index, ['root']);
    const params = {operation: 'plan', uri: 'Views.cs', previous, files, baselineSources: files,
      design: document.value, revision: 3, workspaceId: 'one'};
    const plan = await compiler.request('designAnalyze', params);
    assert.equal(plan.success, true, JSON.stringify(plan.diagnostics));
    assert.equal(plan.analysis.ownership.className, index ? 'Beta' : 'Alpha');
    assert.match(plan.text, new RegExp('Width = ' + (400 + index)));
    assert.match(plan.text, new RegExp('Width = ' + (index ? 120 : 240)));
    const denied = await compiler.request('designAnalyze', {...params, files: [{...files[0], readOnly: true}]});
    assert.equal(denied.success, false);
    assert.equal(denied.diagnostics[0].code, 'SFD0005');
    document.dispose();
  }
});

test('queued reads coalesce only the same owner stream, including a full queue replacement', async () => {
  const queue = new DesignerWorkerQueue({maxPending: 1});
  const executed = [];
  const params = {operation: 'analyze', workspaceId: 'one', requestOwner: 'source:Views.cs', ...options};
  const first = queue.run({...params, generation: 1}, {}, () => executed.push('old'));
  const second = queue.run({...params, generation: 2}, {}, () => executed.push('current'));
  const results = await Promise.allSettled([first, second]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[0].reason.code, 'SFSYNC_CANCELLED');
  assert.equal(results[1].status, 'fulfilled');
  assert.deepEqual(executed, ['current']);
  await assert.rejects(queue.run({...params, generation: 1}, {}, () => executed.push('stale')), {code: 'SFSYNC_CANCELLED'});
  queue.dispose();
});

test('cancellation and disposal remove queued work without executing it; independent owners and writes remain separate', async () => {
  const queue = new DesignerWorkerQueue();
  const abort = new AbortController();
  let executed = 0;
  const pending = queue.run({uri: 'Views.cs'}, {signal: abort.signal}, () => executed++);
  abort.abort();
  await assert.rejects(pending, {code: 'SFSYNC_CANCELLED'});
  assert.equal(executed, 0);
  const params = {requestOwner: 'owner', workspaceId: 'one', uri: 'Views.cs', generation: 1};
  await Promise.all([
    queue.run({...params, className: 'Alpha'}, {}, () => executed++),
    queue.run({...params, className: 'Beta'}, {}, () => executed++),
    queue.run({...params, operation: 'plan'}, {}, () => executed++),
    queue.run({...params, operation: 'plan'}, {}, () => executed++)
  ]);
  assert.equal(executed, 4);
  const disposed = queue.run(params, {}, () => executed++);
  queue.dispose();
  await assert.rejects(disposed, {code: 'SFSYNC_CANCELLED'});
  assert.equal(executed, 4);
  assert.equal(queue.pending.size, 0);
  await assert.rejects(queue.run(params, {}, () => executed++), {code: 'SFSYNC_CANCELLED'});
});
