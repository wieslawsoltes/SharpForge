import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { boundedRead, readJSON, repository } from '../supply/files.js';

const numeric = '(?:0|[1-9][0-9]*)';
const versionPattern = new RegExp(`^(${numeric})\\.(${numeric})\\.(${numeric})(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$`);

export function releaseVersion(tag) {
  if (typeof tag !== 'string' || tag.length > 128 || !tag.startsWith('v')) throw new Error('Release tag must be v<semver>');
  const version = tag.slice(1);
  const match = version.match(versionPattern);
  if (!match || match.slice(1, 4).some((part) => !Number.isSafeInteger(Number(part)))) {
    throw new Error('Malformed or oversized semantic version');
  }
  if (match[4]?.split('.').some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
    throw new Error('Numeric prerelease identifiers must not have leading zeros');
  }
  return { tag, version, channel: match[4] ? 'preview' : 'stable', prerelease: !!match[4] };
}

/** Require the release tag, root, every workspace package and a nonempty changelog section to agree. */
export async function checkVersions({ root = repository, tag = process.env.GITHUB_REF_NAME, signal } = {}) {
  const release = releaseVersion(tag);
  const pkg = await readJSON(resolve(root, 'package.json'), { root, signal });
  if (JSON.stringify(pkg.workspaces) !== JSON.stringify(['packages/*'])) throw new Error('Unexpected workspace declaration');
  if (pkg.version !== release.version) throw new Error('Root package version differs from release tag');
  const entries = await readdir(resolve(root, 'packages'), { withFileTypes: true });
  const packages = [];
  const names = new Set();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    signal?.throwIfAborted();
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Workspace must be a real package directory');
    const path = `packages/${entry.name}/package.json`;
    const workspace = await readJSON(resolve(root, path), { root, signal });
    if (!workspace.name?.startsWith('@sharpforge/') || names.has(workspace.name)) throw new Error('Invalid workspace name');
    if (workspace.version !== release.version) throw new Error('Workspace version differs from tag: ' + path);
    names.add(workspace.name);
    packages.push({ path, name: workspace.name, version: workspace.version });
  }
  if (!packages.length) throw new Error('Release requires at least one workspace package');
  const changelog = (await boundedRead(resolve(root, 'CHANGELOG.md'), { root, signal })).toString('utf8');
  const lines = changelog.split(/\r?\n/);
  const headings = lines.map((line, index) => ({ line, index })).filter(({ line }) => /^#{1,2} /.test(line));
  const escaped = release.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^#{1,2} (?:\\[${escaped}\\]|${escaped})(?:$|\\s+[—–-]\\s+)`);
  const matching = headings.filter(({ line }) => pattern.test(line));
  if (matching.length !== 1) throw new Error('Changelog must have exactly one section for the release version');
  const start = matching[0].index;
  const end = headings.find(({ index }) => index > start)?.index ?? lines.length;
  if (!lines.slice(start + 1, end).join('\n').trim()) throw new Error('Release changelog section is empty');
  const semverHeading = /^#{1,2} \[?v?(\d+\.\d+\.\d+(?:-[\w.-]+)?)/;
  for (const heading of headings) {
    const declared = heading.line.match(semverHeading)?.[1];
    if (!declared) continue;
    const numbers = declared.split('-')[0].split('.').map(Number);
    const current = release.version.split('-')[0].split('.').map(Number);
    for (let index = 0; index < 3; index++) {
      if (numbers[index] > current[index]) throw new Error('Tag predates a later changelog version');
      if (numbers[index] < current[index]) break;
    }
  }
  return { schemaVersion: 1, ...release, packages };
}
