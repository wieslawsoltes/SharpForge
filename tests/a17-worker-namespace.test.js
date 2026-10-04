import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {dirname, join, relative, sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {bundleWorker} from '../scripts/bundle-worker.js';

const execute = promisify(execFile);

async function fixture(t, files) {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-worker-namespace-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  for (const [name, source] of Object.entries(files)) {
    const path = join(directory, name);
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, source);
  }
  return directory;
}

async function runBundle(directory, source) {
  const path = join(directory, 'bundle.cjs');
  await writeFile(path, source);
  const {stdout, stderr} = await execute(process.execPath, [path], {timeout: 10000, maxBuffer: 1024 * 1024});
  assert.equal(stderr, '');
  return JSON.parse(stdout);
}

test('Static namespace imports share one read-only live view and execute dependencies once', async t => {
  const directory = await fixture(t, {
    'counter.js': `globalThis.order = ['counter'];
let current = 1;
export {current as value};
export function advance() { current++; }
const privateValue = 'hidden';`,
    'left.js': `import * as view from './counter.js';
export {view};
export {advance as increase} from './counter.js';
globalThis.order.push('left');`,
    'right.js': `export * from './counter.js';
globalThis.order.push('right');`,
    'entry.js': `import * as counter from './counter.js';
import {view, increase} from './left.js';
import * as forwarded from './right.js';
globalThis.order.push('entry');
increase();
let readOnly = false;
try { counter.value = 99; } catch (error) { readOnly = error instanceof TypeError; }
process.stdout.write(JSON.stringify({same: view === counter, value: counter.value, forwarded: forwarded.value,
  readOnly, keys: Object.keys(counter), nullPrototype: Object.getPrototypeOf(counter) === null,
  frozen: Object.isFrozen(counter), tag: counter[Symbol.toStringTag], order: globalThis.order}));`
  });
  const source = await bundleWorker(join(directory, 'entry.js'));
  assert.doesNotMatch(source, /^[\t ]*(?:import|export)\s/m);
  assert.doesNotMatch(source, /\b(?:eval|Function)\s*\(/);
  assert.doesNotMatch(source, /\bimport\s*\(/);
  assert.deepEqual(await runBundle(directory, source), {same: true, value: 2, forwarded: 2,
    readOnly: true, keys: ['advance', 'value'], nullPrototype: true, frozen: true, tag: 'Module',
    order: ['counter', 'left', 'right', 'entry']});
});

test('Named factories and renamed exports retain identity through namespace imports', async t => {
  const directory = await fixture(t, {
    'factory.js': `var internalFactory = (() => function make(value) { return {value}; })();
export {internalFactory as createFactory};`,
    'exports.js': `export {createFactory as make} from './factory.js';
export * from './factory.js';`,
    'entry.js': `import * as factories from './exports.js';
import {createFactory as original} from './factory.js';
process.stdout.write(JSON.stringify({same: factories.make === original, value: factories.createFactory(42).value}));`
  });
  assert.deepEqual(await runBundle(directory, await bundleWorker(join(directory, 'entry.js'))), {same: true, value: 42});
});

test('Ambiguous wildcard exports stay absent until an explicit named re-export selects one', async t => {
  const directory = await fixture(t, {
    'a.js': 'export const conflict = 1;',
    'b.js': 'export const conflict = 2;',
    'ambiguous.js': "export * from './a.js';\nexport * from './b.js';",
    'chosen.js': "export * from './a.js';\nexport * from './b.js';\nexport {conflict} from './a.js';",
    'entry.js': `import * as ambiguous from './ambiguous.js';
import * as chosen from './chosen.js';
process.stdout.write(JSON.stringify({absent: !('conflict' in ambiguous), chosen: chosen.conflict}));`,
    'invalid.js': "import {conflict} from './ambiguous.js';"
  });
  assert.deepEqual(await runBundle(directory, await bundleWorker(join(directory, 'entry.js'))), {absent: true, chosen: 1});
  await assert.rejects(bundleWorker(join(directory, 'invalid.js')), /Missing or ambiguous export conflict/);
});

test('Namespace cycles and unsupported or unresolved imports fail before a bundle is emitted', async t => {
  const directory = await fixture(t, {
    'a.js': "import * as other from './b.js';\nexport const a = 1;",
    'b.js': "export * from './a.js';",
    'external.js': "import * as files from 'node:fs';",
    'default.js': "import factory from './a.js';",
    'malformed.js': "import * as first.second from './a.js';",
    'namespace-export.js': "export * as names from './a.js';"
  });
  await assert.rejects(bundleWorker(join(directory, 'a.js')), /Static module cycle/);
  await assert.rejects(bundleWorker(join(directory, 'external.js')), /Unresolved dependency node:fs/);
  for (const [name, diagnostic] of [
    ['default.js', /Default imports require native ESM/],
    ['malformed.js', /Invalid static import/],
    ['namespace-export.js', /Unsupported export-star declaration/]
  ]) {
    await assert.rejects(bundleWorker(join(directory, name)), diagnostic);
  }
});

test('Pinned HarfBuzz factories bundle as static named exports without an eager Wasm instance', async t => {
  const directory = await fixture(t, {});
  const vendor = fileURLToPath(new URL('../packages/rendering/vendor/harfbuzz/', import.meta.url));
  const specifier = name => {
    const path = relative(directory, join(vendor, name)).split(sep).join('/');
    return path.startsWith('.') ? path : './' + path;
  };
  await writeFile(join(directory, 'entry.js'), `import * as native from ${JSON.stringify(specifier('hb.js'))};
import {hbjs} from ${JSON.stringify(specifier('hbjs.js'))};
process.stdout.write(JSON.stringify({factory: typeof native.createHarfBuzz, adapter: typeof hbjs}));`);
  const source = await bundleWorker(join(directory, 'entry.js'));
  assert.doesNotMatch(source, /^[\t ]*(?:import|export)\s/m);
  assert.doesNotMatch(source, /\bimport\s*\(/);
  assert.deepEqual(await runBundle(directory, source), {factory: 'function', adapter: 'function'});
});
