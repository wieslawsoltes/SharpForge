import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { parseNuGetConfiguration } from './config.js';

export async function readNuGetConfiguration(directory, { inheritedFiles = [] } = {}) {
  const ancestors = [];
  let current = resolve(directory);
  for (let depth = 0; depth < 128; depth++) {
    ancestors.unshift(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const paths = [...inheritedFiles];
  for (const ancestor of ancestors) {
    const names = await readdir(ancestor);
    for (const name of names.filter(value => value.toLowerCase() === 'nuget.config').sort()) paths.push(join(ancestor, name));
  }
  const records = [];
  for (const path of [...new Set(paths)]) {
    try { records.push({ path, text: await readFile(path, 'utf8') }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return parseNuGetConfiguration(records);
}
