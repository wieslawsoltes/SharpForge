import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentEvents } from '../apps/studio/services/documents.js';

test('lazy document notifications leave source unread when consumers only need identity or reset', () => {
  const documents = createDocumentEvents();
  let reads = 0;
  const source = () => { reads++; throw new Error('Source must remain unread'); };
  documents.publishSource('unobserved.cs', source);
  const observed = [];
  const unsubscribe = documents.subscribe(event => observed.push(event.type ?? event.uri));
  documents.publishSource('changed.cs', source);
  documents.reset();
  unsubscribe();
  documents.publishSource('unsubscribed.cs', source);
  documents.dispose();
  documents.publishSource('disposed.cs', source);
  assert.equal(reads, 0);
  assert.deepEqual(observed, ['changed.cs', 'reset']);
});

test('lazy document text uses a single frozen event and one snapshot read across subscribers', () => {
  const documents = createDocumentEvents();
  let reads = 0;
  let first;
  let second;
  documents.subscribe(event => { first = event; assert.equal(reads, 0); });
  documents.subscribe(event => {
    second = event;
    assert.equal(event.text, 'committed source');
    assert.equal(event.text, 'committed source');
  });
  documents.publishSource('active.cs', () => { reads++; return 'committed source'; });
  assert.equal(first, second);
  assert.equal(reads, 1);
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(Object.keys(first), ['uri', 'text']);
  assert.throws(() => { first.text = 'changed source'; }, TypeError);
  assert.deepEqual({ ...first }, { uri: 'active.cs', text: 'committed source' });
  assert.equal(reads, 1);
  documents.dispose();
});

test('URI-filtered subscribers do not materialize unrelated documents and may retain immutable snapshots', () => {
  const documents = createDocumentEvents();
  let revision = Object.freeze({ text: 'first revision' });
  let reads = 0;
  let retained;
  documents.subscribe(event => { if (event.uri === 'active.cs') retained = event; });
  documents.publishSource('other.cs', () => { throw new Error('Unrelated source must remain unread'); });
  const snapshot = revision;
  documents.publishSource('active.cs', () => { reads++; return snapshot.text; });
  revision = Object.freeze({ text: 'second revision' });
  assert.equal(reads, 0);
  documents.dispose();
  assert.equal(retained.text, 'first revision');
  assert.equal(retained.text, 'first revision');
  assert.equal(revision.text, 'second revision');
  assert.equal(reads, 1);
});

test('lazy document readers retain their exact failure, including falsy throws, without retrying', () => {
  for (const failure of [new Error('Source failure'), false, 0, null, undefined]) {
    const documents = createDocumentEvents();
    let reads = 0;
    let retained;
    documents.subscribe(event => { retained = event; });
    documents.publishSource('failed.cs', () => { reads++; throw failure; });
    for (let attempt = 0; attempt < 2; attempt++) {
      let failed = false;
      try { void retained.text; }
      catch (error) { failed = true; assert.equal(error, failure); }
      assert.equal(failed, true);
    }
    assert.equal(reads, 1);
    documents.dispose();
  }
});

test('eager notifications, removals, reset and subscription errors retain their existing contract', () => {
  const documents = createDocumentEvents();
  const observed = [];
  documents.subscribe(event => observed.push(event));
  documents.publish('source.cs', 'source');
  documents.publish('removed.cs', undefined);
  documents.reset();
  assert.deepEqual(observed, [{ uri: 'source.cs', text: 'source' }, { uri: 'removed.cs', text: undefined }, { type: 'reset' }]);
  for (const event of observed) assert.equal(Object.isFrozen(event), true);
  assert.throws(() => documents.publishSource('source.cs', null), TypeError);
  documents.subscribe(() => { throw false; });
  let failed = false;
  try { documents.publish('source.cs', 'changed'); }
  catch (error) { failed = true; assert.equal(error, false); }
  assert.equal(failed, true);
  documents.dispose();
  assert.throws(() => documents.subscribe(() => {}), /disposed/);
});
