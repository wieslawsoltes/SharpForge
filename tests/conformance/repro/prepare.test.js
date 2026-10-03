import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {writeZip} from '../../../packages/archive/src/index.js';
import {git, hash, temporary} from '../../../scripts/conformance/repro/common.js';
import {prepare} from '../../../scripts/conformance/repro/prepare.js';

async function sourceFixture(directory) {
  const root = join(directory, 'repository');
  await mkdir(root);
  const lock = JSON.stringify({lockfileVersion: 3, packages: {'': {name: 'fixture'}}}) + '\n';
  await writeFile(join(root, 'package-lock.json'), lock);
  await git(root, ['init', '--quiet']);
  await git(root, ['-c', 'core.autocrlf=false', 'add', 'package-lock.json']);
  await git(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Fixture']);
  await git(root, ['tag', 'v1.0.0']);
  const commit = await git(root, ['rev-parse', 'HEAD']);
  return {root, commit, archive: writeZip([{path: 'Source/package-lock.json', text: lock}])};
}

test('release preparation uses JSON Accept for zipballs and binary Accept for assets', async t =>
  temporary(async directory => {
    const source = await sourceFixture(directory);
    const api = 'https://api.github.com/repos/fixture/repository';
    const payload = Buffer.from('<!doctype html><title>Fixture</title>');
    const manifest = {
      schemaVersion: 1, algorithm: 'SHA256', commit: source.commit,
      files: [{path: 'release.html', bytes: payload.length, sha256: hash(payload)}]
    };
    const json = 'application/vnd.github+json';
    const binary = 'application/octet-stream';
    const responses = new Map([
      [`${api}/zipball/${source.commit}`, {accept: json, body: source.archive}],
      [`${api}/releases/tags/v1.0.0`, {accept: json, body: JSON.stringify({assets: [
        {id: 1, name: 'SOURCE-MANIFEST.json'}, {id: 2, name: 'release.html'}
      ]})}],
      [`${api}/releases/assets/1`, {accept: binary, body: JSON.stringify(manifest)}],
      [`${api}/releases/assets/2`, {accept: binary, body: payload}]
    ]);
    const requested = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      const response = responses.get(url);
      assert.ok(response, `Unexpected request: ${url}`);
      assert.equal(options.headers.Authorization, 'Bearer fixture-token');
      requested.push([url, options.headers.Accept]);
      if (options.headers.Accept !== response.accept) return new Response('Unsupported media type', {status: 415});
      return new Response(response.body);
    });
    const previousOutput = process.env.GITHUB_OUTPUT;
    process.env.GITHUB_OUTPUT = join(directory, 'step-output');
    t.after(() => {
      if (previousOutput === undefined) delete process.env.GITHUB_OUTPUT;
      else process.env.GITHUB_OUTPUT = previousOutput;
    });
    const output = join(directory, 'inputs');
    const result = await prepare({root: source.root, tag: 'v1.0.0', repository: 'fixture/repository', token: 'fixture-token', output});
    assert.deepEqual(requested, [...responses].map(([url, response]) => [url, response.accept]));
    assert.equal(result.commit, source.commit);
    assert.equal(result.sourceArchiveSha256, hash(source.archive));
    assert.equal(result.releaseAssets, true);
    assert.deepEqual(await readFile(join(output, 'release-assets/release.html')), payload);
    const cache = JSON.parse(await readFile(join(output, 'vendored-cache/cache-manifest.json'), 'utf8'));
    assert.deepEqual(cache.dependencies, []);
  }));
