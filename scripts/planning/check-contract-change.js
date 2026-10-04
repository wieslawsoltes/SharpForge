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

function additiveStringPatternUnion(before, after, annotations) {
  const stringPattern = schema => {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema) ||
      schema.type !== 'string' || typeof schema.pattern !== 'string' ||
      !Object.keys(schema).every(key => key === 'type' || key === 'pattern' || annotations.has(key))) return false;
    try { new RegExp(schema.pattern, 'u'); } catch { return false; }
    return true;
  };
  // Preserve the complete predicate as one union branch. Restrict every branch
  // to string patterns: relocating references or adding constraints is not a proof.
  return stringPattern(before) &&
    Object.keys(after).every(key => key === 'anyOf' || annotations.has(key)) &&
    Array.isArray(after.anyOf) && after.anyOf.every(stringPattern) &&
    after.anyOf.some(branch => isDeepStrictEqual(before, branch));
}

// A deliberately conservative schema proof: unknown validation keywords and
// conjunction/exclusive-union extensions may narrow acceptance and need a bump.
export function additiveSchema(before,after) {
  if(isDeepStrictEqual(before,after))return true;
  if(before===false)return true;
  if(!before||!after||typeof before!=='object'||typeof after!=='object'||Array.isArray(before)||Array.isArray(after))return false;
  const annotation=new Set(['title','description','$comment','examples']);
  if(additiveStringPatternUnion(before,after,annotation))return true;
  for(const [name,value] of Object.entries(before)){
    if(annotation.has(name))continue;
    if(!Object.hasOwn(after,name))return false;
    if(isDeepStrictEqual(value,after[name]))continue;
    if(name==='required') {if(!Array.isArray(after[name])||!after[name].every(v=>value.includes(v)))return false;}
    else if(name==='enum'||name==='anyOf') {if(!Array.isArray(after[name])||!value.every(v=>after[name].some(w=>isDeepStrictEqual(v,w))))return false;}
    else if(name==='properties'||name==='$defs') {
      if(!after[name]||typeof after[name]!=='object'||Array.isArray(after[name]))return false;
      if(!Object.keys(value).every(k=>Object.hasOwn(after[name],k)&&additiveSchema(value[k],after[name][k])))return false;
      if(name==='properties'&&before.additionalProperties!==false&&Object.keys(after[name]).some(k=>!Object.hasOwn(value,k)))return false;
    }else return false;
  }
  for(const name of Object.keys(after).filter(name=>!Object.hasOwn(before,name))) {
    if(annotation.has(name)||name==='$defs')continue;
    if(name==='properties'&&before.additionalProperties===false)continue;
    if(name==='required'&&Array.isArray(after[name])&&!after[name].length)continue;
    return false;
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
    const compatible=path.endsWith('.lock.json')||path.endsWith('spec-revisions.json')?additive:additiveSchema;
    const breaking = before[path] !== undefined && (after[path] === undefined || !compatible(before[path],after[path]));
    if(path.endsWith('spec-revisions.json')&&breaking)errors.push(`${path}: registered revision descriptors are immutable; append a new revision id`);
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
  const paths = git(['ls-tree','-r','--name-only',ref,'--','planning/contracts'],root).trim().split('\n').filter(path => /(?:\.lock|\.schema)\.json$/.test(path) || /^planning\/contracts\/schema\/[^/]+\.json$/.test(path) || path==='planning/contracts/spec-revisions.json');
  return Object.fromEntries(paths.map(path=>[path,JSON.parse(git(['show',`${ref}:${path}`],root))]));
}
export function versionsAt(ref, root = process.cwd()) {
  const path = 'planning/contracts/versions.json';
  return git(['ls-tree', '--name-only', ref, '--', path], root).trim()
    ? JSON.parse(git(['show', `${ref}:${path}`], root)) : {};
}
if (isMain(import.meta.url)) {
  const {values} = parseArgs({options:{base:{type:'string',default:'origin/main'},head:{type:'string',default:'HEAD'},labels:{type:'string',default:''}}});
  report(checkContractChange({
    before: contractsAt(values.base), after: contractsAt(values.head),
    beforeVersions: versionsAt(values.base), afterVersions: versionsAt(values.head), labels: values.labels.split(','),
  }));
}
