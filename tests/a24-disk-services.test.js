import test from 'node:test';
import assert from 'node:assert/strict';
import {diskServiceFixture, diskBytes} from './support/a24-disk-services.js';

test('disk services search dirty overlays and closed files without hydrating editors, then restore the prior search callback', async t => {
  const previous = () => 'previous host search';
  const fixture = await diskServiceFixture({previousSearch: previous});
  t.after(() => fixture.dispose());
  const {disk, provider, data, service, view} = fixture;
  data.records = [{path: 'open.cs', text: 'dirty needle', version: 9}, data.records[1]];
  data.dirty = ['open.cs'];
  data.revision++;
  service.observe(data);
  const dirty = await disk.findInFiles('dirty', {paths: ['open.cs']});
  assert.equal(dirty.matches[0].version, 9);
  assert.equal(provider.reads, 0);
  const closed = await disk.findInFiles('needle', {paths: ['closed.cs']});
  assert.equal(closed.matches[0].start, 7);
  assert.equal(disk.record('closed.cs').lazy, true);
  assert.equal(provider.reads, 1);
  const opened = Promise.withResolvers();
  view.onOpen = opened.resolve;
  await service.searchPaths('closed');
  service.ui.results.querySelector('button').click();
  assert.deepEqual(await opened.promise, {path: 'closed.cs', kind: 'source'});
  service.dispose();
  assert.equal(disk.findInFiles, previous);
  assert.equal(view.search.listeners.get('input').size, 0);
});

test('XML reload forwards the complete snapshot and default version once when the host acknowledges evaluation', async t => {
  const fixture = await diskServiceFixture({records: [{path: 'App.csproj', text: '<Project/>'}]});
  t.after(() => fixture.dispose());
  await fixture.provider.writeFile('App.csproj', diskBytes('<Project><PropertyGroup/></Project>'));
  await fixture.service.onEvent({type: 'changed', path: 'App.csproj'});
  assert.deepEqual(fixture.commands.map(command => command.action), ['disk-external-change']);
  const {node, selected, payload} = fixture.commands[0];
  assert.deepEqual(node, {path: 'App.csproj'});
  assert.deepEqual(selected, []);
  assert.equal(payload.expectedVersion, 0);
  assert.equal(payload.record.text, '<Project><PropertyGroup/></Project>');
  assert.match(payload.record.hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(payload.event, {type: 'changed', path: 'App.csproj'});
});

test('closed-file changes adopt metadata without reading content', async t => {
  const fixture = await diskServiceFixture();
  t.after(() => fixture.dispose());
  await fixture.provider.writeFile('closed.cs', diskBytes('external closed contents'));
  await fixture.service.onEvent({type: 'changed', path: 'closed.cs'});
  assert.equal(fixture.provider.reads, 0);
  const payload = fixture.commands[0].payload;
  assert.equal(payload.record.lazy, true);
  assert.equal(payload.record.size, 24);
  assert.equal(payload.record.text, undefined);
});

for (const outcome of ['success', 'failure']) {
  test('a stale closed-file metadata ' + outcome + ' cannot affect a replacement workspace', async t => {
    const fixture = await diskServiceFixture();
    const replacement = await diskServiceFixture();
    t.after(() => { fixture.dispose(); replacement.dispose(); });
    const gate = fixture.provider.pauseMetadata('closed.cs', 1);
    const pending = fixture.service.run(() => fixture.service.onEvent({type: 'changed', path: 'closed.cs'}));
    await gate.entered;
    fixture.service.observe(replacement.data);
    await fixture.service.opening;
    if (outcome === 'success') gate.release();
    else gate.reject(new Error('Old directory no longer available'));
    await pending;
    assert.equal(fixture.commands.length, 0);
    assert.equal(fixture.errors.length, 0);
    assert.equal(fixture.service.disk, replacement.disk);
    assert.equal(replacement.disk.record('closed.cs').lazy, true);
  });
}

test('a local revision during metadata loading requeues the event and prompts for the newly dirty editor', async t => {
  const fixture = await diskServiceFixture();
  t.after(() => fixture.dispose());
  const gate = fixture.provider.pauseMetadata('closed.cs', 1);
  const pending = fixture.service.onEvent({type: 'changed', path: 'closed.cs'});
  await gate.entered;
  fixture.data.records = [fixture.data.records[0], {path: 'closed.cs', text: 'unsaved text', version: 8}];
  fixture.data.dirty = ['closed.cs'];
  fixture.data.revision++;
  fixture.service.observe(fixture.data);
  gate.release();
  await pending;
  assert.equal(fixture.commands.length, 0);
  assert.equal(fixture.service.coalescer.pending.size, 1);
  fixture.service.coalescer.flush();
  await fixture.service.queue;
  assert.equal(fixture.service.reload.pending.get('closed.cs').localText, 'unsaved text');
  assert.equal(fixture.commands.length, 0);
  const compared = await fixture.service.choose('closed.cs', 'compare');
  assert.equal(compared.localText, 'unsaved text');
  assert.equal(compared.diskText, 'closed needle');
  await fixture.service.choose('closed.cs', 'keep');
  assert.equal(fixture.service.reload.pending.size, 0);
});

test('queued watch changes wait until the workspace transaction releases its busy flag', async t => {
  const fixture = await diskServiceFixture();
  t.after(() => fixture.dispose());
  const observed = Promise.withResolvers();
  fixture.data.fileBusy = true;
  fixture.view.getData = () => { if (fixture.data.fileBusy) observed.resolve(); return fixture.data; };
  await fixture.provider.writeFile('open.cs', diskBytes('external update'));
  fixture.service.coalescer.push({type: 'changed', path: 'open.cs'});
  fixture.service.coalescer.flush();
  await observed.promise;
  assert.equal(fixture.commands.length, 0);
  fixture.data.fileBusy = false;
  await fixture.service.queue;
  assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.commands[0].payload.record.text, 'external update');
});

test('a transaction starting during a closed-file status read defers publication until its busy flag clears', async t => {
  const fixture = await diskServiceFixture();
  t.after(() => fixture.dispose());
  const gate = fixture.provider.pauseMetadata('closed.cs', 1);
  const pending = fixture.service.onEvent({type: 'changed', path: 'closed.cs'});
  await gate.entered;
  fixture.data.fileBusy = true;
  gate.release();
  await pending;
  assert.equal(fixture.commands.length, 0);
  assert.equal(fixture.service.coalescer.pending.size, 1);
  fixture.data.fileBusy = false;
  fixture.service.coalescer.flush();
  await fixture.service.queue;
  assert.equal(fixture.commands.length, 1);
});

test('a delayed watch setup is disposed after the view closes and native mode can attach the same disk later', async t => {
  const fixture = await diskServiceFixture({watchGate: true});
  t.after(() => fixture.dispose());
  await fixture.gate.entered;
  fixture.service.dispose();
  fixture.gate.release();
  await fixture.service.opening;
  assert.equal(fixture.provider.subscriptions[0].disposed, true);
  assert.equal(fixture.service.ui.root.parentNode, null);
  assert.equal(fixture.disk.findInFiles, undefined);
  const next = await diskServiceFixture();
  t.after(() => next.dispose());
  next.data.native = true;
  next.service.observe(next.data);
  assert.equal(next.disk.findInFiles, undefined);
  next.data.native = false;
  next.service.observe(next.data);
  await next.service.indexReady;
  await next.service.opening;
  assert.equal(typeof next.disk.findInFiles, 'function');
  assert.equal(next.provider.subscriptions.at(-1).disposed, false);
});

test('workspace replacement aborts an in-flight content search even with a separate caller signal', async t => {
  const fixture = await diskServiceFixture();
  const replacement = await diskServiceFixture();
  t.after(() => { fixture.dispose(); replacement.dispose(); });
  const caller = new AbortController();
  const gate = fixture.provider.pause('read', 'closed.cs');
  const pending = fixture.disk.findInFiles('needle', {paths: ['closed.cs'], signal: caller.signal});
  const rejected = assert.rejects(pending, error => error.name === 'AbortError');
  await gate.entered;
  fixture.service.observe(replacement.data);
  gate.release();
  await rejected;
  assert.equal(caller.signal.aborted, false);
});
