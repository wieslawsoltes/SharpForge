import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readZip } from '../../packages/archive/src/index.js';
import {
  ARCHIVE, MANIFEST, LIMITS, capture, destination, digest, git, loadStage, regularBytes, validatePolicy,
} from '../../scripts/conformance/evidence/inventory.js';
import { migrationPlan, migrate, rewriteMarkdown } from '../../scripts/conformance/evidence/migration.js';
import { verifyPublished } from '../../scripts/conformance/evidence/release.js';
import { publicationPlan } from '../../scripts/conformance/evidence/publication.js';

async function fixture(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sf-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'docs/result.json'), '{"historical":true}\r\n');
  await writeFile(join(root, 'docs/framework-api.json'), '{"types":[]}\n');
  await writeFile(join(root, 'docs/release.md'), '# Release\n\n[Results](result.json) and `result.json`.\n');
  for (const [path, text] of Object.entries(extra)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  git(root, ['init', '--quiet']);
  git(root, ['config', 'core.autocrlf', 'false']);
  git(root, ['config', 'core.hooksPath', join(root, 'no-hooks')]);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Archive Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
  const commit = git(root, ['rev-parse', 'HEAD']).toString().trim();
  const policy = {
    schemaVersion: 1, paths: ['docs/result.json'],
    preserved: [{ path: 'docs/framework-api.json', reason: 'Authored API reference' }],
  };
  const options = { commit, repository: 'example/project', tag: 'evidence-archive-fixture' };
  const stage = capture(root, policy, options);
  return { root, policy, options, stage };
}

function remote(stage, overrides = {}) {
  const base = destination(stage.manifest.repository, stage.manifest.tag);
  const assets = [...stage.payloads].map(([name, bytes], index) => ({
    name, id: index + 1, state: 'uploaded', size: bytes.length,
    digest: `sha256:${digest(bytes)}`, browser_download_url: `${base}/${name}`,
  }));
  const release = {
    id: 42, tag_name: stage.manifest.tag, draft: false, prerelease: true, assets,
    ...overrides.release,
  };
  return async (url, options) => {
    options.signal.throwIfAborted();
    if (url.includes('/releases/tags/')) return Response.json(release);
    if (url.includes(`/releases/${release.id}/assets?`)) {
      const page = Number(new URL(url).searchParams.get('page'));
      return Response.json(release.assets.slice((page - 1) * 100, page * 100));
    }
    if (url.includes('/git/ref/tags/')) {
      return Response.json({ object: { type: 'commit', sha: overrides.commit ?? stage.manifest.snapshotCommit } });
    }
    const name = url.slice(base.length + 1);
    assert.equal(url, `${base}/${name}`);
    const bytes = stage.payloads.get(name);
    assert.ok(bytes);
    return overrides.download ? overrides.download(name, bytes) : new Response(bytes);
  };
}

test('capture preserves exact committed bytes and authored reference data in deterministic assets', async t => {
  const { root, policy, options, stage } = await fixture(t);
  assert.equal(stage.manifest.snapshotCommit, options.commit);
  assert.match(stage.manifest.originalTestedRevision, /Not inferred/);
  assert.deepEqual(stage.payloads, capture(root, policy, options).payloads);
  const entries = readZip(stage.payloads.get(ARCHIVE), LIMITS);
  assert.deepEqual(entries.map(entry => entry.path), [MANIFEST, 'docs/result.json']);
  assert.equal(Buffer.from(entries[1].bytes).toString(), '{"historical":true}\r\n');
  await writeFile(join(root, 'docs/result.json'), 'uncommitted changes');
  assert.deepEqual(capture(root, policy, options).payloads, stage.payloads);
  await assert.rejects(migrationPlan(root, stage.manifest), /Working evidence differs/);
});

test('policy rejects traversal, duplicates, unreviewed data, unsupported source pins and product-version tags', async t => {
  const { root, policy, options } = await fixture(t);
  for (const path of ['docs/../secret.json', '/tmp/report.json', 'docs/nested/report.json', 'docs/report.md']) {
    assert.throws(() => validatePolicy({ ...policy, paths: [path] }), /Invalid evidence path/);
  }
  assert.throws(() => validatePolicy({ ...policy, paths: [...policy.paths, ...policy.paths] }), /Duplicate/);
  assert.throws(() => capture(root, { ...policy, preserved: [] }, options), /Unreviewed docs data/);
  assert.throws(() => capture(root, policy, { ...options, commit: 'HEAD' }), /exact 40-character/);
  assert.throws(() => destination('example/project', 'v0.14.0'), /non-version/);
  assert.throws(() => destination('https://example.org/repo', options.tag), /repository/);
  assert.throws(() => validatePolicy({ ...policy, paths: Array(LIMITS.maxEntries).fill(policy.paths[0]) }), /policy/);
});

test('staged archives are verified against source, including manifest and checksum bytes', async t => {
  const { root, policy, stage } = await fixture(t);
  const directory = join(root, 'staged');
  await mkdir(directory);
  for (const [name, bytes] of stage.payloads) await writeFile(join(directory, name), bytes);
  assert.deepEqual((await loadStage(root, directory, policy)).payloads, stage.payloads);
  await writeFile(join(directory, 'result.json'), '{}');
  await assert.rejects(loadStage(root, directory, policy), /differs from committed/);
  await writeFile(join(directory, 'result.json'), stage.payloads.get('result.json'));
  await writeFile(join(directory, MANIFEST), JSON.stringify({ ...stage.manifest, snapshotCommit: 'HEAD' }));
  await assert.rejects(loadStage(root, directory, policy), /exact 40-character/);
});

test('Git replacement objects cannot substitute bytes under an original archival source pin', async t => {
  const { root, policy, options, stage } = await fixture(t);
  await writeFile(join(root, 'replacement.txt'), 'replacement bytes');
  const alternate = git(root, ['hash-object', '-w', 'replacement.txt']).toString().trim();
  git(root, ['replace', stage.manifest.files[0].blob, alternate]);
  assert.deepEqual(capture(root, policy, options).payloads, stage.payloads);
});

test('local reads reject symlink files, symlink parents and sizes above the boundary', async t => {
  const { root } = await fixture(t);
  await symlink('docs/result.json', join(root, 'linked.json'));
  await symlink('docs', join(root, 'linked-docs'));
  await assert.rejects(regularBytes(root, 'linked.json'), /Non-regular/);
  await assert.rejects(regularBytes(root, 'linked-docs/result.json'), /Non-directory/);
  await assert.rejects(regularBytes(root, '../result.json'), /Unsafe/);
  await writeFile(join(root, 'limit'), '123');
  assert.equal((await regularBytes(root, 'limit', 3)).length, 3);
  await assert.rejects(regularBytes(root, 'limit', 2), /oversized/);
});

test('published verification checks every actual downloaded asset and records only archival provenance', async t => {
  const { stage } = await fixture(t);
  const receipt = await verifyPublished(stage, { fetch: remote(stage) });
  assert.equal(receipt.assets.length, stage.payloads.size);
  assert.equal(receipt.snapshotCommit, stage.manifest.snapshotCommit);
  assert.equal(receipt.kind, 'historical-evidence-download-verification');
});

test('asset listing handles exact-page and multi-page inventory boundaries', async t => {
  const { stage } = await fixture(t);
  for (const count of [100, 101]) {
    const expanded = { ...stage, payloads: new Map(stage.payloads) };
    while (expanded.payloads.size < count) expanded.payloads.set(`entry-${expanded.payloads.size}.json`, Buffer.from('{}'));
    const receipt = await verifyPublished(expanded, { fetch: remote(expanded) });
    assert.equal(receipt.assets.length, count);
  }
});

test('publication plan names a new pinned prerelease and uploads only the exact evidence inventory', async t => {
  const { root, stage } = await fixture(t);
  const { plan, notes } = publicationPlan(stage, root);
  assert.equal(plan.argv[0], 'release');
  assert.equal(plan.argv[1], 'create');
  assert.equal(plan.argv[plan.argv.indexOf('--target') + 1], stage.manifest.snapshotCommit);
  assert.ok(plan.argv.includes('--latest=false'));
  assert.ok(plan.argv.includes('--prerelease'));
  assert.ok(!plan.argv.includes('--clobber'));
  assert.deepEqual(plan.argv.slice(-stage.payloads.size), [...stage.payloads.keys()].sort().map(name => join(root, name)));
  assert.equal(plan.absentBeforePublication.length, 2);
  assert.match(notes, /No tests were rerun/);
});

test('repro archival exclusion is scoped to published archive releases', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/repro.yml', import.meta.url), 'utf8');
  const gate = workflow.split('  prepare:\n')[1]?.split('    runs-on:')[0].replace(/\s+/g, ' ').trim();
  assert.ok(gate?.includes("(github.event_name != 'release' || !startsWith(github.event.release.tag_name, 'evidence-archive-'))"));
  assert.match(workflow, /release:\n    types: \[published\]/);
});

test('verification rejects unpublished releases, wrong pins, absent assets and corruption', async t => {
  const { stage } = await fixture(t);
  for (const release of [{ draft: true }, { prerelease: false }, { assets: [] }, { tag_name: 'different' }]) {
    await assert.rejects(verifyPublished(stage, { fetch: remote(stage, { release }) }), /published archival prerelease|asset inventory/);
  }
  await assert.rejects(verifyPublished(stage, { fetch: remote(stage, { commit: '0'.repeat(40) }) }), /source commit differs/);
  const fetch = remote(stage, { download: (_name, bytes) => new Response(Buffer.alloc(bytes.length)) });
  await assert.rejects(verifyPublished(stage, { fetch }), /Downloaded asset differs/);
});

test('download limits, hostile redirects, non-success HTTP and cancellation fail closed', async t => {
  const { stage } = await fixture(t);
  for (const download of [
    () => new Response('x', { headers: { 'content-length': String(LIMITS.maxArchiveBytes + 1) } }),
    () => new Response(null, { status: 302, headers: { location: 'https://attacker.invalid/evidence' } }),
    () => new Response('missing', { status: 404 }),
    (_name, bytes) => new Response(Buffer.alloc(bytes.length + 1)),
  ]) {
    await assert.rejects(verifyPublished(stage, { fetch: remote(stage, { download }) }), /limit|Untrusted|HTTP 404/);
  }
  const controller = new AbortController();
  controller.abort(new Error('cancelled fixture'));
  await assert.rejects(verifyPublished(stage, { fetch: remote(stage), signal: controller.signal }), /cancelled fixture/);
});

test('Markdown migration rewrites links relative to their documents and retains report claims', async t => {
  const { stage } = await fixture(t);
  const text = '[result](docs/result.json) and [external](https://example.com/result.json). Historical **10 passed**.\n';
  const changed = rewriteMarkdown(text, 'README.md', stage.manifest);
  assert.ok(changed.includes(`](${stage.manifest.files[0].url})`));
  assert.match(changed, /https:\/\/example.com\/result.json/);
  assert.match(changed, /Historical \*\*10 passed\*\*/);
  assert.match(changed, /\(docs\/historical-evidence.md\)/);
});

test('nested evidence links rewrite at the repository boundary without changing unrelated escaping links', async t => {
  const { stage } = await fixture(t);
  const path = 'packages/symbols/interop/README.md';
  const valid = '[report](../../../docs/result.json#retained)';
  assert.ok(rewriteMarkdown(valid, path, stage.manifest).includes(`](${stage.manifest.files[0].url}#retained)`));
  const unrelated = '[other project](../../../../other-project/docs/notes.md)';
  assert.equal(rewriteMarkdown(unrelated, path, stage.manifest), unrelated);
});

test('escaping selected evidence links stop preparation and migration before downloads or source writes', async t => {
  const path = 'packages/symbols/interop/README.md';
  const { root, stage } = await fixture(t, { [path]: '[report](../../../docs/result.json)\n' });
  const plan = await migrationPlan(root, stage.manifest);
  const escaped = '[report](../../../../docs/result.json)\n';
  await writeFile(join(root, path), escaped);
  await assert.rejects(migrationPlan(root, stage.manifest), /Evidence link escapes repository: packages\/symbols\/interop\/README\.md/);
  let downloaded = false;
  await assert.rejects(migrate(root, stage, plan, { fetch: async () => { downloaded = true; throw new Error('Unexpected download'); } }),
    /Evidence link escapes repository/);
  assert.equal(downloaded, false);
  assert.equal(await readFile(join(root, path), 'utf8'), escaped);
  assert.equal(await readFile(join(root, 'docs/result.json'), 'utf8'), '{"historical":true}\r\n');
  await assert.rejects(access(join(root, 'docs/historical-evidence.md')), /ENOENT/);
});

test('migration leaves originals intact on failed download or altered proposal', async t => {
  const { root, stage } = await fixture(t);
  const plan = await migrationPlan(root, stage.manifest);
  const fetch = remote(stage, { download: () => new Response('missing', { status: 404 }) });
  await assert.rejects(migrate(root, stage, plan, { fetch }), /HTTP 404/);
  await access(join(root, 'docs/result.json'));
  await assert.rejects(access(join(root, 'docs/historical-evidence.md')), /ENOENT/);
  await assert.rejects(migrate(root, stage, { ...plan, removals: [] }, { fetch: remote(stage) }), /proposal differs/);
});

test('migration removes only verified originals, keeps schemas and publishes resolving links', async t => {
  const { root, stage } = await fixture(t);
  const plan = await migrationPlan(root, stage.manifest);
  const receipt = await migrate(root, stage, plan, { fetch: remote(stage) });
  assert.equal(receipt.assets.length, stage.payloads.size);
  await assert.rejects(access(join(root, 'docs/result.json')), /ENOENT/);
  assert.equal(await readFile(join(root, 'docs/framework-api.json'), 'utf8'), '{"types":[]}\n');
  assert.ok((await readFile(join(root, 'docs/release.md'), 'utf8')).includes(stage.manifest.files[0].url));
  assert.ok((await readFile(join(root, 'docs/historical-evidence.md'), 'utf8')).includes(stage.manifest.snapshotCommit));
});

test('archived license declarations retain exact provenance before the live inventory removes their source entries', async t => {
  const license = { path: 'docs/result.json', sha256: digest('{"historical":true}\r\n'), license: 'MIT', origin: 'retained origin' };
  const retained = { path: 'image.png', license: 'MIT' };
  const policyPath = 'planning/qualification/supply/licenses.json';
  const { root, stage } = await fixture(t, { [policyPath]: JSON.stringify({ files: [license, retained] }) });
  assert.deepEqual(stage.manifest.licensePolicy.declarations, [license]);
  assert.match(stage.manifest.licensePolicy.blob, /^[a-f0-9]{40}$/);
  const plan = await migrationPlan(root, stage.manifest);
  await migrate(root, stage, plan, { fetch: remote(stage) });
  assert.deepEqual(JSON.parse(await readFile(join(root, policyPath), 'utf8')).files, [retained]);
});

test('cancellation delivered after the last download preserves all originals', async t => {
  const { root, stage } = await fixture(t);
  const plan = await migrationPlan(root, stage.manifest);
  const controller = new AbortController();
  const originalFetch = remote(stage);
  const lastAsset = [...stage.payloads.keys()].at(-1);
  const fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (args[0].endsWith('/' + lastAsset)) setImmediate(() => controller.abort(new Error('cancelled after downloads')));
    return response;
  };
  await assert.rejects(migrate(root, stage, plan, { fetch, signal: controller.signal }), /cancelled after downloads/);
  await access(join(root, 'docs/result.json'));
  await assert.rejects(access(join(root, 'docs/historical-evidence.md')), /ENOENT/);
});

test('migration refuses concurrent source edits and pre-existing index files', async t => {
  const { root, stage } = await fixture(t);
  const plan = await migrationPlan(root, stage.manifest);
  const originalFetch = remote(stage);
  const fetch = async (...args) => {
    await writeFile(join(root, 'docs/result.json'), 'concurrent work');
    return originalFetch(...args);
  };
  await assert.rejects(migrate(root, stage, plan, { fetch }), /Working evidence differs/);
  assert.equal(await readFile(join(root, 'docs/result.json'), 'utf8'), 'concurrent work');
  await writeFile(join(root, 'docs/historical-evidence.md'), 'authored index');
  await assert.rejects(migrationPlan(root, stage.manifest), /overwrite existing index/);
});
