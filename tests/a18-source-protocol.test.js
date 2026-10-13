import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignSyncProtocol, DesignSyncState} from '@sharpforge/designer';

const design = content => ({
  version: 1, name: 'View', width: 800, height: 600, root: 'root',
  nodes: [{id: 'root', type: 'Button', properties: {Content: content}, children: [], events: {}}],
  styles: {}, templates: {},
});
const protocol = options => new DesignSyncProtocol({
  workspaceId: 'workspace-a', uri: 'View.cs', sourceText: 'source-a', sourceVersion: 7,
  document: design('a'), designRevision: 3, generation: 2, ...options,
});
const throwsCode = (callback, code) => assert.throws(callback, error => error.code === code);

class TrackedSignal {
  aborted = false;
  listeners = new Set();
  addEventListener(type, listener) {
    assert.equal(type, 'abort');
    this.listeners.add(listener);
  }
  removeEventListener(type, listener) {
    assert.equal(type, 'abort');
    this.listeners.delete(listener);
  }
  abort() {
    this.aborted = true;
    for (const listener of [...this.listeners]) listener();
  }
}

test('protocol states and JSON tokens are explicit stable contracts', () => {
  assert.deepEqual(Object.values(DesignSyncState), ['synced', 'source-dirty', 'design-dirty', 'conflict', 'blocked', 'missing']);
  assert(Object.isFrozen(DesignSyncState));
  const sync = protocol();
  assert.equal(sync.state, DesignSyncState.Synced);
  const token = sync.begin('source');
  assert(Object.isFrozen(token));
  assert.deepEqual(JSON.parse(JSON.stringify(token)), {
    protocolVersion: 1, id: 1, kind: 'source', resolution: null, workspaceId: 'workspace-a', uri: 'View.cs',
    generation: 2, sourceVersion: 7, sourceRevision: 0, designRevision: 3,
  });
  assert.equal(sync.isCurrent(JSON.parse(JSON.stringify(token))), true);
});

test('source analysis updates only an accepted valid preview and returns editor-owned history receipts', () => {
  const sync = protocol();
  sync.sourceChanged('source-b', {sourceVersion: 8});
  const token = sync.begin('source');
  assert.equal(sync.state, DesignSyncState.SourceDirty);
  assert.deepEqual(sync.document, design('a'));
  assert.deepEqual(sync.lastValidPreview, design('a'));
  const receipt = sync.accept(JSON.parse(JSON.stringify(token)), {document: design('b'), preview: {scene: 'b'}});
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.before.state, DesignSyncState.SourceDirty);
  assert.deepEqual(receipt.before.document, design('a'));
  assert.equal(receipt.after.state, DesignSyncState.Synced);
  assert.deepEqual(sync.document, design('b'));
  assert.deepEqual(sync.lastValidPreview, {scene: 'b'});
  assert.equal(sync.source.text, 'source-b');
  assert.equal(sync.source.version, 8);
  assert.equal(sync.snapshot().designRevision, 4);
  assert.equal(sync.snapshot().pending.length, 0);
  assert.equal(sync.isCurrent(token), false);
});

test('design write adopts the compiled source and keeps before/after alternatives available to the editor', () => {
  const sync = protocol();
  sync.designChanged(design('b'), {designRevision: 4});
  const token = sync.begin('design');
  assert.equal(sync.state, DesignSyncState.DesignDirty);
  assert.deepEqual(sync.lastValidPreview, design('a'));
  const receipt = sync.accept(token, {document: design('b'), text: 'source-b', sourceVersion: 8});
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.before.source.text, 'source-a');
  assert.deepEqual(receipt.before.document, design('b'));
  assert.equal(receipt.after.source.text, 'source-b');
  assert.equal(sync.state, DesignSyncState.Synced);
  assert.deepEqual(sync.lastValidPreview, design('b'));
  assert.equal(sync.snapshot().designRevision, 4);
});

test('incomplete source and parser errors preserve the last accepted baseline and preview', () => {
  const sync = protocol();
  const baseline = sync.snapshot().baseline;
  sync.sourceChanged('class View {');
  const result = sync.reject(sync.begin('source'), {code: 'SFSYNC_PARSE', message: 'Expected closing brace.'});
  assert.equal(result.reason, 'blocked');
  assert.equal(sync.state, DesignSyncState.Blocked);
  assert.equal(sync.source.text, 'class View {');
  assert.deepEqual(sync.snapshot().baseline, baseline);
  assert.deepEqual(sync.lastValidPreview, design('a'));
  sync.sourceChanged('source-b');
  assert.equal(sync.state, DesignSyncState.SourceDirty);
  assert.equal(sync.snapshot().diagnostic, null);
  assert.equal(sync.accept(sync.begin('source'), {document: design('b')}).accepted, true);
});

test('a stale analysis cannot replace a newer source revision or its valid preview', () => {
  const sync = protocol();
  sync.sourceChanged('source-b');
  const stale = sync.begin('source');
  sync.sourceChanged('source-c');
  const latest = sync.begin('source');
  assert.equal(sync.accept(latest, {document: design('c')}).accepted, true);
  const before = sync.snapshot();
  assert.equal(sync.accept(stale, {document: design('b')}).reason, 'stale');
  assert.deepEqual(sync.snapshot(), before);
});

test('a stale error cannot overwrite newer validation diagnostics', () => {
  const sync = protocol();
  sync.sourceChanged('source-b');
  const stale = sync.begin('source');
  sync.sourceChanged('source-c');
  sync.reject(sync.begin('source'), {code: 'CURRENT_ERROR', message: 'Current error.'});
  const before = sync.snapshot();
  assert.equal(sync.reject(stale, {code: 'OLD_ERROR', message: 'Old error.'}).accepted, false);
  assert.deepEqual(sync.snapshot(), before);
});

test('a source edit during design validation retains both staged alternatives', () => {
  const sync = protocol();
  sync.designChanged(design('designer'));
  const pending = sync.begin('design');
  sync.sourceChanged('source-user');
  const before = sync.snapshot();
  assert.equal(sync.state, DesignSyncState.Conflict);
  assert.equal(sync.accept(pending, {text: 'source-designer', document: design('designer')}).accepted, false);
  assert.deepEqual(sync.snapshot(), before);
  assert.equal(sync.source.text, 'source-user');
  assert.deepEqual(sync.document, design('designer'));
  assert.deepEqual(sync.lastValidPreview, design('a'));
});

test('a design edit during source analysis invalidates its token without replacing the new design', () => {
  const sync = protocol();
  sync.sourceChanged('source-b');
  const pending = sync.begin('source');
  sync.designChanged(design('designer'));
  assert.equal(sync.state, DesignSyncState.Conflict);
  assert.equal(sync.accept(pending, {document: design('b')}).accepted, false);
  assert.deepEqual(sync.document, design('designer'));
  assert.deepEqual(sync.lastValidPreview, design('a'));
});

for (const resolution of ['source', 'design']) {
  test(`explicit ${resolution} conflict resolution returns the discarded alternative to editor history`, () => {
    const sync = protocol();
    sync.sourceChanged('source-user');
    sync.designChanged(design('designer'));
    throwsCode(() => sync.begin('source'), 'SFSYNC_CONFLICT');
    throwsCode(() => sync.begin('design'), 'SFSYNC_CONFLICT');
    assert.equal(sync.state, DesignSyncState.Conflict);
    const token = sync.begin(resolution, {resolution});
    const payload = resolution === 'source'
      ? {document: design('user')}
      : {document: design('designer'), text: 'source-designer'};
    const receipt = sync.accept(token, payload);
    assert.equal(receipt.accepted, true);
    assert.equal(receipt.before.source.text, 'source-user');
    assert.deepEqual(receipt.before.document, design('designer'));
    assert.equal(sync.state, DesignSyncState.Synced);
    assert.equal(sync.source.text, resolution === 'source' ? 'source-user' : 'source-designer');
  });
}

test('rejecting explicit conflict resolution keeps conflict state and both alternatives', () => {
  const sync = protocol();
  sync.sourceChanged('source-user');
  sync.designChanged(design('designer'));
  sync.reject(sync.begin('source', {resolution: 'source'}), {code: 'PARSE', message: 'Source is invalid.'});
  assert.equal(sync.state, DesignSyncState.Conflict);
  assert.equal(sync.snapshot().diagnostic.code, 'PARSE');
  assert.equal(sync.source.text, 'source-user');
  assert.deepEqual(sync.document, design('designer'));
});

test('source undo/redo detects ABA even when source text returns to the same bytes', () => {
  const sync = protocol();
  const stale = sync.begin('source');
  sync.sourceChanged('source-b', {sourceVersion: 8});
  sync.sourceChanged('source-a', {sourceVersion: 9, origin: 'undo'});
  assert.equal(sync.state, DesignSyncState.Synced);
  assert.equal(sync.snapshot().origin, 'undo');
  assert.equal(sync.isCurrent(stale), false);
  assert.equal(sync.accept(stale, {document: design('old')}).accepted, false);
  sync.sourceChanged('source-b', {sourceVersion: 10, origin: 'redo'});
  assert.equal(sync.state, DesignSyncState.SourceDirty);
  assert.equal(sync.snapshot().origin, 'redo');
});

test('design undo/redo preserves the accepted preview and invalidates optimistic writes', () => {
  const sync = protocol();
  sync.designChanged(design('b'), {designRevision: 4});
  const stale = sync.begin('design');
  sync.designChanged(design('a'), {designRevision: 5, origin: 'undo'});
  assert.equal(sync.state, DesignSyncState.Synced);
  assert.equal(sync.isCurrent(stale), false);
  sync.designChanged(design('b'), {designRevision: 6, origin: 'redo'});
  assert.equal(sync.state, DesignSyncState.DesignDirty);
  assert.deepEqual(sync.lastValidPreview, design('a'));
  assert.equal(sync.accept(stale, {text: 'source-b', document: design('b')}).accepted, false);
});

test('external branch replacement invalidates equal text/version and retains a staged design', () => {
  const sync = protocol();
  sync.designChanged(design('designer'));
  const stale = sync.begin('design');
  sync.replaceSource('source-a', {sourceVersion: 7});
  assert.equal(sync.source.generation, 3);
  assert.equal(sync.state, DesignSyncState.Conflict);
  assert.deepEqual(sync.document, design('designer'));
  assert.equal(sync.accept(stale, {text: 'source-b', document: design('b')}).accepted, false);
  assert.equal(sync.source.text, 'source-a');
});

test('workspace/file replacement resets external version while retaining a recoverable old baseline', () => {
  const sync = protocol();
  const stale = sync.begin('source');
  sync.replaceSource('new-file', {workspaceId: 'workspace-b', uri: 'Other.cs', sourceVersion: 0});
  assert.equal(sync.state, DesignSyncState.SourceDirty);
  assert.equal(sync.source.workspaceId, 'workspace-b');
  assert.equal(sync.source.uri, 'Other.cs');
  assert.equal(sync.source.version, 0);
  assert.equal(sync.snapshot().baseline.workspaceId, 'workspace-a');
  assert.equal(sync.isCurrent(stale), false);
  sync.accept(sync.begin('source'), {document: design('new')});
  assert.equal(sync.snapshot().baseline.workspaceId, 'workspace-b');
});

test('missing source retains recoverable data, blocks new work and requires a fresh generation', () => {
  const sync = protocol();
  sync.designChanged(design('designer'));
  const token = sync.begin('design');
  sync.markMissing();
  assert.equal(sync.state, DesignSyncState.Missing);
  assert.equal(sync.source.missing, true);
  assert.equal(sync.source.text, 'source-a');
  assert.deepEqual(sync.document, design('designer'));
  assert.deepEqual(sync.lastValidPreview, design('a'));
  throwsCode(() => sync.begin('source'), 'SFSYNC_MISSING');
  assert.equal(sync.accept(token, {document: design('b'), text: 'source-b'}).accepted, false);
  sync.replaceSource('source-restored');
  assert.equal(sync.source.missing, false);
  assert.equal(sync.state, DesignSyncState.Conflict);
});

test('cancellation detaches listeners and prevents late accept/reject without changing dirty state', () => {
  const sync = protocol();
  sync.sourceChanged('source-b');
  const signal = new TrackedSignal();
  const token = sync.begin('source', {signal});
  assert.equal(signal.listeners.size, 1);
  signal.abort();
  assert.equal(signal.listeners.size, 0);
  assert.equal(sync.snapshot().pending.length, 0);
  const before = sync.snapshot();
  assert.equal(sync.accept(token, {document: design('b')}).accepted, false);
  assert.equal(sync.reject(token, {message: 'Late error.'}).accepted, false);
  assert.deepEqual(sync.snapshot(), before);
  assert.equal(sync.state, DesignSyncState.SourceDirty);
});

test('explicit cancellation affects only its own transaction and leaves peer work current', () => {
  const sync = protocol();
  const cancelled = sync.begin('source');
  const retained = sync.begin('source');
  assert.equal(sync.cancel(cancelled).reason, 'cancelled');
  assert.equal(sync.isCurrent(cancelled), false);
  assert.equal(sync.isCurrent(retained), true);
  assert.equal(sync.accept(retained, {document: design('a')}).accepted, true);
});

test('pre-cancelled signals never reserve transactions and disposal is idempotent', () => {
  const sync = protocol();
  const aborted = new AbortController();
  aborted.abort();
  throwsCode(() => sync.begin('source', {signal: aborted.signal}), 'SFSYNC_CANCELLED');
  const signal = new TrackedSignal();
  const token = sync.begin('source', {signal});
  assert.equal(sync.dispose(), true);
  assert.equal(sync.dispose(), false);
  assert.equal(signal.listeners.size, 0);
  assert.equal(sync.disposed, true);
  assert.equal(sync.snapshot().pending.length, 0);
  assert.deepEqual(sync.document, design('a'));
  assert.deepEqual(sync.lastValidPreview, design('a'));
  assert.equal(sync.accept(token, {document: design('b')}).reason, 'disposed');
  assert.equal(sync.reject(token).reason, 'disposed');
  throwsCode(() => sync.begin('source'), 'SFSYNC_DISPOSED');
  throwsCode(() => sync.sourceChanged('b'), 'SFSYNC_DISPOSED');
  throwsCode(() => sync.designChanged(design('b')), 'SFSYNC_DISPOSED');
  throwsCode(() => sync.replaceSource('b'), 'SFSYNC_DISPOSED');
  throwsCode(() => sync.markMissing(), 'SFSYNC_DISPOSED');
});

test('new edits and successful acceptance release every obsolete cancellation subscription', () => {
  const sync = protocol();
  const sourceSignal = new TrackedSignal();
  sync.begin('source', {signal: sourceSignal});
  sync.sourceChanged('source-b');
  assert.equal(sourceSignal.listeners.size, 0);
  const designSignal = new TrackedSignal();
  const current = sync.begin('source', {signal: designSignal});
  sync.accept(current, {document: design('b')});
  assert.equal(designSignal.listeners.size, 0);
});

test('pending work is bounded and rapid edits release capacity deterministically', () => {
  const sync = protocol({maxPending: 2});
  sync.begin('source');
  sync.begin('source');
  throwsCode(() => sync.begin('source'), 'SFSYNC_LIMIT');
  for (let index = 0; index < 100; index++) {
    sync.sourceChanged(`source-${index}`);
    sync.begin('source');
    assert.equal(sync.snapshot().pending.length, 1);
  }
  assert.equal(sync.source.text, 'source-99');
  assert.deepEqual(sync.lastValidPreview, design('a'));
});

test('revision regressions and equal-version content changes fail atomically', () => {
  const sync = protocol();
  const before = sync.snapshot();
  throwsCode(() => sync.sourceChanged('source-b', {sourceVersion: 7}), 'SFSYNC_STALE');
  throwsCode(() => sync.sourceChanged('source-a', {sourceVersion: 6}), 'SFSYNC_STALE');
  throwsCode(() => sync.designChanged(design('b'), {designRevision: 3}), 'SFSYNC_STALE');
  throwsCode(() => sync.designChanged(design('a'), {designRevision: 2}), 'SFSYNC_STALE');
  throwsCode(() => sync.replaceSource('b', {workspaceId: ''}), 'SFSYNC_ARGUMENT');
  assert.deepEqual(sync.snapshot(), before);
});

test('canonical design comparison ignores object key order while new revision numbers still invalidate tokens', () => {
  const sync = protocol();
  const reordered = Object.fromEntries(Object.entries(design('a')).reverse());
  assert.deepEqual(sync.designChanged(reordered), {changed: false, state: DesignSyncState.Synced});
  const token = sync.begin('source');
  sync.designChanged(reordered, {designRevision: 4});
  assert.equal(sync.state, DesignSyncState.Synced);
  assert.equal(sync.isCurrent(token), false);
  const nextToken = sync.begin('source');
  sync.sourceChanged('source-a', {sourceVersion: 8});
  assert.equal(sync.state, DesignSyncState.Synced);
  assert.equal(sync.isCurrent(nextToken), false);
});

test('foreign, forged and completed tokens cannot mutate or consume current transactions', () => {
  const sync = protocol();
  const token = sync.begin('source');
  const other = protocol({workspaceId: 'foreign'}).begin('source');
  for (const forged of [null, other, {...token, kind: 'design'}, {...token, resolution: 'source'}, {...token, protocolVersion: 2}]) {
    assert.equal(sync.isCurrent(forged), false);
    assert.equal(sync.accept(forged, {document: design('b')}).accepted, false);
    assert.equal(sync.isCurrent(token), true);
  }
  assert.equal(sync.accept(token, {document: design('a')}).accepted, true);
  assert.equal(sync.accept(token, {document: design('b')}).accepted, false);
});

test('all input and output data is detached from protocol ownership', () => {
  const input = design('a');
  const sync = protocol({document: input});
  input.nodes[0].properties.Content = 'mutated input';
  const snapshot = sync.snapshot();
  snapshot.document.nodes[0].properties.Content = 'mutated snapshot';
  snapshot.baseline.document.nodes[0].properties.Content = 'mutated baseline';
  snapshot.lastValidPreview.nodes[0].properties.Content = 'mutated preview';
  snapshot.source.text = 'mutated source';
  assert.deepEqual(sync.document, design('a'));
  assert.deepEqual(sync.lastValidPreview, design('a'));
  assert.equal(sync.source.text, 'source-a');
});

test('validation failures never promote an invalid preview, while warning-only candidates may commit', () => {
  for (const failure of [{valid: false}, {success: false}, {diagnostics: [{severity: 'error', code: 'BAD', message: 'Invalid.'}]}]) {
    const sync = protocol();
    sync.sourceChanged('source-b');
    assert.equal(sync.accept(sync.begin('source'), {document: design('b'), ...failure}).accepted, false);
    assert.equal(sync.state, DesignSyncState.Blocked);
    assert.deepEqual(sync.lastValidPreview, design('a'));
  }
  const sync = protocol();
  sync.sourceChanged('source-b');
  const result = sync.accept(sync.begin('source'), {
    document: design('b'), diagnostics: [{severity: 'warning', code: 'PROTECTED', message: 'User expression retained.'}],
  });
  assert.equal(result.accepted, true);
  assert.deepEqual(sync.lastValidPreview, design('b'));
});

test('malformed accepted payloads fail atomically and leave the current transaction rejectable', () => {
  const sync = protocol();
  const token = sync.begin('source');
  const before = sync.snapshot();
  throwsCode(() => sync.accept(token, {document: design('b'), text: 'rewritten'}), 'SFSYNC_ARGUMENT');
  throwsCode(() => sync.accept(token, {document: design('b'), sourceVersion: 8}), 'SFSYNC_STALE');
  throwsCode(() => sync.accept(token, {document: null}), 'SFSYNC_DATA');
  assert.deepEqual(sync.snapshot(), before);
  assert.equal(sync.isCurrent(token), true);
  sync.cancel(token);
  const write = sync.begin('design');
  throwsCode(() => sync.accept(write, {document: design('b')}), 'SFSYNC_ARGUMENT');
  throwsCode(() => sync.accept(write, {text: 'b', document: design('b'), sourceVersion: 7}), 'SFSYNC_STALE');
});

test('source and data limits, nesting, cycles and accessor rejection retain staged alternatives', () => {
  const sync = protocol({maxSourceLength: 8, maxDataLength: 1000});
  const before = sync.snapshot();
  throwsCode(() => sync.sourceChanged('123456789'), 'SFSYNC_LIMIT');
  throwsCode(() => sync.designChanged({text: 'x'.repeat(1001)}), 'SFSYNC_LIMIT');
  const cyclic = {};
  cyclic.self = cyclic;
  throwsCode(() => sync.designChanged(cyclic), 'SFSYNC_DATA');
  let nested = {};
  for (let index = 0; index < 102; index++) nested = {child: nested};
  throwsCode(() => sync.designChanged(nested), 'SFSYNC_LIMIT');
  const accessor = Object.defineProperty({}, 'value', {enumerable: true, get() { throw new Error('Getter must not execute'); }});
  throwsCode(() => sync.designChanged(accessor), 'SFSYNC_DATA');
  for (const invalid of [undefined, () => {}, NaN, Infinity, new Date(), {toJSON() { throw new Error('Must not execute'); }}]) {
    throwsCode(() => sync.designChanged(invalid), 'SFSYNC_DATA');
  }
  assert.deepEqual(sync.snapshot(), before);
  assert.equal(sync.sourceChanged('12345678').changed, true);
});

test('revision and generation exhaustion reject atomically instead of silently losing token identity', () => {
  const source = protocol({sourceVersion: Number.MAX_SAFE_INTEGER});
  const beforeSource = source.snapshot();
  throwsCode(() => source.sourceChanged('b'), 'SFSYNC_ARGUMENT');
  assert.deepEqual(source.snapshot(), beforeSource);
  const view = protocol({designRevision: Number.MAX_SAFE_INTEGER});
  throwsCode(() => view.designChanged(design('b')), 'SFSYNC_ARGUMENT');
  assert.deepEqual(view.document, design('a'));
  const branch = protocol({generation: Number.MAX_SAFE_INTEGER});
  throwsCode(() => branch.replaceSource('b'), 'SFSYNC_ARGUMENT');
  throwsCode(() => branch.markMissing(), 'SFSYNC_ARGUMENT');
  assert.equal(branch.state, DesignSyncState.Synced);
});

test('a source without initial analysis starts dirty with no invented valid preview', () => {
  const sync = new DesignSyncProtocol({sourceText: 'source-a'});
  assert.equal(sync.state, DesignSyncState.SourceDirty);
  assert.equal(sync.lastValidPreview, null);
  assert.equal(sync.snapshot().baseline, null);
  sync.accept(sync.begin('source'), {document: design('a')});
  assert.equal(sync.state, DesignSyncState.Synced);
  assert.deepEqual(sync.lastValidPreview, design('a'));
});
