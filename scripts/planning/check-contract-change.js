import { parseArgs } from 'node:util';
import { isDeepStrictEqual } from 'node:util';
import { isMain, git, report } from './lib/io.js';

// Proof of compatible extension. Unknown changes fail closed and need a bump.
export function additive(before, after, key = '') {
  if (isDeepStrictEqual(before, after)) return true;
  if (Array.isArray(before)) {
    if (!Array.isArray(after)) return false;
    if (key === 'required') return after.every(value => before.includes(value));
    return before.every((value, i) => isDeepStrictEqual(value, after[i]));
  }
  if (!before || typeof before !== 'object' || !after || typeof after !== 'object' || Array.isArray(after)) return false;
  if (!Object.keys(before).every(name => Object.hasOwn(after,name) && additive(before[name],after[name],name))) return false;
  for (const name of Object.keys(after).filter(name => !Object.hasOwn(before,name))) {
    if (name === 'required' && after[name].length) return false;
    // New validation keywords can narrow accepted values, unlike new properties.
    if (['minimum','maximum','pattern','enum','const','minItems','maxItems','minLength','maxLength','additionalProperties','oneOf','anyOf','type'].includes(name)) return false;
  }
  return true;
}

export function uniqueContractIds(value, path = '$') {
  const errors = [];
  if (Array.isArray(value)) {
    const ids = new Set();
    for (const entry of value) {
      if (entry && typeof entry === 'object' && Object.hasOwn(entry,'id')) {
        if (ids.has(entry.id)) errors.push(`${path}: duplicate contract id ${entry.id}`);
        ids.add(entry.id);
      }
      errors.push(...uniqueContractIds(entry,path));
    }
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (['Op','Binary','Unary'].includes(key) && new Set(Object.values(entry)).size !== Object.keys(entry).length) errors.push(`${path}.${key}: duplicate opcode id`);
      errors.push(...uniqueContractIds(entry,`${path}.${key}`));
    }
  }
  return errors;
}

export function contractComponent(path) {
  if (/framework|studio-automation/.test(path)) return 'framework';
  if (/bytecode|method-body/.test(path)) return 'bytecode';
  if (/value|handle|fault/.test(path)) return 'value';
  return 'metadata';
}

export function checkContractChange({ before, after, beforeVersions, afterVersions, labels=[] }) {
  const changes = [], errors = [];
  for(const [component,version] of Object.entries(afterVersions)) if(!Number.isSafeInteger(version)||version<1) errors.push(`${component}: invalid version`);
  for (const path of [...new Set([...Object.keys(before),...Object.keys(after)])].sort()) {
    if (after[path] !== undefined) errors.push(...uniqueContractIds(after[path],path));
    if (isDeepStrictEqual(before[path],after[path])) continue;
    const breaking = before[path] !== undefined && (after[path] === undefined || !additive(before[path],after[path]));
    const component = contractComponent(path); changes.push({path,component,breaking});
    if (breaking) {
      if (!labels.includes('contract-change')) errors.push(`${path}: non-additive change requires contract-change label`);
      if (!Number.isSafeInteger(beforeVersions[component]) || !Number.isSafeInteger(afterVersions[component]) || afterVersions[component] <= beforeVersions[component]) errors.push(`${path}: non-additive change requires ${component} version bump`);
    }
  }
  for (const [component, version] of Object.entries(beforeVersions)) if (!Number.isSafeInteger(afterVersions[component]) || afterVersions[component] < version) errors.push(`${component}: version removed, invalid or decreased`);
  return {changes,errors};
}

export function contractsAt(ref, root = process.cwd()) {
  const paths = git(['ls-tree','-r','--name-only',ref,'--','planning/contracts'],root).trim().split('\n').filter(path => /(?:\.lock|\.schema)\.json$/.test(path) || /^planning\/contracts\/schema\/[^/]+\.json$/.test(path));
  return Object.fromEntries(paths.map(path=>[path,JSON.parse(git(['show',`${ref}:${path}`],root))]));
}
if (isMain(import.meta.url)) {
  const {values} = parseArgs({options:{base:{type:'string',default:'origin/main'},head:{type:'string',default:'HEAD'},labels:{type:'string',default:''}}});
  const versions = ref => git(['ls-tree','--name-only',ref,'--','planning/contracts/versions.json']).trim() ? JSON.parse(git(['show',`${ref}:planning/contracts/versions.json`])) : {};
  report(checkContractChange({before:contractsAt(values.base),after:contractsAt(values.head),beforeVersions:versions(values.base),afterVersions:versions(values.head),labels:values.labels.split(',')}));
}
