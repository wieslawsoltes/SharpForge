import { parseArgs } from 'node:util';
import { matches, safePath } from './lib/paths.js';
import { readJSON, git, isMain, report } from './lib/io.js';
export function checkOwnership({ files, area, ownership, exceptions, lockRegistry, heldLocks = [] }) {
  if (!ownership.areas[area]) throw new Error(`Unknown area: ${area}`);
  files = files.map(safePath); const errors = [];
  for (const key of heldLocks) if (!lockRegistry[key]) errors.push(`Unknown held lock: ${key}`);
  const docsOnly = files.length > 0 && files.every(path => matches(path, exceptions.docsOnly));
  const generated = [...exceptions.generated, ...exceptions.areaGenerated.map(p => p.replace('{area}', area))];
  for (const path of files) {
    const required = Object.entries(lockRegistry).filter(([, globs]) => matches(path, globs)).map(([key]) => key);
    if (required.length) { if (!required.some(key => heldLocks.includes(key))) errors.push(`${path}: requires lock ${required.join(' or ')}`); continue; }
    if (docsOnly || matches(path, [...ownership.areas[area].write, ...ownership.areas[area].evidence, ...generated]) || heldLocks.some(key => matches(path, lockRegistry[key] ?? []))) continue;
    errors.push(`${path}: outside ${area} ownership`);
  }
  return { area, files, errors };
}
if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { area: { type: 'string' }, base: { type: 'string', default: 'origin/main' }, locks: { type: 'string', default: '' } } });
  report(checkOwnership({ area: values.area, files: git(['diff', '--name-only', '-z', `${values.base}...HEAD`]).split('\0').filter(Boolean), ownership: readJSON('planning/contracts/ownership.json'), exceptions: readJSON('planning/contracts/ownership-exceptions.json'), lockRegistry: readJSON('planning/contracts/locks.json'), heldLocks: values.locks.split(',').filter(Boolean) }));
}
