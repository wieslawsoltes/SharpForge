import { parseArgs } from 'node:util';
import { readJSON, git, isMain, report } from './lib/io.js';
export function checkHotFiles(changes, locks, held = []) {
  const errors = [];
  for (const [key, paths] of Object.entries(locks)) for (const path of paths.filter(p => !p.includes('*'))) {
    if (!changes[path] || held.includes(key)) continue;
    const { before, after } = changes[path], lines = text => text === '' ? 0 : text.split('\n').length;
    if (lines(after) > lines(before) || Buffer.byteLength(after) - Buffer.byteLength(before) > 2048) errors.push(`${path}: growth requires ${key}`);
  }
  return { errors };
}
if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { base: { type: 'string', default: 'origin/main' }, locks: { type: 'string', default: '' } } });
  const locks = readJSON('planning/contracts/locks.json'), changes = {};
  for (const path of git(['diff', '--name-only', '-z', `${values.base}...HEAD`]).split('\0').filter(Boolean)) {
    const read = ref => { try { return git(['show', `${ref}:${path}`]); } catch { return ''; } };
    changes[path] = { before: read(values.base), after: read('HEAD') };
  }
  report(checkHotFiles(changes, locks, values.locks.split(',').filter(Boolean)));
}
