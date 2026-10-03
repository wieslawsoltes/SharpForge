import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { uniqueContractIds } from './check-contract-change.js';
import { isMain, report } from './lib/io.js';

export const checks = [
  ['contract IDs','scripts/planning/snapshot-contract-ids.js','--strict'],
  ['ABI versions','scripts/planning/abi/check-versions.js'],
  ['schema fixtures','scripts/planning/gen-schema-fixtures.js','--check'],
  ['test manifests','scripts/planning/check-test-manifests.js'],
];
export function contractGate({ root=process.cwd(), commands=checks, signal } = {}) {
  const results = [], errors = [];
  for (const path of readdirSync(resolve(root,'planning/contracts')).filter(path=>path.endsWith('.lock.json')).sort()) {
    try {errors.push(...uniqueContractIds(JSON.parse(readFileSync(resolve(root,'planning/contracts',path),'utf8')),path));}
    catch(error) {errors.push(`${path}: ${error.message}`);}
  }
  for (const [name, ...args] of commands) {
    if (signal?.aborted) { errors.push('Gate cancelled'); break; }
    const child = spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,signal});
    const passed = child.status === 0;
    results.push({name,command:['node',...args],passed,exitCode:child.status,stdout:child.stdout??'',stderr:child.stderr??'',error:child.error?.message??null});
    if (!passed) errors.push(`${name}: ${child.error?.message || child.stderr?.trim() || `exit ${child.status}`}`);
  }
  return {schemaVersion:1,passed:errors.length===0,checks:results,errors};
}
if (isMain(import.meta.url)) {
  const {values} = parseArgs({options:{root:{type:'string',default:'.'}}});
  report(contractGate({root:resolve(values.root)}));
}
