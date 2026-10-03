import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { temporary, revision, writeJSON, isMain, hash } from './common.js';
import { extractSource, sourceTree, verifySource } from './source.js';
import { vendorCache } from './cache.js';
import { verifyManifest } from '../source-manifest.js';

export async function download(
  url,
  { token, limit = 512 * 1024 * 1024, accept = 'application/octet-stream', fetcher = fetch } = {},
) {
  const response = await fetcher(url, {
    headers: { Accept: accept, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('Download exceeds size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function prepare({
  root = process.cwd(),
  tag,
  output = 'artifacts/repro-inputs',
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GH_TOKEN,
} = {}) {
  root = resolve(root);
  output = resolve(output);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('Expected GitHub owner/repository');
  if (tag && !/^v[0-9][\w.+-]*$/.test(tag)) throw new Error('Expected version tag');
  const source = await revision(root, tag ? `refs/tags/${tag}` : 'HEAD'),
    api = `https://api.github.com/repos/${repository}`;
  await mkdir(output, { recursive: false });
  const archive = join(output, 'source.zip'),
    bytes = await download(`${api}/zipball/${source.commit}`, { token, accept: 'application/vnd.github+json' });
  verifySource(bytes, await sourceTree(root, source.commit));
  await writeFile(archive, bytes);
  await temporary(async (directory) => {
    const tree = join(directory, 'source');
    await extractSource({ archive, root, commit: source.commit, destination: tree });
    await vendorCache({ root: tree, output: join(output, 'vendored-cache') });
  });
  if (tag) {
    const release = JSON.parse(
      await download(`${api}/releases/tags/${encodeURIComponent(tag)}`, {
        token,
        accept: 'application/vnd.github+json',
        limit: 10 * 1024 * 1024,
      }),
    );
    const assets = join(output, 'release-assets');
    await mkdir(assets);
    const get = async (name) => {
      const matches = release.assets.filter((asset) => asset.name === name);
      if (matches.length !== 1) throw new Error(`Missing or duplicate release asset: ${name}`);
      const data = await download(`${api}/releases/assets/${matches[0].id}`, { token });
      await writeFile(join(assets, name), data);
      return data;
    };
    const manifest = JSON.parse(await get('SOURCE-MANIFEST.json'));
    if (manifest.commit !== source.commit || !Array.isArray(manifest.files) || !manifest.files.length)
      throw new Error('Release assets are not bound to the requested tag commit');
    const seen = new Set();
    for (const file of manifest.files) {
      if (!/^[\w.+-]+\.(?:zip|tgz|html)$/.test(file.path) || seen.has(file.path))
        throw new Error('Unsafe or duplicate release asset filename');
      seen.add(file.path);
      await get(file.path);
    }
    await verifyManifest(assets, manifest);
  }
  const result = {
    schemaVersion: 1,
    commit: source.commit,
    epoch: source.epoch,
    sourceArchiveSha256: hash(bytes),
    tag: tag ?? null,
    releaseAssets: !!tag,
  };
  await writeJSON(join(output, 'provenance.json'), result);
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `commit=${source.commit}\nepoch=${source.epoch}\nrelease=${!!tag}\n`,
    );
  return result;
}
if (isMain(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: '.' },
      tag: { type: 'string' },
      output: { type: 'string', default: 'artifacts/repro-inputs' },
    },
  });
  console.log(JSON.stringify(await prepare(values)));
}
