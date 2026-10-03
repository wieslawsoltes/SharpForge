import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstat, readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const repository = fileURLToPath(new URL('../../../', import.meta.url));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const isMain = url => process.argv[1] && fileURLToPath(url) === resolve(process.argv[1]);

/** Resolve a portable repository-relative path; traversal and absolute paths fail. */
export function localPath(root, name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || isAbsolute(name) || name.includes('\0')) {
    throw new Error('SUPPLY_PATH: expected a portable relative path');
  }
  const result = resolve(root, name);
  const rel = relative(resolve(root), result);
  if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('SUPPLY_PATH: path escapes root');
  return result;
}

/** Read a regular file with a size limit, rejecting symlinks and cancellation. */
export async function boundedRead(path, {signal, maxBytes = 64 * 1024 * 1024} = {}) {
  signal?.throwIfAborted();
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) throw new Error('SUPPLY_FILE: invalid or oversized file');
  return readFile(path, {signal});
}

export async function readJSON(path, options) {
  return JSON.parse(await boundedRead(path, options));
}

export async function writeJSON(path, value) {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}

export function commit(root = repository) {
  return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8', timeout: 30000}).trim();
}

/** Deterministic bounded traversal. Ignore administrative/build roots only when requested. */
export async function walkFiles(root, {signal, exclude = [], maxFiles = 30000} = {}) {
  const files = [];
  const ignored = new Set(exclude);
  async function visit(directory, prefix) {
    signal?.throwIfAborted();
    for (const entry of (await readdir(directory, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const name = prefix ? prefix + '/' + entry.name : entry.name;
      if (ignored.has(name)) continue;
      if (entry.isSymbolicLink()) throw new Error('SUPPLY_SYMLINK: ' + name);
      if (entry.isDirectory()) await visit(resolve(directory, entry.name), name);
      else if (entry.isFile()) files.push(name);
      else throw new Error('SUPPLY_FILE: unsupported entry ' + name);
      if (files.length > maxFiles) throw new Error('SUPPLY_LIMIT: too many files');
      if (files.length % 32 === 0) await new Promise(resolve => setImmediate(resolve));
    }
  }
  await visit(root, '');
  return files;
}

export const sourceExclusions = ['.git', 'node_modules', 'dist', 'artifacts'];
