import { readdir, readFile, mkdir, writeFile, access, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, inventoryRoot, artifactRoot, pin, readJSON, writeJSON, sha256, canonicalJSON } from './common.js';
import { resolveToolchain } from '../oracle/toolchain.js';
import { bclMetadata, winuiMetadata, diagnosticMetadata } from './native-metadata.js';
import { bclApiDiff } from './bcl-api-diff.js';
import { winuiApiDiff } from './winui-api-diff.js';
import { diagnosticInventory } from './diagnostics.js';
import { csharpInventory } from './csharp.js';
import { referenceLanguage } from './reference-language.js';
import { ecmaInventory } from './ecma335.js';
import { ideInventory } from './ide.js';
import { runtimeInventory } from './runtime-gc.js';
import { assignGapIds, issueCandidates } from './gap-ids.js';
import { denominator } from './denominator.js';
import { outputManifest, verifyRecordedOutputs } from './baseline.js';

export async function inputManifest({repositoryRoot=root}={}) {
  const inputs=[];
  async function walk(relative) {
    const absolute=path.join(repositoryRoot,relative);
    if((await lstat(absolute)).isSymbolicLink())throw new Error(`Inventory input must not be a symlink: ${relative}`);
    for(const entry of (await readdir(absolute,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
      const file=`${relative}/${entry.name}`;
      if(entry.isDirectory())await walk(file);else if(entry.isFile())inputs.push({path:file,sha256:sha256(await readFile(path.join(repositoryRoot,file)))});else throw new Error(`Inventory input must not be a symlink: ${file}`);
    }
  }
  // Include every workspace source and manifest: compiler/protocol imports are
  // transitive (bytecode, text, symbols, workspace, etc.), not a fixed six-package set.
  const files=['package.json','package-lock.json','planning/backlog.snapshot.json','planning/qualification/oracle-toolchain.json','planning/qualification/inventory/surface-catalog.json','tests/conformance/oracle/WinUI/packages.lock.json','tests/conformance/inventory/browser_probe.py'];
  for(const entry of await readdir(path.join(repositoryRoot,'packages'),{withFileTypes:true})) {
    if(entry.isSymbolicLink())throw new Error(`Inventory package must not be a symlink: ${entry.name}`);
    if(!entry.isDirectory())continue;
    files.push(`packages/${entry.name}/package.json`);
    try{await access(path.join(repositoryRoot,'packages',entry.name,'src'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
    await walk(`packages/${entry.name}/src`);
  }
  for(const directory of ['scripts/conformance/inventory','scripts/conformance/oracle','tests/conformance/inventory/probes','tests/conformance/inventory/metadata','planning/qualification/inventory/references'])await walk(directory);
  for(const file of files)inputs.push({path:file,sha256:sha256(await readFile(path.join(repositoryRoot,file)))});
  inputs.sort((a,b)=>a.path.localeCompare(b.path,'en'));return {files:inputs,sha256:sha256(canonicalJSON(inputs))};
}
export function validateDenominator(current,baseline) {
  if(baseline.schemaVersion!==1||!baseline.rows?.length)throw new Error('Missing versioned denominator');
  const old=new Map(baseline.rows.map(row=>[row.id,row]));
  if(old.size!==baseline.rows.length||current.rows.length!==baseline.rows.length)throw new Error('Reference denominator changed: explicit reviewed --update required');
  for(const row of current.rows)if(canonicalJSON(old.get(row.id))!==canonicalJSON(row))throw new Error(`Reference obligation changed: ${row.id}; explicit reviewed --update required`);
}
export async function generate({update=false,signal}={}) {
  const target=`node-${process.platform}-${process.arch}`, output=path.join(artifactRoot,target);
  await mkdir(output,{recursive:true});
  const report={schemaVersion:1,command:`node scripts/conformance/inventory/generate.js ${update?'--update':'--check'}`,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),platform:target,node:process.version,toolchain:pin,status:'running'};
  try {
    const toolchain=await resolveToolchain();report.environment=toolchain.environment;report.resolved=toolchain.actual;
    const inputs=await inputManifest();report.inputDigest=inputs.sha256;
    const inventory={};
    const languageReference=await referenceLanguage({toolchain,signal});
    await writeJSON(path.join(output,'reference-language.json'),languageReference);
    inventory['csharp-features']=await csharpInventory({reference:languageReference});
    inventory.ecma335=await ecmaInventory();
    inventory['bcl-api']=bclApiDiff(await bclMetadata({toolchain,signal}));
    inventory['winui-api']=winuiApiDiff(await winuiMetadata({toolchain,signal}));
    inventory.diagnostics=await diagnosticInventory(await diagnosticMetadata({toolchain,signal}));
    inventory['ide-capabilities']=await ideInventory();
    inventory['runtime-gc']=await runtimeInventory({signal});
    let previous;try{previous=await readJSON(path.join(inventoryRoot,'gap-ids.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
    const combined=Object.values(inventory).flatMap(value=>value.rows), assigned=assignGapIds(combined,previous,inputs.sha256.slice(0,12)), byKey=new Map(assigned.rows.map(row=>[row.key,row]));
    const obligations=denominator(assigned.rows,await readJSON(path.join(root,'planning/backlog.snapshot.json')));
    const owners=new Map(obligations.rows.map(row=>[row.id,row.leafId]));
    for(const row of assigned.rows)row.leafId=owners.get(row.gapId);
    const outputs={};
    for(const [name,value]of Object.entries(inventory))outputs[`${name}.json`]={...value,baselinePlatform:target,inputDigest:inputs.sha256,rows:value.rows.map(row=>byKey.get(row.key))};
    Object.assign(outputs,{'gap-ids.json':assigned.ledger,'obligations.json':obligations,'issue-candidates.json':issueCandidates(assigned.rows),'inputs.json':inputs});
    for(const [name,value]of Object.entries(outputs))await writeJSON(path.join(output,name),value);
    const seal=outputManifest(outputs,target,inputs.sha256);await writeJSON(path.join(output,'outputs.json'),seal);
    if(update){for(const [name,value]of Object.entries(outputs))await writeJSON(path.join(inventoryRoot,name),value);await writeJSON(path.join(inventoryRoot,'outputs.json'),seal);}
    else {
      validateDenominator(obligations,await readJSON(path.join(inventoryRoot,'obligations.json')));
      const recorded=await readJSON(path.join(inventoryRoot,'inputs.json'));
      if(recorded.sha256!==inputs.sha256)throw new Error('Inventory inputs changed; regenerate and review statuses with --update');
      report.baselineComparison=await verifyRecordedOutputs(inventoryRoot,outputs,target,inputs.sha256);
    }
    report.catalogs=Object.fromEntries(Object.entries(inventory).map(([name,value])=>[name,value.totals]));
    report.denominator={capabilities:obligations.rows.length,obligations:obligations.rows.reduce((n,row)=>n+row.platforms.length*row.engines.length*row.specRevisions.length,0),areas:[...new Set(obligations.rows.map(row=>row.area))].sort()};
    report.targets={observed:target,otherTargets:'unknown until their independent workflow artifacts exist',browserTargets:{'browser-chromium':'unknown in this native inventory report; separate browser evidence required','browser-firefox':'unknown until an independent Firefox capture exists','browser-webkit':'unknown until an independent WebKit capture exists'},debuggerBackends:{'js-source-vm':'dispatch observations are recorded; full behavior remains unqualified','js-cil-vm':'unknown; no CIL debugger probe observations in this capture'},nativeWinUIExecution:process.platform==='win32'?'not performed by metadata inventory; see native WinUI oracle':'unsupported: native WinUI requires Windows x64',rustManagedExecution:'unknown: inventory does not execute a Rust managed VM'};
    report.status='pass';report.meaning='Inventory extraction, probe execution and denominator integrity completed; individual missing/failing/unknown rows remain gaps. This is not parity evidence.';
    return report;
  }catch(error){report.status='fail';report.error=error.stack;throw error;}
  finally{await writeJSON(path.join(output,'report.json'),report);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {values}=parseArgs({options:{update:{type:'boolean'},check:{type:'boolean'}}});
  if(values.update&&values.check)throw new Error('Choose --update or --check');
  const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
  generate({update:values.update,signal:controller.signal}).then(report=>console.log(JSON.stringify({status:report.status,...report.denominator}))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
