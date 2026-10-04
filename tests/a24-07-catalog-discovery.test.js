import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { catalogSource } from '../packages/templates/build-catalog.js';
import { TemplateCatalog, searchTemplates, createItemPlan, builtInTemplates } from '@sharpforge/templates';
import { loadBuildContributions } from '../scripts/build-contributions.js';
import { prepareBuildAssets } from '../scripts/build-assets.js';
import { runBuildGenerators } from '../scripts/build-generators.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const empty = { schemaVersion: 1, styles: [], workers: [], assets: [] };

async function write(root, path, content) {
  const target = resolve(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, typeof content === 'string' ? content : JSON.stringify(content));
}

const contribution = (id, extra = '') => 'export const template = { id: ' + JSON.stringify(id) + ', name: "Notice", ' +
  'description: "A complete single-file template", category: "General", kind: "item", language: "Text", ' +
  'fileName: "NOTICE.txt", targets: ["browser-managed"], generate(template, options) {' +
  'return {records:[{path:options.name,text:"Created by " + template.id + "\\n"}]};} };\n' + extra;

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'sf-template-discovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(root, 'package.json', { type: 'module' });
  await write(root, 'apps/studio/build.contrib.json', empty);
  const directory = resolve(root, 'packages/templates');
  await mkdir(resolve(directory, 'src/project'), { recursive: true });
  await write(directory, 'src/item/first.template.js', contribution('first'));
  await cp(resolve(repository, 'packages/templates/build-catalog.js'), resolve(directory, 'build-catalog.js'));
  const declaration = { ...empty, assets: [{ source: 'packages/templates', target: 'packages/templates', order: 0 }],
    generators: [{ source: 'packages/templates/build-catalog.js', target: 'packages/templates/src/catalog.generated.js', order: 0 }] };
  await write(root, 'packages/templates/build.contrib.json', declaration);
  return { root, directory, declaration };
}

test('Adding one builtin module changes the built catalog without a central registry or import-list edit', async t => {
  const { root, directory } = await fixture(t);
  const before = await catalogSource({ directory });
  await write(directory, 'src/catalog.generated.js', before);
  await write(directory, 'src/item/second.template.js', contribution('second', 'export const order = 0;'));
  const contributions = await loadBuildContributions(root);
  const destination = resolve(root, 'dist');
  await prepareBuildAssets(contributions, { root, destination });
  const path = resolve(destination, 'packages/templates/src/catalog.generated.js');
  const generated = await import(pathToFileURL(path).href);
  const catalog = new TemplateCatalog(generated.builtInTemplates);
  assert.deepEqual(catalog.list({ kind: 'all' }).map(item => item.id), ['second', 'first']);
  assert.equal(searchTemplates({ catalog, kind: 'item', query: 'second' })[0].id, 'second');
  assert.deepEqual(createItemPlan('second', { catalog }).records, [{ path: 'NOTICE.txt', text: 'Created by second\n' }]);
  assert.equal(await readFile(resolve(directory, 'src/catalog.generated.js'), 'utf8'), before);
  assert.equal(await readFile(path, 'utf8'), await catalogSource({ directory }));
});

test('The checked-in builtin index is deterministic, complete and preserves all released inventories', async () => {
  const expected = await catalogSource();
  assert.equal(await readFile(resolve(repository, 'packages/templates/src/catalog.generated.js'), 'utf8'), expected);
  assert.equal(new Set(builtInTemplates.map(template => template.id)).size, builtInTemplates.length);
  assert.equal(builtInTemplates.length, [...expected.matchAll(/^import \{ template as /gm)].length);
});

test('Catalog discovery rejects duplicate identities, invalid declarations, limits and cancellation', async t => {
  const { directory } = await fixture(t);
  await write(directory, 'src/item/duplicate.template.js', contribution('first'));
  await assert.rejects(() => catalogSource({ directory }), /Duplicate template identity/);
  await rm(resolve(directory, 'src/item/duplicate.template.js'));
  await write(directory, 'src/item/invalid.template.js', contribution('bad', 'export const order = -1;'));
  await assert.rejects(() => catalogSource({ directory }), /Invalid template order/);
  await write(directory, 'src/item/invalid.template.js', 'export const template = {id:"bad",name:"Bad",kind:"item"};');
  await assert.rejects(() => catalogSource({ directory }), /generator/);
  await write(directory, 'src/item/invalid.template.js', contribution('bad').replace('kind: "item"', 'kind: "project"'));
  await assert.rejects(() => catalogSource({ directory }), /kind and generator/);
  await write(directory, 'src/item/invalid.template.js', contribution('bad').replace('["browser-managed"]', '[""]'));
  await assert.rejects(() => catalogSource({ directory }), /qualification targets/);
  await write(directory, 'src/item/invalid.template.js', contribution('bad') + '\n//' + 'x'.repeat(40 * 1024));
  await assert.rejects(() => catalogSource({ directory }), /40 KiB/);
  await write(directory, 'src/item/invalid.template.js', contribution('second'));
  await assert.rejects(() => catalogSource({ directory, maxTemplates: 1 }), /budget/);
  await assert.rejects(() => catalogSource({ directory, maxTemplates: 0 }), /budget/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => catalogSource({ directory, signal: controller.signal }), { name: 'AbortError' });
});

test('Build generator contributions reject escaping/duplicate targets, bad results and cancellation', async t => {
  const { root, declaration } = await fixture(t);
  declaration.generators[0].target = '../escape.js';
  await write(root, 'packages/templates/build.contrib.json', declaration);
  await assert.rejects(() => loadBuildContributions(root), /Unsafe repository path/);
  declaration.generators[0].target = 'catalog.generated.js';
  declaration.generators.push({ ...declaration.generators[0], order: 1 });
  await write(root, 'packages/templates/build.contrib.json', declaration);
  await assert.rejects(() => loadBuildContributions(root), /Duplicate generators/);
  await write(root, 'bad.js', 'export function generate(){return {invalid:true};}');
  await assert.rejects(() => runBuildGenerators([{ source: 'bad.js', target: 'bad-output.js' }],
    { root, destination: resolve(root, 'dist') }), /UTF-8 text or bytes/);
  await assert.rejects(() => runBuildGenerators([{ source: 'bad.js', target: '../escape.js' }],
    { root, destination: resolve(root, 'dist') }), /Unsafe repository path/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => runBuildGenerators([{ source: 'bad.js', target: 'bad-output.js' }],
    { root, destination: resolve(root, 'dist'), signal: controller.signal }), { name: 'AbortError' });
});
