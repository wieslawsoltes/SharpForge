import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {checkoutIdentity, hashFile, readBuildIdentity, sha256} from '../conformance/build-identity.js';
import {connectOrigins, hostedHtml} from '../conformance/security/csp.js';
import {files} from '../conformance/repro/common.js';

export function requireExactSource(source, driver) {
  if (!source?.clean || !driver?.clean || !/^[a-f0-9]{40}$/.test(source.commit ?? '')
    || !/^[a-f0-9]{40}$/.test(source.tree ?? '') || source.commit !== driver.commit || source.tree !== driver.tree) {
    throw new Error('Exact-source capture requires a clean driver checkout and completed production build at the same revision/tree');
  }
}

export async function prepareIdentity(root, directory = resolve(process.env.SERVE_ROOT ?? join(root, 'dist'))) {
  const driver = checkoutIdentity(root), local = await readBuildIdentity(root, directory);
  const names = ['scripts/bench-workbench-overhead.js', 'scripts/editor-benchmarks/browser.js',
    'scripts/editor-benchmarks/common.js', 'scripts/conformance/build-identity.js',
    'scripts/conformance/security/csp.js', 'scripts/conformance/repro/common.js', 'scripts/serve.js',
    ...(await files(join(root, 'scripts/workbench-overhead'))).map(path => 'scripts/workbench-overhead/' + path)];
  const harness = [];
  for (const path of names.sort()) harness.push({path, ...await hashFile(join(root, path))});
  return {directory, local, report: {driver, source: local.manifest.source,
    harness: {sha256: sha256(JSON.stringify(harness)), files: harness},
    artifact: {manifestSha256: local.sha256, assetsSha256: local.manifest.assetsSha256,
      assetCount: local.manifest.assets.length, stable: local.manifest.stable}, served: []}};
}

async function fetchedHash(url, expectedBytes, signal) {
  const response = await fetch(url, {signal, redirect: 'error', cache: 'no-store'});
  if (!response.ok || !response.body) throw new Error('Cannot verify served asset: ' + url);
  const digest = createHash('sha256');
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > expectedBytes) throw new Error('Served asset length mismatch: ' + url);
    digest.update(chunk);
  }
  return {bytes, sha256: digest.digest('hex')};
}

/** Verify outside timed spans. HTML uses exactly the production server's documented CSP transformation. */
export async function verifyServedIdentity(identity, url, phase, {allowedOrigins = connectOrigins(process.env.SHARPFORGE_CONNECT_ORIGINS),
  signal = AbortSignal.timeout(120000)} = {}) {
  const location = new URL(url);
  if (location.search || location.hash || location.username || location.password
    || !(location.pathname.endsWith('/') || location.pathname.endsWith('/index.html'))) {
    throw new Error('Artifact identity requires a plain production index URL');
  }
  const base = new URL('.', location), rows = [], local = identity.local;
  const record = {phase, url: location.href, matched: false, expectedManifestSha256: local.sha256, assets: rows};
  identity.report.served.push(record);
  try {
    for (const asset of local.manifest.assets) {
      let expected = asset;
      if (asset.path.endsWith('.html')) {
        const original = await readFile(join(identity.directory, asset.path));
        if (original.length !== asset.bytes || sha256(original) !== asset.sha256) throw new Error('Local HTML changed after build verification');
        const bytes = Buffer.from(hostedHtml(original.toString('utf8'), {allowedOrigins}).body);
        expected = {bytes: bytes.length, sha256: sha256(bytes)};
      }
      const target = new URL(asset.path.split('/').map(encodeURIComponent).join('/'), base);
      const actual = await fetchedHash(target, expected.bytes, signal);
      rows.push({path: asset.path, ...actual});
      if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
        throw new Error('Served production asset differs from completed local build: ' + asset.path);
      }
    }
    record.assetsSha256 = sha256(JSON.stringify(rows));
    record.matched = true;
    return record;
  } catch (error) { record.error = error.message; throw error; }
}
