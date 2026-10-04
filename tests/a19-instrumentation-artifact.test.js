import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rootDirectory} from '../scripts/editor-benchmarks/common.js';
import {checkoutIdentity, readBuildIdentity, writeBuildIdentity}
  from '../scripts/conformance/build-identity.js';
import {requireExactSource, verifyServedIdentity} from '../scripts/workbench-overhead/identity.js';
import {installCsp, hostedHtml} from '../scripts/conformance/security/csp.js';
import {rewriteModulePaths} from '../scripts/build-module-paths.js';

async function fixture(context) {
  const base = await mkdtemp(join(tmpdir(), 'sharpforge-instrumentation-'));
  context.after(() => rm(base, {recursive: true, force: true}));
  const directory = join(base, 'dist'), options = {manifestPath: join(base, 'artifacts/results/build-identity/manifest.json')};
  await mkdir(directory);
  await writeFile(join(directory, 'index.html'), installCsp('<html><head></head><body>Studio fixture</body></html>'));
  await writeFile(join(directory, 'studio.js'), 'export const fixture = 1;\n');
  await writeBuildIdentity(rootDirectory, directory, undefined, options);
  const local = await readBuildIdentity(rootDirectory, directory, options);
  return {directory, local, options, report: {served: []}};
}

async function serve(context, identity, change = (path, bytes) => bytes, allowedOrigins = []) {
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
      let bytes = await readFile(join(identity.directory, path));
      if (path.endsWith('.html')) bytes = Buffer.from(hostedHtml(bytes.toString(), {allowedOrigins}).body);
      response.end(change(path, bytes));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  context.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}/`;
}

test('completed build identity deterministically binds actual bytes and source revision/tree', async context => {
  const identity = await fixture(context), expected = checkoutIdentity(rootDirectory);
  assert.deepEqual(identity.local.manifest.source, expected);
  assert.equal(identity.local.manifest.stable, true);
  assert.deepEqual(identity.local.manifest.assets.map(asset => asset.path), ['index.html', 'studio.js']);
  assert.deepEqual((await readdir(identity.directory)).sort(), ['index.html', 'studio.js']);
  await writeBuildIdentity(rootDirectory, identity.directory, undefined, identity.options);
  assert.equal((await readBuildIdentity(rootDirectory, identity.directory, identity.options)).sha256, identity.local.sha256);
});

test('changed or added local output cannot reuse a completed build identity', async context => {
  const changed = await fixture(context);
  await writeFile(join(changed.directory, 'studio.js'), 'changed');
  await assert.rejects(readBuildIdentity(rootDirectory, changed.directory, changed.options), /differ/);
  const added = await fixture(context);
  await writeFile(join(added.directory, 'extra.js'), 'unexpected');
  await assert.rejects(readBuildIdentity(rootDirectory, added.directory, added.options), /differ/);
});

test('archive builds without Git metadata keep identical distribution bytes and explicit unknown provenance', async context => {
  const identity = await fixture(context), before = identity.local.manifest.assets;
  const archiveRoot = await mkdtemp(join(tmpdir(), 'sharpforge-archive-'));
  context.after(() => rm(archiveRoot, {recursive: true, force: true}));
  await writeBuildIdentity(archiveRoot, identity.directory, undefined, identity.options);
  const rebuilt = await readBuildIdentity(archiveRoot, identity.directory, identity.options);
  assert.deepEqual(rebuilt.manifest.assets, before);
  assert.deepEqual(rebuilt.manifest.source, {commit: null, tree: null, clean: false});
  assert.deepEqual((await readdir(identity.directory)).sort(), ['index.html', 'studio.js']);
  assert.throws(() => requireExactSource(rebuilt.manifest.source, checkoutIdentity(rootDirectory)), /Exact-source/);
});

test('exact-source claim rejects unknown, dirty, stale-commit and stale-tree identities', () => {
  const source = {commit: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true};
  assert.doesNotThrow(() => requireExactSource(source, {...source}));
  for (const replacement of [null, {...source, commit: null}, {...source, clean: false},
    {...source, commit: 'c'.repeat(40)}, {...source, tree: 'd'.repeat(40)}]) {
    assert.throws(() => requireExactSource(replacement, source), /Exact-source/);
    assert.throws(() => requireExactSource(source, replacement), /Exact-source/);
  }
});

test('actual HTTP assets match the completed artifact with the explicit production HTML transformation', async context => {
  const identity = await fixture(context), allowedOrigins = ['https://api.example.com'];
  const url = await serve(context, identity, undefined, allowedOrigins);
  await verifyServedIdentity(identity, url, 'before', {allowedOrigins});
  await verifyServedIdentity(identity, url + 'index.html', 'after', {allowedOrigins});
  assert.equal(identity.report.served.length, 2);
  assert(identity.report.served.every(record => record.matched && record.assets.length === 2));
  assert.equal(identity.report.served[0].assetsSha256, identity.report.served[1].assetsSha256);
  assert.equal(identity.report.served[0].expectedManifestSha256, identity.local.sha256);
});

test('a server returning stale application bytes fails closed against the local completed build', async context => {
  const identity = await fixture(context);
  const url = await serve(context, identity, (path, bytes) => path === 'studio.js' ? Buffer.from('stale') : bytes);
  await assert.rejects(verifyServedIdentity(identity, url, 'before'), /differs/);
  assert.equal(identity.report.served[0].matched, false);
  assert.match(identity.report.served[0].error, /studio.js/);
});

test('changed local HTML is rejected before its production transformation can authorize different served bytes', async context => {
  const identity = await fixture(context);
  const url = await serve(context, identity);
  await writeFile(join(identity.directory, 'index.html'), installCsp('<html><head></head><body>Changed</body></html>'));
  await assert.rejects(verifyServedIdentity(identity, url, 'before'), /Local HTML changed/);
  assert.equal(identity.report.served[0].matched, false);
  assert.equal(identity.report.served[0].assets.length, 0);
});

test('extracted production path rewrite preserves root, nested, quote and non-JavaScript behavior', async context => {
  const identity = await fixture(context), root = identity.directory, nested = join(root, 'workbench');
  await mkdir(nested);
  const imports = 'import a from "@sharpforge/text";\nimport b from \'@sharpforge/project-system\';\n'
    + 'import c from \'../../packages/editor/src/index.js\';\n';
  await writeFile(join(root, 'main.js'), imports);
  await writeFile(join(nested, 'child.js'), imports);
  await writeFile(join(nested, 'unchanged.txt'), imports);
  await rewriteModulePaths(root);
  assert.equal(await readFile(join(root, 'main.js'), 'utf8'),
    'import a from "./packages/text/src/index.js";\nimport b from \'./packages/project-system/src/index.js\';\n'
    + 'import c from \'./packages/editor/src/index.js\';\n');
  assert.equal(await readFile(join(nested, 'child.js'), 'utf8'),
    'import a from "../packages/text/src/index.js";\nimport b from \'../packages/project-system/src/index.js\';\n'
    + 'import c from \'../../packages/editor/src/index.js\';\n');
  assert.equal(await readFile(join(nested, 'unchanged.txt'), 'utf8'), imports);
});

test('the final verification detects an application replaced after the initial verification', async context => {
  const identity = await fixture(context);
  let changed = false;
  const url = await serve(context, identity, (path, bytes) => changed && path === 'studio.js' ? Buffer.from('different') : bytes);
  await verifyServedIdentity(identity, url, 'before');
  changed = true;
  await assert.rejects(verifyServedIdentity(identity, url, 'after'), /differs/);
  assert.equal(identity.report.served[0].matched, true);
  assert.equal(identity.report.served[1].matched, false);
});
