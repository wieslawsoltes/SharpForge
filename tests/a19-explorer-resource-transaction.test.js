import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorModel } from '@sharpforge/editor';
import { explorerDocuments } from './fixtures/a19-explorer-document-fixture.js';
import { preparedExplorerModel } from '../apps/studio/explorer-records.js';
import { applyExplorerResourceTransaction } from '../apps/studio/explorer-resource-transaction.js';

function fixture(extra = '') {
  return explorerDocuments([
    { path: 'App/Alpha.cs', text: 'class Alpha { public Alpha() {} }' + extra, encoding: 'utf-16le', bom: true },
    { path: 'App/Use.cs', text: 'class Use { Alpha Create() { return new Alpha(); } }' },
    { path: 'Unrelated.cs', text: 'class Unrelated {}' },
    { path: 'App/App.csproj', text: '<Project><ItemGroup><Compile Include="Alpha.cs" />'
      + '<Compile Include="Use.cs" /></ItemGroup><!-- Alpha.cs stays in a comment --></Project>' }
  ]);
}

function planFor(fixture, oldName = 'Alpha', newName = 'Beta', affected = ['App/Alpha.cs', 'App/Use.cs']) {
  const changes = affected.map(uri => {
    const model = fixture.documents.models.get(uri);
    const before = model.getText();
    const edits = [...before.matchAll(new RegExp(oldName, 'g'))]
      .map(match => Object.freeze({ start: match.index, end: match.index + oldName.length, text: newName }));
    return Object.freeze({ uri, version: model.version, before, text: before.replaceAll(oldName, newName), edits: Object.freeze(edits) });
  });
  const model = fixture.documents.models.get('App/Alpha.cs');
  return Object.freeze({ label: 'Rename Alpha', changes: Object.freeze(changes), resources: Object.freeze([
    Object.freeze({ kind: 'rename', oldUri: 'App/Alpha.cs', newUri: 'App/Beta.cs', version: model.version, before: model.getText() })
  ]) });
}

const apply = (fixture, plan = planFor(fixture), options = {}) => applyExplorerResourceTransaction(plan, {
  documents: fixture.documents, explorer: fixture.commands, ...options
});

test('resource rename publishes source edits, file paths and literal project references in one undoable host commit', async () => {
  const host = fixture();
  const original = host.documents.models.get('App/Alpha.cs');
  const unaffected = host.documents.models.get('Unrelated.cs');
  const baseline = original.snapshot();
  original.applyEdits([{ start: 0, end: 0, text: '// unsaved\n' }]);
  const before = original.snapshot();
  host.documents.open('App/Alpha.cs');
  let commits = 0;
  const unsubscribe = host.documents.subscribe(event => {
    if (event.type !== 'reset') return;
    assert(host.documents.models.has('App/Beta.cs'));
    assert.match(host.context().records.find(record => record.path.endsWith('.csproj')).text, /Compile Include="Beta.cs"/);
  });
  const commit = host.host.commit;
  host.host.commit = prepared => {
    commits++;
    assert.equal(host.documents.models.get('App/Alpha.cs'), original);
    assert.equal(original.snapshot(), before);
    assert.equal(host.documents.models.has('App/Beta.cs'), false);
    assert.equal(typeof prepared.validate, 'function');
    return commit(prepared);
  };
  const result = await apply(host);
  assert.equal(result.applied, true);
  assert.equal(commits, 1);
  assert.equal(host.documents.models.has('App/Alpha.cs'), false);
  const renamed = host.documents.get('App/Beta.cs');
  assert.equal(renamed.model.getText(), '// unsaved\nclass Beta { public Beta() {} }');
  assert.equal(renamed.dirty, true);
  assert.equal(renamed.encoding, 'utf-16le');
  assert.equal(renamed.bom, true);
  assert.equal(host.documents.baselines.get(renamed.uri).getText(), baseline.getText());
  assert.match(host.documents.models.get('App/Use.cs').getText(), /new Beta\(\)/);
  const xml = host.context().records.find(record => record.path.endsWith('.csproj')).text;
  assert.match(xml, /Compile Include="Beta.cs"/);
  assert.match(xml, /<!-- Alpha.cs stays in a comment -->/);
  assert.equal(host.documents.models.get('Unrelated.cs'), unaffected);
  assert.equal(host.documents.active, 'App/Beta.cs');
  assert.equal(host.commands.history.length, 1);
  assert.equal(before.statistics.textMaterialized, false);
  assert.equal(renamed.source.statistics.textMaterialized, false);
  unsubscribe();
  host.host.commit = commit;
  await host.commands.undo();
  assert.equal(host.documents.get('App/Alpha.cs').source, before);
  assert.equal(host.documents.get('App/Alpha.cs').dirty, true);
  assert.equal(host.documents.baselines.get('App/Alpha.cs'), baseline);
  assert.match(host.context().records.find(record => record.path.endsWith('.csproj')).text, /Include="Alpha.cs"/);
  assert.equal(host.documents.models.get('Unrelated.cs'), unaffected);
  host.dispose();
});

test('multiple independent resource renames share one operation and preserve unedited clean sources', async () => {
  const host = fixture();
  const plan = planFor(host, 'Alpha', 'Beta', ['App/Alpha.cs']);
  const use = host.documents.models.get('App/Use.cs');
  const second = { kind: 'rename', oldUri: 'App/Use.cs', newUri: 'App/Consumer.cs', version: use.version, before: use.getText() };
  await apply(host, { ...plan, resources: [...plan.resources, second] });
  assert.equal(host.commands.history.length, 1);
  assert.equal(host.documents.get('App/Consumer.cs').dirty, false);
  const xml = host.context().records.find(record => record.path.endsWith('.csproj')).text;
  assert.match(xml, /Include="Beta.cs"/);
  assert.match(xml, /Include="Consumer.cs"/);
  await host.commands.undo();
  assert(host.documents.models.has('App/Alpha.cs'));
  assert(host.documents.models.has('App/Use.cs'));
  host.dispose();
});

test('invalid versions, before text, result text, overlapping edits and destination collisions leave all owners unchanged', async () => {
  const modifications = [
    plan => ({ ...plan, changes: [{ ...plan.changes[0], version: undefined }] }),
    plan => ({ ...plan, changes: [{ ...plan.changes[0], before: 'stale' }] }),
    plan => ({ ...plan, changes: [{ ...plan.changes[0], text: 'incorrect result' }] }),
    plan => ({ ...plan, changes: [{ ...plan.changes[0], edits: [plan.changes[0].edits[0], plan.changes[0].edits[0]] }] }),
    plan => ({ ...plan, resources: [{ ...plan.resources[0], newUri: 'App/Use.cs' }] }),
    plan => ({ ...plan, resources: [{ ...plan.resources[0], newUri: 'App/Alpha.cs/Child.cs' }] }),
    plan => ({ ...plan, resources: [{ ...plan.resources[0], newUri: '../Escaped.cs' }] }),
    plan => ({ ...plan, resources: [{ ...plan.resources[0], kind: 'delete' }] })
  ];
  for (const modify of modifications) {
    const host = fixture();
    const original = host.documents.models.get('App/Alpha.cs');
    const source = original.snapshot();
    await assert.rejects(apply(host, modify(planFor(host))));
    assert.equal(host.documents.models.get('App/Alpha.cs'), original);
    assert.equal(original.snapshot(), source);
    assert.equal(host.commands.history.length, 0);
    assert.equal(host.documents.models.has('App/Beta.cs'), false);
    host.dispose();
  }
});

test('a model change during render fails the immediate precommit guard without overwriting the newer edit', async () => {
  const host = fixture();
  const original = host.documents.models.get('App/Alpha.cs');
  let changed = false;
  host.host.render = () => {
    if (!changed) {
      changed = true;
      original.applyEdits([{ start: 0, end: 0, text: '// newer\n' }]);
    }
  };
  await assert.rejects(apply(host), { code: 'SFEX_RESOURCE_CHANGED' });
  assert.equal(host.host.lastPrepared, undefined);
  assert.match(original.getText(), /^\/\/ newer/);
  assert.equal(host.documents.models.has('App/Beta.cs'), false);
  host.dispose();
});

test('async host preflight rechecks identities, affected locks, unrelated edits, saves, membership and workspace lifetime', async () => {
  const mutations = [
    host => host.documents.models.get('App/Alpha.cs').applyEdits([{ start: 0, end: 0, text: '// later\n' }]),
    host => host.documents.models.get('Unrelated.cs').applyEdits([{ start: 0, end: 0, text: '// later\n' }]),
    host => { host.documents.models.get('App/Alpha.cs').readOnly = true; },
    host => host.documents.markSaved('App/Alpha.cs', host.documents.captureSave('App/Alpha.cs')),
    host => host.documents.add({ uri: 'Added.cs', text: 'class Added {}' }),
    host => host.setContext({ identity: 'another workspace' }),
    host => {
      const model = host.documents.models.get('App/Alpha.cs');
      const replacement = new EditorModel(model.snapshot(), { uri: model.uri, version: model.version });
      const records = host.documents.files.map(record => record.uri === model.uri ? preparedExplorerModel(record, replacement) : record);
      host.documents.replace(records, { discard: true, preserveDirty: true });
    }
  ];
  for (const mutate of mutations) {
    const host = fixture();
    host.documents.models.get('App/Alpha.cs').applyEdits([{ start: 0, end: 0, text: '// dirty\n' }]);
    const commit = host.host.commit;
    let staged;
    host.host.commit = async prepared => {
      staged = prepared.records.filter(record => record.model && !host.documents.ownsModel(record.model)).map(record => record.model);
      await Promise.resolve();
      mutate(host);
      return commit(prepared);
    };
    await assert.rejects(apply(host), { code: 'SFEX_RESOURCE_CHANGED' });
    for (const model of staged) assert.throws(() => model.prepareEdits([]), /disposed/);
    assert.equal(host.documents.models.has('App/Beta.cs'), false);
    assert.equal(host.commands.history.length, 0);
    host.dispose();
  }
});

test('failed host preflight releases every staged model and preserves live source buffers', async () => {
  const host = fixture();
  const old = [...host.documents.models.values()];
  let staged;
  host.host.commit = async prepared => {
    staged = prepared.records.filter(record => record.model && !host.documents.ownsModel(record.model)).map(record => record.model);
    throw new Error('Project validation rejected the transaction');
  };
  await assert.rejects(apply(host), /Project validation rejected/);
  for (const model of staged) assert.throws(() => model.prepareEdits([]), /disposed/);
  for (const model of old) assert.doesNotThrow(() => model.prepareEdits([]));
  assert.equal(host.commands.history.length, 0);
  host.dispose();
});

test('postcommit callback failure retains all adopted resource models and a complete file-operation undo', async () => {
  const host = fixture();
  const unsubscribe = host.documents.subscribe(event => { if (event.type === 'reset') throw new Error('View update failed'); });
  await assert.rejects(apply(host), { committed: true });
  const renamed = host.documents.models.get('App/Beta.cs');
  assert(host.documents.ownsModel(renamed));
  assert.doesNotThrow(() => renamed.prepareEdits([]));
  assert.equal(host.commands.history.length, 1);
  assert.match(host.context().records.find(record => record.path.endsWith('.csproj')).text, /Include="Beta.cs"/);
  unsubscribe();
  await host.commands.undo();
  assert(host.documents.models.has('App/Alpha.cs'));
  host.dispose();
});

test('large resource source comparisons stay lazy and yield to cancellation before ownership changes', async () => {
  const host = fixture('\n/*' + 'x'.repeat(3 * 1024 * 1024) + '*/');
  const before = host.documents.models.get('App/Alpha.cs').snapshot();
  await apply(host);
  assert.equal(before.statistics.textMaterialized, false);
  assert.equal(host.documents.get('App/Beta.cs').source.statistics.textMaterialized, false);
  await host.commands.undo();
  const controller = new AbortController();
  const pending = apply(host, planFor(host), { signal: controller.signal });
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(pending, { code: 'SFEX_RESOURCE_CANCELLED' });
  assert(host.documents.models.has('App/Alpha.cs'));
  assert.equal(host.commands.history.length, 0);
  host.dispose();
});

test('the adapter copies supported plan fields before awaits and rejects native, locked and oversized resource requests', async () => {
  const host = fixture();
  const plan = structuredClone(planFor(host));
  const pending = apply(host, plan);
  plan.resources[0].newUri = 'Hijacked.cs';
  plan.changes[0].edits[0].text = 'Wrong';
  await pending;
  assert(host.documents.models.has('App/Beta.cs'));
  assert.equal(host.documents.models.has('Hijacked.cs'), false);
  await host.commands.undo();
  const current = planFor(host);
  await assert.rejects(apply(host, { ...current, resources: Array(129).fill(current.resources[0]) }), /bounded/);
  host.documents.models.get('App/Alpha.cs').readOnly = true;
  await assert.rejects(apply(host, current), { code: 'SFEX_RESOURCE_CHANGED' });
  host.documents.models.get('App/Alpha.cs').readOnly = false;
  host.setContext({ native: true });
  await assert.rejects(apply(host, current), { code: 'SFEX_RESOURCE_UNSUPPORTED' });
  host.dispose();
});
