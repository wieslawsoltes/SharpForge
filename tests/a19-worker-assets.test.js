import test from 'node:test';
import assert from 'node:assert/strict';
import {workerOptions} from '@sharpforge/editor';
import {WorkerClient} from '../apps/studio/workbench/worker-client.js';
import {workerFailure} from '../apps/studio/workbench/worker-failure.js';
import {fakeWorkers} from './a19-session-fixtures.js';

function embedded(href = 'blob:null/closed-bundle') {
  return Object.defineProperty(new URL(href), 'workerType', {value: 'classic'});
}

test('closed embedded assets declare classic format; borrowed strings and normal URLs remain ESM', () => {
  const asset = embedded();
  const supplied = {name: 'compiler:project', credentials: 'same-origin'};
  assert.deepEqual(workerOptions(asset, supplied), {...supplied, type: 'classic'});
  assert.deepEqual(supplied, {name: 'compiler:project', credentials: 'same-origin'});
  for (const url of [String(asset), new URL(asset), 'blob:https://local.test/borrowed',
    new URL('https://other.test/unbundled.js'), 'file:///unbundled.js', './compiler.worker.js']) {
    assert.equal(workerOptions(url).type, 'module');
  }
  assert.equal(workerOptions('borrowed.js', {type: 'classic'}).type, 'classic', 'an explicit host declaration is respected');
  assert.throws(() => { asset.workerType = 'module'; }, TypeError);
  assert.throws(() => workerOptions({workerType: 'invalid'}), /Worker format/);
  assert.throws(() => workerOptions('borrowed.js', {type: 'invalid'}), /Worker format/);
});

test('compiler and runtime clients pass declared format and URL identity through injected factories and restart', async t => {
  for (const kind of ['compiler', 'runtime']) {
    const fake = fakeWorkers(), asset = embedded('blob:null/' + kind);
    const client = new WorkerClient(asset, {kind, name: kind + ':owner', workerFactory: fake.factory});
    t.after(() => client.dispose());
    assert.equal(client.url, asset);
    assert.deepEqual(fake.workers[0].options, {name: kind + ':owner', type: 'classic'});
    const old = client.request(kind === 'compiler' ? 'build' : 'state');
    client.restart();
    await assert.rejects(old, {code: 'WORKER_RESTARTED'});
    assert.equal(fake.workers[0].terminated, true);
    assert.equal(fake.workers[1].options.type, 'classic');
    fake.workers[0].onerror({message: 'late failure'});
    assert.equal(client.failed, false);
  }
});

test('worker errors retain native cause, source coordinates, generation, and original opaque details', async t => {
  const fake = fakeWorkers(), cause = new Error('parse failure'), observed = [];
  const client = new WorkerClient(embedded(), {kind: 'compiler', workerFactory: fake.factory, onError: error => observed.push(error)});
  t.after(() => client.dispose());
  const pending = client.request('build');
  fake.workers[0].onerror({message: 'Cannot load worker', filename: 'blob:null/closed-bundle', lineno: 4, colno: 2, error: cause});
  const failure = await pending.catch(error => error);
  assert.equal(failure, observed[0]);
  assert.equal(failure.cause, cause);
  assert.equal(failure.worker.causeStack, cause.stack);
  assert.equal(failure.worker.originalMessage, 'Cannot load worker');
  assert.equal(failure.worker.line, 4);
  assert.equal(failure.worker.column, 2);
  assert.equal(failure.worker.type, 'classic');
  assert.equal(failure.worker.generation, 1);
  assert.equal((await client.request('build').catch(error => error)).cause, failure);
  const opaque = workerFailure({}, {url: embedded(), settings: {type: 'classic'}, generation: 3}, 'file:///bundle.html');
  assert.equal(opaque.message, 'Worker failed to initialize');
  assert.equal(opaque.worker.documentUrl, 'file:///bundle.html');
  assert.equal(opaque.worker.originalMessage, '');
  assert.equal(opaque.worker.causeStack, '');
  assert.equal(opaque.worker.line, null);
  assert.equal(opaque.cause, undefined, 'do not invent a cause when the browser withholds it');
});

test('synchronous Worker construction errors retain their cause and borrowed module attribution', () => {
  const cause = new DOMException('Cross-origin worker is unavailable', 'SecurityError'), errors = [];
  assert.throws(() => new WorkerClient('https://external.test/worker.js', {
    workerFactory() { throw cause; }, onError: error => errors.push(error)
  }), error => error.code === 'WORKER_FAILED' && error.cause === cause);
  assert.equal(errors[0].worker.type, 'module');
  assert.equal(errors[0].worker.url, 'https://external.test/worker.js');
  const bounded = workerFailure({message: 'x'.repeat(5000), error: {stack: 'x'.repeat(20_000)}},
    {url: 'worker.js', settings: {type: 'module'}, generation: 1}, 'http://127.0.0.1:3000/');
  assert.equal(bounded.worker.originalMessage.length, 4096);
  assert.equal(bounded.worker.causeStack.length, 16_384);
  assert.equal(bounded.worker.documentUrl, 'http://127.0.0.1:3000/');
});

test('worker metadata excludes URL capability queries, fragments, and credentials', () => {
  const cause = new Error('Could not load https://user:password@worker.test/entry.js?key=hidden#private');
  const diagnostic = workerFailure({filename: 'https://user:password@worker.test/entry.js?key=hidden#private',
    message: cause.message, error: cause}, {
    url: 'https://user:password@worker.test/entry.js?token=hidden#private',
    settings: {type: 'module'}, generation: 1
  }, 'http://user:password@127.0.0.1:3000/app?native=hidden#private');
  assert.equal(diagnostic.worker.url, 'https://worker.test/entry.js');
  assert.equal(diagnostic.worker.filename, 'https://worker.test/entry.js');
  assert.equal(diagnostic.worker.documentUrl, 'http://127.0.0.1:3000/app');
  assert.doesNotMatch(JSON.stringify(diagnostic.worker), /password|hidden|private|user:/);
  assert.equal(diagnostic.cause, cause, 'native cause stays available in memory without rewriting another owner\'s error');
  assert.equal(workerFailure({}, {url: 'relative.js?token=hidden#private', settings: {type: 'module'}}).worker.url, 'relative.js');
});
