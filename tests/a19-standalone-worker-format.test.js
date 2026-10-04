import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createStandalone} from '../scripts/bundling/standalone.js';
import {standaloneScript} from '../scripts/conformance/security/csp.js';
import {inspectPolicy} from '../scripts/conformance/security/header-probe.js';
import {execute, fixture, html, workerGlobals} from './support/static-bundle.js';

test('packager binds classic format to lazily allocated closed worker URLs, including nested workers', async t => {
  const optionsSource = await readFile(new URL('../packages/editor/src/worker-options.js', import.meta.url), 'utf8');
  const root = await fixture(t, {
    'index.html': html, 'studio.css': '', 'worker-options.js': optionsSource,
    'studio.js': `import {workerOptions} from './worker-options.js';
      globalThis.launch = () => {
        const asset = new URL('./outer.js', import.meta.url);
        const worker = new Worker(asset, workerOptions(asset, {name:'outer'}));
        return {asset, worker};
      };
      globalThis.borrow = asset => new Worker(new URL(asset), workerOptions(new URL(asset)));`,
    'outer.js': `import {workerOptions} from './worker-options.js';
      self.postMessage('ready');
      self.launch = () => {
        const asset = new URL('./inner.js', import.meta.url);
        return new Worker(asset, workerOptions(asset));
      };`,
    'inner.js': `self.onmessage = event => self.postMessage(event.data + 1);`
  });
  const result = await createStandalone(root), host = workerGlobals();
  assert.equal(result.workers, 2);
  assert.equal(inspectPolicy(result.html, {standalone: true}).passed, true);
  const scope = execute(standaloneScript(result.html), host.globals);
  assert.equal(host.blobs.size, 0, 'cold worker bytes have no allocated Blob URL');
  const {asset} = scope.launch();
  assert.equal(asset.workerType, 'classic');
  assert.deepEqual(Object.getOwnPropertyDescriptor(asset, 'workerType'),
    {value: 'classic', writable: false, enumerable: false, configurable: false});
  assert.equal(host.workers[0].options.type, 'classic');
  assert.equal(host.workers[0].options.name, 'outer');
  scope.borrow(asset);
  assert.equal(host.workers[1].options.type, 'module', 'a copied URL is an ordinary externally supplied asset');
  const replies = [], nested = workerGlobals();
  const outer = execute(await host.blobs.get(String(asset)).text(), {...nested.globals, postMessage: value => replies.push(value)});
  assert.deepEqual(replies, ['ready']);
  outer.launch();
  assert.equal(nested.workers[0].options.type, 'classic');
  const inner = execute(await nested.blobs.get(nested.workers[0].url).text(), {postMessage: value => replies.push(value)});
  inner.onmessage({data: 41});
  assert.deepEqual(replies, ['ready', 42]);
  host.events.get('pagehide')({persisted: true});
  assert.equal(host.revoked.length, 0);
  host.events.get('pagehide')({persisted: false});
  assert.deepEqual(host.revoked, [String(asset)]);
});
