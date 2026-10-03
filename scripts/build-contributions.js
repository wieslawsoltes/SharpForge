import {readFile, readdir, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {safePath} from './planning/lib/paths.js';
export const buildRoot = fileURLToPath(new URL('../', import.meta.url));
const keys = (value, allowed, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: expected object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label}: unknown field ${key}`);
};
export async function loadBuildContributions(root = buildRoot) {
  const paths = ['apps/studio/build.contrib.json'];
  for (const entry of (await readdir(resolve(root, 'packages'), {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      const path = `packages/${entry.name}/build.contrib.json`;
      try {await stat(resolve(root, path)); paths.push(path);} catch (error) {if (error.code !== 'ENOENT') throw error;}
    }
  }
  const result = {styles: [], workers: [], assets: []};
  for (const path of paths) {
    const contribution = JSON.parse(await readFile(resolve(root, path), 'utf8'));
    keys(contribution, ['schemaVersion', 'styles', 'workers', 'assets'], path);
    if (contribution.schemaVersion !== 1) throw new Error(`${path}: unsupported build contribution version`);
    for (const kind of Object.keys(result)) {
      if (!Array.isArray(contribution[kind])) throw new Error(`${path}: ${kind} must be an array`);
      for (const item of contribution[kind]) {
        keys(item, kind === 'styles' ? ['source', 'order'] : kind === 'workers' ? ['entry', 'order'] : ['source', 'target', 'order'], path);
        if (!Number.isSafeInteger(item.order) || item.order < 0) throw new Error(`${path}: invalid ${kind} order`);
        for (const field of kind === 'workers' ? ['entry'] : kind === 'assets' ? ['source', 'target'] : ['source']) {
          if (typeof item[field] !== 'string' || safePath(item[field]) !== item[field]) throw new Error(`${path}: invalid ${field}`);
        }
        if (kind === 'workers' && !item.entry.endsWith('.js')) throw new Error(`${path}: worker must be JavaScript`);
        if (kind !== 'workers') {
          const source = await stat(resolve(root, item.source)).catch(error => {throw new Error(`${path}: missing source ${item.source}: ${error.message}`);});
          if (kind === 'styles' && !source.isFile()) throw new Error(`${path}: stylesheet is not a file: ${item.source}`);
        }
        result[kind].push({...item, contribution: path});
      }
    }
  }
  for (const [kind, items] of Object.entries(result)) {
    items.sort((a, b) => a.order - b.order || a.contribution.localeCompare(b.contribution) || (a.source ?? a.entry).localeCompare(b.source ?? b.entry));
    const seen = new Set();
    for (const item of items) {
      const key = kind === 'assets' ? item.target : kind === 'workers' ? item.entry : item.source;
      if (seen.has(key)) throw new Error(`Duplicate ${kind} contribution: ${key}`);
      seen.add(key);
    }
  }
  return result;
}
