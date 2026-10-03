import { lstat, writeFile, unlink } from 'node:fs/promises';
import { posix, join } from 'node:path';
import { ARCHIVE, MANIFEST, SUMS, destination, digest, git, regularBytes } from './inventory.js';
import { verifyPublished } from './release.js';

export const INDEX = 'docs/historical-evidence.md';

/** The index distinguishes the captured source snapshot from every report's original tested revision. */
export function renderIndex(manifest) {
  const base = destination(manifest.repository, manifest.tag);
  const lines = [
    '# Historical validation evidence', '',
    'These files retain the exact bytes previously tracked in `docs/`. Their filenames, environment descriptions,',
    'test counts and embedded source references are historical records. Archiving does not rerun or qualify any engine or platform.', '',
    `Captured snapshot: [${manifest.snapshotCommit}](https://github.com/${manifest.repository}/tree/${manifest.snapshotCommit}).`,
    'This snapshot identifies the archived bytes, not the revision originally tested by each report.',
    'Original tested revisions are not inferred where the retained report does not identify one.', '',
    `[Complete ZIP](${base}/${ARCHIVE}) · [Provenance and file digests](${base}/${MANIFEST}) · [SHA-256 checksums](${base}/${SUMS})`, '',
    'The ZIP preserves original `docs/` paths and relative references between reports. Downloaded JSON is left unchanged.',
    'The provenance manifest retains archived asset license declarations and their original source-policy pin.',
    'New runs write to `artifacts/results/` (or the configured results directory), not this historical archive.', '',
    '| Original path | Release asset | Bytes |', '| --- | --- | ---: |',
  ];
  for (const file of manifest.files) lines.push(`| \`${file.path}\` | [${file.asset}](${file.url}) | ${file.bytes} |`);
  lines.push('', 'Authored references retained in this directory:', '');
  for (const item of manifest.preserved) lines.push(`- [${posix.basename(item.path)}](${posix.basename(item.path)}): ${item.reason}`);
  return lines.join('\n') + '\n';
}

/** Rewrite existing local Markdown links; retain historical prose and filename mentions with an index notice. */
export function rewriteMarkdown(text, path, manifest) {
  const files = new Map(manifest.files.map(file => [file.path, file]));
  let relevant = false;
  let result = text.replace(/(\]\()([^\s()]+)(\))/g, (match, prefix, target, suffix) => {
    if (/^[a-z]+:/i.test(target) || target.startsWith('#')) return match;
    const [local, fragment] = target.split('#');
    const key = posix.normalize(posix.join(posix.dirname(path), local));
    const intended = local.replace(/^(?:\.\.?\/)+/, '');
    if (key.startsWith('../') && files.has(intended)) {
      throw new Error(`Evidence link escapes repository: ${path} -> ${target}`);
    }
    const file = files.get(key);
    if (!file) return match;
    relevant = true;
    return `${prefix}${file.url}${fragment === undefined ? '' : '#' + fragment}${suffix}`;
  });
  for (const file of manifest.files) {
    if (text.includes(file.path) || path.startsWith('docs/') && text.includes(file.asset)) relevant = true;
  }
  if (relevant) {
    const index = posix.relative(posix.dirname(path), INDEX);
    result += `\nHistorical generated reports referenced here are retained in the [release evidence index](${index}).\n`;
  }
  return result;
}

async function absent(path) {
  try {
    await lstat(path);
    throw new Error(`Refusing to overwrite existing index: ${path}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function licenseRewrite(root, manifest) {
  const archived = manifest.licensePolicy;
  if (!archived?.declarations.length) return [];
  const bytes = await regularBytes(root, archived.path);
  const policy = JSON.parse(bytes);
  if (!Array.isArray(policy.files)) throw new Error('Invalid current license policy');
  const selected = new Set(archived.declarations.map(entry => entry.path));
  const removed = policy.files.filter(entry => selected.has(entry.path));
  if (JSON.stringify(removed) !== JSON.stringify(archived.declarations)) throw new Error('Archived license declarations changed');
  const updated = { ...policy, files: policy.files.filter(entry => !selected.has(entry.path)) };
  return [{ path: archived.path, beforeSha256: digest(bytes), content: JSON.stringify(updated, null, 2) + '\n' }];
}

/** Produce reviewable removals and Markdown/license-policy replacements without changing source files. */
export async function migrationPlan(root, manifest) {
  await absent(join(root, INDEX));
  for (const file of manifest.files) {
    const bytes = await regularBytes(root, file.path);
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error(`Working evidence differs: ${file.path}`);
  }
  const paths = git(root, ['ls-files', '-z', '--', '*.md']).toString().split('\0').filter(Boolean).sort();
  if (paths.length > 4096) throw new Error('Markdown inventory limit exceeded');
  let total = 0;
  const rewrites = await licenseRewrite(root, manifest);
  for (const path of paths) {
    const bytes = await regularBytes(root, path, 2 * 1024 * 1024);
    if ((total += bytes.length) > 32 * 1024 * 1024) throw new Error('Markdown size limit exceeded');
    const before = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const content = rewriteMarkdown(before, path, manifest);
    if (content !== before) rewrites.push({ path, beforeSha256: digest(bytes), content });
  }
  return {
    schemaVersion: 1, snapshotCommit: manifest.snapshotCommit,
    removals: manifest.files.map(({ path, sha256 }) => ({ path, sha256 })),
    rewrites, index: { path: INDEX, content: renderIndex(manifest) },
    unchanged: ['Original report contents inside release assets', 'Historical golden-output locks', 'Authored schemas and prose claims'],
  };
}

/** Compare staged proposals, then verify all remote bytes immediately before any local write or removal. */
export async function migrate(root, stage, proposed, options = {}) {
  const current = await migrationPlan(root, stage.manifest);
  if (JSON.stringify(current) !== JSON.stringify(proposed)) throw new Error('Migration proposal differs; prepare again for review');
  const receipt = await verifyPublished(stage, options);
  // Recheck after the network round trip so an intervening local edit cannot be discarded.
  const checked = await migrationPlan(root, stage.manifest);
  if (JSON.stringify(checked) !== JSON.stringify(proposed)) throw new Error('Files changed while verifying release assets');
  options.signal?.throwIfAborted();
  await writeFile(join(root, INDEX), proposed.index.content, { flag: 'wx' });
  for (const change of proposed.rewrites) {
    options.signal?.throwIfAborted();
    const bytes = await regularBytes(root, change.path, 2 * 1024 * 1024);
    if (digest(bytes) !== change.beforeSha256) throw new Error(`File changed during migration: ${change.path}`);
    await writeFile(join(root, change.path), change.content);
  }
  for (const file of proposed.removals) {
    options.signal?.throwIfAborted();
    if (digest(await regularBytes(root, file.path)) !== file.sha256) throw new Error(`Evidence changed during migration: ${file.path}`);
    await unlink(join(root, file.path));
  }
  return receipt;
}
