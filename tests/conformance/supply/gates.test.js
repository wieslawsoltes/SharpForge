import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applyPins} from '../../../scripts/conformance/supply/pin-actions.js';
import {verifyVendor} from '../../../scripts/conformance/supply/verify-vendor.js';
import {licenseGate} from '../../../scripts/conformance/supply/license-gate.js';
import {entropy, scanText, secretScan} from '../../../scripts/conformance/supply/secret-scan.js';
import {payloadFiles} from '../../../scripts/conformance/supply/artifacts.js';
import {seal, verifySeal} from '../../../scripts/conformance/supply/seal.js';
import {sbom} from '../../../scripts/conformance/supply/sbom.js';
import {releaseSubjects, verifyAttestations, verificationArgs} from '../../../scripts/conformance/supply/attestation.js';
import {releaseManifest} from '../../../scripts/conformance/source-manifest.js';
import {boundedRead, localPath, sha256, walkFiles} from '../../../scripts/conformance/supply/files.js';

async function fixture(action) {
  const root = await mkdtemp(join(tmpdir(), 'sharpforge-supply-'));
  try { await action(root); } finally { await rm(root, {recursive: true, force: true}); }
}

async function file(root, name, text) {
  const path = join(root, name);
  await mkdir(join(path, '..'), {recursive: true});
  await writeFile(path, text);
}

function git(root, args) {
  return execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
}

async function initialize(root) {
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Supply fixture']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  await file(root, 'seed', 'owned test fixture');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'fixture']);
}

test('action updater pins reviewed references and refuses unknown or changed versions', () => {
  const commit = 'a'.repeat(40);
  const pins = {actions: {'actions/checkout': {ref: 'v4', commit}}};
  assert.equal(applyPins('  - uses: actions/checkout@v4\n', pins), '  - uses: actions/checkout@' + commit + ' # v4\n');
  assert.throws(() => applyPins('uses: actions/checkout@v5', pins), /review changed/);
  assert.throws(() => applyPins('uses: unrelated/action@v1', pins), /unknown/);
  assert.equal(applyPins('uses: ./.github/workflows/ci.yml', pins), 'uses: ./.github/workflows/ci.yml');
});

test('vendor gate rejects changed bytes even if the distributed hash is re-recorded', async () => fixture(async root => {
  const directory = 'packages/editor/src/vendor/';
  const original = 'upstream wrapper {body}';
  const bundled = 'local {body}';
  const manifest = {name: 'Owned fixture', version: '1', license: 'MIT',
    distributedFiles: {'classic-engine.js': sha256(bundled)}, upstreamFiles: {'lib.js': sha256(original)},
    reconstruction: {format: 1, segments: [{upstream: 'lib.js', bundled: 'classic-engine.js',
      offset: 7, length: 4, prefix: 'upstream wrapper {', suffix: '}'}]}};
  await file(root, directory + 'classic-engine.js', bundled);
  await file(root, directory + 'manifest.json', JSON.stringify(manifest));
  assert.equal((await verifyVendor({root})).status, 'pass');
  await file(root, directory + 'classic-engine.js', 'local {evil}');
  await assert.rejects(verifyVendor({root}), /VENDOR_HASH/);
  manifest.distributedFiles['classic-engine.js'] = sha256('local {evil}');
  await file(root, directory + 'manifest.json', JSON.stringify(manifest));
  await assert.rejects(verifyVendor({root}), /VENDOR_UPSTREAM/);
  manifest.reconstruction.segments[0].length = Number.MAX_SAFE_INTEGER;
  await file(root, directory + 'manifest.json', JSON.stringify(manifest));
  await assert.rejects(verifyVendor({root}), /VENDOR_SEGMENT/);
}));

test('asset gate rejects unlisted assets, disallowed licenses, absent notices and changed bytes', async () => fixture(async root => {
  await file(root, 'assets/icon.svg', '<svg/>');
  await file(root, 'LICENSE', 'Owned fixture permission text');
  await file(root, 'THIRD_PARTY_NOTICES.md', 'Owned fixture asset');
  const entry = {path: 'assets/icon.svg', sha256: sha256('<svg/>'), license: 'MIT',
    licenseFile: 'LICENSE', notice: 'Owned fixture asset', origin: 'generated fixture'};
  const policy = {schemaVersion: 1, allowed: ['MIT'], files: [entry]};
  assert.equal((await licenseGate({root, policy})).status, 'pass');
  await assert.rejects(licenseGate({root, policy: {...policy, allowed: []}}), /disallowed/);
  await assert.rejects(licenseGate({root, policy: {...policy, files: [{...entry, notice: 'absent'}]}}), /LICENSE_NOTICE/);
  await file(root, 'assets/font.woff2', 'owned fake font boundary fixture');
  await assert.rejects(licenseGate({root, policy}), /LICENSE_UNLISTED/);
  await rm(join(root, 'assets/font.woff2'));
  await file(root, 'assets/icon.svg', '<svg>changed</svg>');
  await assert.rejects(licenseGate({root, policy}), /LICENSE_HASH/);
}));

test('secret scanner detects constructed fake tokens and entropy without returning matched values', () => {
  const token = 'gh' + 'p_' + 'Ab12'.repeat(9);
  const findings = scanText('const value="' + token + '";', 'fixture.js');
  assert.equal(findings[0].rule, 'github-token');
  assert.equal(JSON.stringify(findings).includes(token), false);
  const randomLooking = 'xJ4rT8vN2sQ6wL9mH3bF7zC1';
  assert(scanText('client_' + 'secret = "' + randomLooking + '"', 'fixture').some(row => row.rule.includes('entropy')));
  assert.equal(scanText('sha256=' + 'ab1234'.repeat(11) + '\ncommit=' + 'a'.repeat(40), 'results.json').length, 0);
  assert.equal(entropy('aaaa'), 0);
});

test('secret scan covers a planted token in a separate fixture Git branch and built bundles', async () => fixture(async root => {
  await initialize(root);
  git(root, ['checkout', '-b', 'fake-token-regression']);
  const token = 'gh' + 'p_' + 'Z9ab'.repeat(9);
  await file(root, 'sample.js', 'const ownedFakeToken="' + token + '";');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'plant owned fake token']);
  assert.equal((await secretScan({root})).status, 'fail');
  await rm(join(root, 'sample.js'));
  await file(root, 'dist/bundle.js', 'const ownedFakeToken="' + token + '";');
  const result = await secretScan({root, built: ['dist']});
  assert.equal(result.status, 'fail');
  assert.equal(result.findings[0].path, 'dist/bundle.js');
}));

test('tree scans and reads enforce path, count, byte and cancellation boundaries', async () => fixture(async root => {
  await file(root, 'a', '12345');
  assert.throws(() => localPath(root, '../escape'), /SUPPLY_PATH/);
  assert.throws(() => localPath(root, '/absolute'), /SUPPLY_PATH/);
  await assert.rejects(boundedRead(join(root, 'a'), {maxBytes: 4}), /SUPPLY_FILE/);
  await assert.rejects(walkFiles(root, {maxFiles: 0}), /SUPPLY_LIMIT/);
  await assert.rejects(secretScan({root, maxTotalBytes: 4}), /SECRET_LIMIT/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(secretScan({root, signal: controller.signal}), {name: 'AbortError'});
  await assert.rejects(verifyVendor({root, signal: controller.signal}), {name: 'AbortError'});
  for (let index = 0; index < 100; index++) await file(root, 'many/' + index, 'payload');
  const during = new AbortController();
  const pending = secretScan({root, signal: during.signal});
  setImmediate(() => during.abort());
  await assert.rejects(pending, {name: 'AbortError'});
}));

test('build seal binds source revision and exact downloaded payload membership/content', async () => fixture(async root => {
  await initialize(root);
  await file(root, 'dist/index.html', '<html/>');
  await file(root, 'artifacts/SharpForge-standalone.html', '<html>standalone</html>');
  const manifest = await seal({root, kind: 'browser'});
  assert.deepEqual(await verifySeal({root, manifest}), manifest);
  await file(root, 'dist/extra.js', 'extra');
  await assert.rejects(verifySeal({root, manifest}), /SUPPLY_SEAL/);
  await rm(join(root, 'dist/extra.js'));
  await file(root, 'dist/index.html', 'tampered');
  await assert.rejects(verifySeal({root, manifest}), /SUPPLY_SEAL/);
  await assert.rejects(verifySeal({root, manifest: {...manifest, commit: 'a'.repeat(40)}}), /source revision/);
  await assert.rejects(payloadFiles(root, 'unknown'), /unknown kind/);
}));

test('attestation policy binds repository, signer workflow, source commit, tag and hosted runner', () => {
  const input = {file: 'artifacts/package.tgz', repositoryName: 'example/repository', sourceCommit: 'a'.repeat(40), sourceRef: 'refs/tags/v1.2.3'};
  const args = verificationArgs(input);
  assert(args.includes('--source-digest'));
  assert(args.includes('--deny-self-hosted-runners'));
  assert(args.includes('example/repository/.github/workflows/release.yml'));
  assert.throws(() => verificationArgs({...input, repositoryName: '--owner'}), /ATTESTATION_IDENTITY/);
  assert.throws(() => verificationArgs({...input, sourceRef: 'refs/heads/main'}), /ATTESTATION_IDENTITY/);
  assert.throws(() => verificationArgs({...input, sourceCommit: 'HEAD'}), /ATTESTATION_IDENTITY/);
});


test('secret scanner indexes large line sets, preserves leading placeholders and caps findings', () => {
  const token = 'gh' + 'p_' + 'Ab12'.repeat(9);
  assert.equal(scanText('\n'.repeat(10000) + token, 'large.js')[0].line, 10001);
  assert.throws(() => scanText(token + '\n' + token, 'limited.js', {maxFindings: 0}), /SECRET_LIMIT/);
  assert.throws(() => scanText('', 'invalid.js', {maxFindings: -1}), /SECRET_LIMIT/);
  assert.equal(scanText('secret="example' + 'Ab19Cd28Ef37Gh46Ij55' + '"', 'prefix.js').length, 1);
  assert.deepEqual(scanText(token, 'stable.js'), scanText(token, 'stable.js'));
});

test('SBOM inventories actual package/browser bytes and independently reconstructs vendor bodies', async () => fixture(async root => {
  await initialize(root);
  await file(root, 'package.json', JSON.stringify({name: 'owned-fixture', version: '1.0.0'}));
  await file(root, 'packages/editor/package.json', JSON.stringify({name: '@sharpforge/editor', version: '1.0.0', license: 'MIT'}));
  const directory = 'packages/editor/src/vendor/';
  await file(root, directory + 'classic-engine.js', 'owned body');
  await file(root, directory + 'manifest.json', JSON.stringify({name: 'Owned fixture', version: '1.0.0', license: 'MIT',
    distributedFiles: {'classic-engine.js': sha256('owned body')}, upstreamFiles: {'lib.js': sha256('owned body')},
    upstreamArchive: {url: 'https://example.invalid/owned-fixture.tgz', sha256: sha256('owned archive')},
    reconstruction: {format: 1, segments: [{upstream: 'lib.js', bundled: 'classic-engine.js',
      offset: 0, length: 10, prefix: '', suffix: ''}]}}));
  await file(root, 'dist/studio.js', 'owned source');
  await file(root, 'artifacts/SharpForge-standalone.html', 'owned HTML');
  await file(root, 'artifacts/SharpForge-browser.zip', 'owned archive fixture');
  await file(root, 'artifacts/sharpforge-editor-1.0.0.tgz', 'owned tarball fixture');
  const result = await sbom({root});
  assert.equal(result.metadata.properties[0].value, git(root, ['rev-parse', 'HEAD']));
  const byName = new Map(result.components.map(component => [component.name, component]));
  assert.equal(byName.get('dist/studio.js').hashes[0].content, sha256('owned source'));
  assert.equal(byName.get('Owned fixture').hashes[0].content, sha256('owned archive'));
  assert(byName.has('@sharpforge/editor'));
  assert(byName.has('artifacts/SharpForge-standalone.html'));
  assert(byName.has('artifacts/sharpforge-editor-1.0.0.tgz'));
  await file(root, 'artifacts/unlisted-1.0.tgz', 'unlisted owned fixture');
  await assert.rejects(sbom({root}), /package set mismatch/);
  await rm(join(root, 'artifacts/unlisted-1.0.tgz'));
  await rm(join(root, 'artifacts/SharpForge-browser.zip'));
  await assert.rejects(sbom({root}), /ENOENT/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(sbom({root, signal: controller.signal}), {name: 'AbortError'});
}));

test('attestation subjects bind exact payload bytes and reject changed commits before invoking gh', async () => fixture(async root => {
  await initialize(root);
  await file(root, 'artifacts/SharpForge-standalone.html', 'owned standalone fixture');
  const manifest = await releaseManifest(join(root, 'artifacts'), git(root, ['rev-parse', 'HEAD']));
  await file(root, 'artifacts/SOURCE-MANIFEST.json', JSON.stringify(manifest));
  await file(root, 'artifacts/SHA256SUMS', 'owned checksum fixture');
  await file(root, 'artifacts/SBOM.cdx.json', 'owned SBOM fixture');
  const subjects = await releaseSubjects({root});
  assert.equal(subjects.length, 4);
  assert.equal(subjects.find(subject => subject.path.endsWith('.html')).sha256, sha256('owned standalone fixture'));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(verifyAttestations({root, signal: controller.signal}), {name: 'AbortError'});
  await file(root, 'artifacts/SharpForge-standalone.html', 'tampered owned fixture');
  await assert.rejects(releaseSubjects({root}), /payload inventory/);
  await file(root, 'artifacts/SOURCE-MANIFEST.json', JSON.stringify({...manifest, commit: 'a'.repeat(40)}));
  await assert.rejects(releaseSubjects({root}), /ATTESTATION_COMMIT/);
}));
