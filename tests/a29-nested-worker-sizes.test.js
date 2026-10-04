import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {artifactSizes, checkSizes} from '../scripts/conformance/perf/size-budget.js';

const measurementScript = fileURLToPath(new URL(
  '../planning/qualification/integration-performance/size/measure.mjs', import.meta.url));
const expected = [
  {id: 'dist', path: 'dist', bytes: 343},
  {id: 'standalone', path: 'artifacts/SharpForge-standalone.html', bytes: 19},
  {id: 'worker:compiler.worker.js', path: 'dist/compiler.worker.js', bytes: 13},
  {id: 'worker:workbench/search.worker.js', path: 'dist/workbench/search.worker.js', bytes: 101},
  {id: 'worker:workbench/metadata/metadata.worker.js', path: 'dist/workbench/metadata/metadata.worker.js', bytes: 211},
  {id: 'package:@sharpforge/fixture', path: 'artifacts/sharpforge-fixture-1.0.0.tgz', bytes: 23},
];

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sharpforge-nested-worker-size-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const write = async (path, contents) => {
    await mkdir(dirname(join(root, path)), {recursive: true});
    await writeFile(join(root, path), contents);
  };
  await write('package.json', JSON.stringify({type: 'module', workspaces: ['packages/*']}));
  await write('packages/fixture/package.json', JSON.stringify({name: '@sharpforge/fixture', version: '1.0.0'}));
  await write('packages/fixture/smoke.mjs', 'export function smoke() {}\n');
  await write('apps/studio/build.contrib.json', JSON.stringify({
    schemaVersion: 1, styles: [], assets: [],
    workers: expected.filter(item => item.id.startsWith('worker:')).map((item, order) => ({
      entry: item.id.slice('worker:'.length), order,
    })),
  }));
  for (const item of expected.slice(1)) await write(item.path, Buffer.alloc(item.bytes, 65));
  // These valid root files must never substitute for the declared nested workers.
  await write('dist/search.worker.js', Buffer.alloc(7, 66));
  await write('dist/metadata.worker.js', Buffer.alloc(11, 67));
  for (const name of ['build-contributions.js', 'verify-packages.js']) {
    const source = new URL('../scripts/' + name, import.meta.url).href;
    await write('scripts/' + name, 'export * from ' + JSON.stringify(source) + ';\n');
  }
  return root;
}

test('size budget inventory uses declared nested workers despite same-name root decoys', async t => {
  assert.deepEqual(await artifactSizes(await fixture(t)), expected);
});

test('historical raw measurement preserves the same complete nested-worker inventory', async t => {
  const root = await fixture(t), output = join(root, 'artifacts', 'sizes.json');
  execFileSync(process.execPath, [measurementScript, root, output], {timeout: 30000, stdio: 'pipe'});
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), {schemaVersion: 1, artifacts: expected});
});

test('missing declared nested worker rejects instead of falling back to a root decoy', async t => {
  const root = await fixture(t), missing = join(root, 'dist', 'workbench', 'search.worker.js');
  await rm(missing);
  await assert.rejects(artifactSizes(root), error => error.code === 'ENOENT' && error.path === missing);
  assert.throws(() => execFileSync(process.execPath, [measurementScript, root, join(root, 'sizes.json')], {
    timeout: 30000, stdio: 'pipe',
  }), error => error.status !== 0 && /ENOENT/.test(error.stderr.toString()));
});

test('nested workers and packages still require explicit reviewed budgets without changing ceilings', async t => {
  const actual = await artifactSizes(await fixture(t));
  const budgets = actual.map(({id, bytes}) => ({id, maxBytes: bytes}));
  assert.equal(checkSizes(actual, {schemaVersion: 1, budgets}).passed, true);
  for (const id of ['worker:workbench/search.worker.js', 'package:@sharpforge/fixture']) {
    assert.throws(() => checkSizes(actual, {schemaVersion: 1, budgets: budgets.filter(item => item.id !== id)}), {
      message: 'Missing reviewed budget: ' + id,
    });
  }
  const worker = 'worker:workbench/metadata/metadata.worker.js';
  const limited = budgets.map(item => item.id === worker ? {...item, maxBytes: item.maxBytes - 1} : item);
  const result = checkSizes(actual, {schemaVersion: 1, budgets: limited});
  assert.equal(result.passed, false);
  assert.equal(result.artifacts.find(item => item.id === worker).delta, 1);
});
