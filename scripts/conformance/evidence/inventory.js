import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { writeZip, readZip } from '../../../packages/archive/src/index.js';

export const LIMITS = Object.freeze({
  maxEntries: 256, maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024, maxArchiveBytes: 40 * 1024 * 1024,
});
export const MANIFEST = 'HISTORICAL-EVIDENCE.json';
export const ARCHIVE = 'historical-evidence.zip';
export const SUMS = 'SHA256SUMS';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

/** Git plumbing reads committed bytes only; never executes repository hooks or a shell. */
export function git(root, args, maxBuffer = LIMITS.maxFileBytes) {
  const result = spawnSync('git', ['--no-replace-objects', ...args], { cwd: root, maxBuffer, timeout: 30000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr.toString());
  return result.stdout;
}

export function destination(repository, tag) {
  if (!/^[a-zA-Z0-9][\w.-]{0,99}\/[a-zA-Z0-9][\w.-]{0,99}$/.test(repository)) throw new Error('Invalid repository');
  if (!/^evidence-archive-[a-zA-Z0-9._-]{1,80}$/.test(tag)) throw new Error('Use a non-version evidence-archive-* tag');
  return `https://github.com/${repository}/releases/download/${tag}`;
}

export function evidencePath(path) {
  if (!/^docs\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:json|tap|txt|dll)$/.test(path) || path.includes('..')) {
    throw new Error(`Invalid evidence path: ${path}`);
  }
  return path;
}

/** The reviewed allowlist deliberately excludes authored schemas, prose and illustration assets. */
export function validatePolicy(policy) {
  if (policy?.schemaVersion !== 1 || !Array.isArray(policy.paths) || !policy.paths.length ||
      policy.paths.length > LIMITS.maxEntries - 1 || !Array.isArray(policy.preserved)) throw new Error('Invalid archival policy');
  const names = new Set();
  for (const path of [...policy.paths, ...policy.preserved.map(item => item.path)]) {
    evidencePath(path);
    if (names.has(path.toLowerCase())) throw new Error(`Duplicate archival path: ${path}`);
    names.add(path.toLowerCase());
  }
  for (const item of policy.preserved) if (!item.reason?.trim()) throw new Error('Preservation requires a reason');
}

function licenseProvenance(root, commit, files) {
  const path = 'planning/qualification/supply/licenses.json';
  const tree = git(root, ['ls-tree', commit, '--', path]).toString().trim();
  if (!tree) return null;
  const match = tree.match(/^100644 blob ([a-f0-9]{40})\t(.+)$/);
  if (!match || match[2] !== path) throw new Error('Non-regular license policy');
  const bytes = git(root, ['cat-file', 'blob', match[1]]);
  const policy = JSON.parse(bytes);
  if (!Array.isArray(policy.files)) throw new Error('Invalid license inventory');
  const archived = new Map(files.map(file => [file.path, file]));
  const declarations = policy.files.filter(entry => archived.has(entry.path));
  for (const entry of declarations) {
    if (entry.sha256 !== archived.get(entry.path).sha256) throw new Error(`License digest differs: ${entry.path}`);
  }
  return { path, blob: match[1], sha256: digest(bytes), declarations };
}

/** Capture an explicit committed snapshot without inventing the original test revision or rerunning reports. */
export function capture(root, policy, options) {
  validatePolicy(policy);
  const download = destination(options.repository, options.tag);
  if (!/^[a-f0-9]{40}$/.test(options.commit)) throw new Error('An exact 40-character source commit is required');
  const commit = git(root, ['rev-parse', '--verify', `${options.commit}^{commit}`]).toString().trim();
  if (commit !== options.commit) throw new Error('Source commit differs');
  const reviewed = new Set([...policy.paths, ...policy.preserved.map(item => item.path)]);
  const candidates = git(root, ['ls-tree', '-r', '--name-only', commit, '--', 'docs']).toString().trim().split('\n');
  for (const path of candidates) {
    if (/\.(?:json|tap|txt|dll)$/.test(path) && !reviewed.has(path)) throw new Error(`Unreviewed docs data: ${path}`);
  }
  let total = 0;
  const files = [];
  const payloads = new Map();
  for (const path of [...policy.paths].sort()) {
    const tree = git(root, ['ls-tree', commit, '--', path]).toString().trim();
    const match = tree.match(/^100644 blob ([a-f0-9]{40})\t(.+)$/);
    if (!match || match[2] !== path) throw new Error(`Missing or non-regular committed evidence: ${path}`);
    const bytes = git(root, ['cat-file', 'blob', match[1]]);
    if (bytes.length > LIMITS.maxFileBytes || (total += bytes.length) > LIMITS.maxTotalBytes) throw new Error('Evidence size limit exceeded');
    const asset = basename(path);
    files.push({ path, asset, blob: match[1], bytes: bytes.length, sha256: digest(bytes), url: `${download}/${asset}` });
    payloads.set(asset, bytes);
  }
  const manifest = {
    schemaVersion: 1, kind: 'historical-evidence-archive', repository: options.repository, tag: options.tag,
    snapshotCommit: commit, algorithm: 'SHA256', policySha256: digest(jsonBytes(policy)),
    provenance: 'Bytes retained from this Git snapshot. Filenames and embedded claims are historical, not new qualification.',
    originalTestedRevision: 'Not inferred. Consult each original report; archival snapshotCommit is not its tested revision.',
    preserved: policy.preserved, licensePolicy: licenseProvenance(root, commit, files), files,
  };
  payloads.set(MANIFEST, jsonBytes(manifest));
  payloads.set(ARCHIVE, Buffer.from(writeZip([
    ...files.map(file => ({ path: file.path, bytes: payloads.get(file.asset) })),
    { path: MANIFEST, bytes: payloads.get(MANIFEST) },
  ], LIMITS)));
  payloads.set(SUMS, Buffer.from([...payloads].sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([name, bytes]) => `${digest(bytes)}  ${name}`).join('\n') + '\n'));
  return { manifest, payloads };
}

/** Bound local reads and reject links before following any path from a manifest. */
export async function regularBytes(root, path, maxBytes = LIMITS.maxFileBytes) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || /[\\:\x00-\x1f]/.test(path)) {
    throw new Error('Unsafe local evidence path');
  }
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe local evidence path');
  for (let length = 1; length < parts.length; length++) {
    if (!(await lstat(join(root, ...parts.slice(0, length)))).isDirectory()) throw new Error('Non-directory evidence ancestor');
  }
  const target = resolve(root, ...parts);
  const info = await lstat(target);
  if (!info.isFile() || info.size > maxBytes) throw new Error(`Non-regular or oversized evidence: ${path}`);
  const bytes = await readFile(target);
  if (bytes.length > maxBytes) throw new Error(`Evidence grew past limit: ${path}`);
  return bytes;
}

/** Validate staged payloads against a fresh reconstruction from committed source and the reviewed policy. */
export async function loadStage(root, directory, policy) {
  const document = JSON.parse(await regularBytes(directory, MANIFEST));
  const expected = capture(root, policy, {
    repository: document.repository, tag: document.tag, commit: document.snapshotCommit,
  });
  for (const [name, bytes] of expected.payloads) {
    const actual = await regularBytes(directory, name, LIMITS.maxArchiveBytes);
    if (!bytes.equals(actual)) throw new Error(`Staged asset differs from committed evidence: ${name}`);
  }
  const entries = readZip(expected.payloads.get(ARCHIVE), LIMITS);
  if (entries.length !== expected.manifest.files.length + 1) throw new Error('Archive inventory differs');
  return expected;
}
