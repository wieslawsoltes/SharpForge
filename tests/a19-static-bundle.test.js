import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { bundleWorker } from '../scripts/bundle-worker.js';
import { createStandalone } from '../scripts/bundling/standalone.js';
import { moduleSyntax } from '../scripts/bundling/module-syntax.js';
import { dynamicCodeUses } from '../scripts/conformance/static/code-tokens.js';
import { standaloneScript } from '../scripts/conformance/security/csp.js';
import { inspectPolicy } from '../scripts/conformance/security/header-probe.js';
import { execute, fixture, html, workerGlobals } from './support/static-bundle.js';

test('static named/re-export graph initializes dependencies first and lazy graph stays cold until one microtask', async t => {
  const root = await fixture(t, {
    'entry.js': `import {answer as base} from './core.js';
      globalThis.value = base; globalThis.load = () => import('./lazy.js'); globalThis.order.push('entry');
      globalThis.moduleThis = this;`,
    'core.js': `globalThis.order.push('core'); export const answer = 40, add = value => value + 2;`,
    'lazy.js': `import {answer, add} from './barrel.js'; globalThis.order.push('lazy'); export const value = add(answer);`,
    'barrel.js': `export {answer} from './core.js'; export * from './functions.js';`,
    'functions.js': `export {add} from './core.js';`
  });
  const source = await bundleWorker(join(root, 'entry.js'), { root });
  assert.deepEqual(dynamicCodeUses(source), []);
  const scope = execute(source, { order: [] });
  assert.equal(scope.moduleThis, undefined);
  assert.deepEqual(scope.order, ['core', 'entry']);
  const first = scope.load(), second = scope.load();
  assert.deepEqual(scope.order, ['core', 'entry']);
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left.value, 42);
  assert.equal(left, right);
  assert(Object.isFrozen(left));
  assert.deepEqual(scope.order, ['core', 'entry', 'lazy']);
});

test('lexical transforms leave literal/comment/regex text unchanged and handle nested template expressions', async t => {
  const root = await fixture(t, {
    'entry.js': `// import('missing.js') and import.meta.url
      globalThis.text = "import('missing.js')";
      globalThis.pattern = /import\\('missing.js'\\)/;
      globalThis.load = async () => \`outer \${\`inner \${(await import('./lazy.js')).value}\`}\`;
      globalThis.object = {import: 'property', export() { return 'method'; }};`,
    'lazy.js': `export const value = 42;`
  });
  const source = await bundleWorker(join(root, 'entry.js'), { root });
  const scope = execute(source);
  assert.equal(scope.text, "import('missing.js')");
  assert(scope.pattern.test(scope.text));
  assert.equal(await scope.load(), 'outer inner 42');
  assert.equal(scope.object.export(), 'method');
  assert.equal(scope.object.import, 'property');
  assert.deepEqual(moduleSyntax(source), []);
});

test('dynamic cycles are deferred and repeated evaluation failures keep their original error identity', async t => {
  const root = await fixture(t, {
    'entry.js': `globalThis.load = () => import('./lazy.js'); globalThis.fail = () => import('./failure.js'); export const ready = true;`,
    'lazy.js': `export const back = () => import('./entry.js');`,
    'failure.js': `globalThis.attempts++; throw new Error('Initialization failed');`
  });
  const scope = execute(await bundleWorker(join(root, 'entry.js'), { root }), { attempts: 0 });
  assert.equal((await (await scope.load()).back()).ready, true);
  const first = await scope.fail().catch(error => error);
  const second = await scope.fail().catch(error => error);
  assert.equal(first, second);
  assert.equal(scope.attempts, 1);
});

test('the known Node worker adapter cannot trigger dynamic code loading from a browser bundle', async t => {
  const root = await fixture(t, { 'entry.js': `globalThis.load = () => import('node:worker_threads');` });
  const source = await bundleWorker(join(root, 'entry.js'), { root });
  assert.deepEqual(dynamicCodeUses(source), []);
  await assert.rejects(execute(source).load(), /not available in a browser bundle/);
});

test('computed/unresolved imports, mutable exports, static cycles and missing or ambiguous names fail at build time', async t => {
  const cases = [
    { 'entry.js': 'globalThis.load = path => import(path);' },
    { 'entry.js': `globalThis.load = () => import('./dep.js', {with: {type:'json'}});` },
    { 'entry.js': `globalThis.load = () => import('https://example.test/module.js');` },
    { 'entry.js': 'export let value = 1;' },
    { 'entry.js': 'globalThis.base = import.meta.url;' },
    { 'entry.js': `import {missing} from './dep.js';`, 'dep.js': 'export const other = 1;' },
    { 'entry.js': `import './dep.js';`, 'dep.js': `import './entry.js';` },
    { 'entry.js': `import {value} from './all.js';`, 'all.js': `export * from './a.js'; export * from './b.js';`,
      'a.js': 'export const value = 1;', 'b.js': 'export const value = 2;' }
  ];
  for (const files of cases) {
    const root = await fixture(t, files);
    await assert.rejects(bundleWorker(join(root, 'entry.js'), { root }));
  }
});

test('graph containment checks real paths, including symlinks', async t => {
  const root = await fixture(t, { 'entry.js': `import {value} from './escape.js';` });
  const outside = await fixture(t, { 'outside.js': 'export const value = 42;' });
  await symlink(join(outside, 'outside.js'), join(root, 'escape.js'));
  await assert.rejects(bundleWorker(join(root, 'entry.js'), { root }), /leaves bundle root/);
});

test('standalone hashes exact code and lazily embeds actual worker dependencies, including nested workers', async t => {
  const root = await fixture(t, {
    'index.html': html, 'studio.css': 'body {color: black}',
    'studio.js': `globalThis.open = () => import('./feature.js'); globalThis.tag = '</script>';`,
    'feature.js': `export function run() { return new Worker(new URL('./workers/outer.js', import.meta.url), {type:'module'}); }
      export function receiver() { return this; }`,
    'workers/outer.js': `import {answer} from '../value.js'; self.postMessage(answer);
      globalThis.child = () => new Worker(new URL('../inner.js', import.meta.url));`,
    'inner.js': `import {answer} from './value.js'; self.onmessage = event => self.postMessage(answer + event.data);`,
    'value.js': 'export const answer = 40;'
  });
  const result = await createStandalone(root);
  assert.equal(result.workers, 2);
  assert.equal(inspectPolicy(result.html, { standalone: true }).passed, true);
  assert.equal(inspectPolicy(result.html.replace('color: black', 'color: red'), { standalone: true }).passed, true);
  const script = standaloneScript(result.html);
  assert.deepEqual(dynamicCodeUses(script), []);
  assert.equal(inspectPolicy(result.html.replace('Unknown embedded worker', 'Changed worker'), { standalone: true }).passed, false);
  const host = workerGlobals(), scope = execute(script, host.globals);
  assert.equal(scope.tag, '</script>');
  assert.equal(host.blobs.size, 0);
  const feature = await scope.open();
  assert.equal(feature.receiver.call(undefined), undefined, 'the worker bootstrap must preserve strict module evaluation');
  assert.equal(host.blobs.size, 0);
  feature.run(); feature.run();
  assert.equal(host.blobs.size, 1);
  assert.equal(host.workers[0].url, host.workers[1].url);
  const outerSource = await host.blobs.get(host.workers[0].url).text();
  const nested = workerGlobals(), replies = [];
  const outer = execute(outerSource, { ...nested.globals, postMessage: value => replies.push(value) });
  assert.deepEqual(replies, [40]);
  outer.child();
  const innerSource = await nested.blobs.get(nested.workers[0].url).text();
  const inner = execute(innerSource, { postMessage: value => replies.push(value) });
  inner.onmessage({ data: 2 });
  assert.deepEqual(replies, [40, 42]);
  host.events.get('pagehide')({ persisted: true });
  assert.equal(host.revoked.length, 0);
  host.events.get('pagehide')({ persisted: false });
  assert.equal(host.revoked.length, 1);
});

test('recursive worker graphs and worker URLs outside the asset root are rejected before packaging', async t => {
  const root = await fixture(t, { 'index.html': html, 'studio.css': '',
    'studio.js': `globalThis.worker = new Worker(new URL('./worker.js', import.meta.url));`,
    'worker.js': `globalThis.worker = new Worker(new URL('./worker.js', import.meta.url));` });
  await assert.rejects(createStandalone(root), /Recursive/);
  await mkdir(join(root, 'inside'));
  await writeFile(join(root, 'inside', 'entry.js'), `globalThis.worker = new Worker(new URL('../worker.js', import.meta.url));`);
  await assert.rejects(bundleWorker(join(root, 'inside', 'entry.js'), { root: join(root, 'inside'), workerUrl: () => 'null' }),
    /leaves bundle root/);
});
