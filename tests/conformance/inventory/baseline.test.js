import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {outputManifest,verifyRecordedOutputs} from '../../../scripts/conformance/inventory/baseline.js';
import {inputManifest} from '../../../scripts/conformance/inventory/generate.js';
import {referenceDiagnostics} from '../../../scripts/conformance/inventory/reference-language.js';
import {writeJSON} from '../../../scripts/conformance/inventory/common.js';

const target='node-darwin-arm64',digest='a'.repeat(64);
const outputs=()=>({'csharp-features.json':{baselinePlatform:target,rows:[{id:'feature',status:'missing',observations:{accepted:false}}]},'issue-candidates.json':{issues:[{id:'GAP-CSHARP-0001',reason:'missing'}]},'gap-ids.json':{entries:[{id:'GAP-CSHARP-0001'}]},'obligations.json':{rows:[{id:'GAP-CSHARP-0001'}]},'inputs.json':{sha256:digest,files:[]}});
async function save(directory,current) {
  for(const [name,value] of Object.entries(current))await writeJSON(path.join(directory,name),value);
  await writeJSON(path.join(directory,'outputs.json'),outputManifest(current,target,digest));
}

test('inventory check detects tampered statuses, observations, proposals and even a resealed changed baseline',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'sf-inventory-seal-'));
  try {
    const current=outputs();await save(directory,current);
    assert.equal((await verifyRecordedOutputs(directory,current,target,digest)).sameTarget,true);
    for(const name of ['csharp-features.json','issue-candidates.json']) {
      const altered=outputs();if(name==='csharp-features.json'){altered[name].rows[0].status='implemented';altered[name].rows[0].observations.accepted=true;}else altered[name].issues=[];
      await writeJSON(path.join(directory,name),altered[name]);
      await assert.rejects(verifyRecordedOutputs(directory,current,target,digest),/integrity mismatch/);
      await save(directory,altered);
      await assert.rejects(verifyRecordedOutputs(directory,current,target,digest),/Regenerated inventory output changed/);
      await save(directory,current);
    }
    await writeJSON(path.join(directory,'outputs.json'),{...outputManifest(current,target,digest),files:[]});
    await assert.rejects(verifyRecordedOutputs(directory,current,target,digest),/output set changed/);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('cross-target inventory preserves independent observations but cannot drift shared structure or inputs',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'sf-inventory-target-'));
  try {
    const baseline=outputs();await save(directory,baseline);
    const current=outputs();current['csharp-features.json'].baselinePlatform='node-linux-x64';current['csharp-features.json'].rows[0].status='unknown';
    assert.equal((await verifyRecordedOutputs(directory,current,'node-linux-x64',digest)).sameTarget,false);
    current['obligations.json'].rows=[];
    await assert.rejects(verifyRecordedOutputs(directory,current,'node-linux-x64',digest),/obligations.json/);
    await assert.rejects(verifyRecordedOutputs(directory,outputs(),target,'b'.repeat(64)),/stale inventory output manifest/);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('input digest changes for transitive workspace sources and package resolution inputs',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'sf-inventory-input-'));
  try {
    const dirs=['packages/bytecode/src','packages/text/src','packages/symbols/src','scripts/conformance/inventory','scripts/conformance/oracle','tests/conformance/inventory/probes','tests/conformance/inventory/metadata','planning/qualification/inventory/references','tests/conformance/oracle/WinUI'];
    for(const dir of dirs)await mkdir(path.join(directory,dir),{recursive:true});
    const files=['package.json','package-lock.json','planning/backlog.snapshot.json','planning/qualification/oracle-toolchain.json','planning/qualification/inventory/surface-catalog.json','tests/conformance/oracle/WinUI/packages.lock.json','tests/conformance/inventory/browser_probe.py'];
    for(const name of ['bytecode','text','symbols'])files.push(`packages/${name}/package.json`,`packages/${name}/src/index.js`);
    for(const file of files)await writeFile(path.join(directory,file),'{}\n');
    let previous=await inputManifest({repositoryRoot:directory});
    for(const file of ['packages/bytecode/src/index.js','packages/text/src/index.js','packages/symbols/src/index.js','packages/bytecode/package.json','package-lock.json']) {
      assert(previous.files.some(row=>row.path===file));await writeFile(path.join(directory,file),'changed\n');
      const next=await inputManifest({repositoryRoot:directory});assert.notEqual(next.sha256,previous.sha256,file);previous=next;
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('native diagnostic canonicalization ignores order while retaining distinct diagnostic details',()=>{
  const first='/tmp/probe/Probe.cs(1,3): warning CS0169: A\n/tmp/probe/Probe.cs(1,5): warning CS0169: B\n';
  const second=first.trim().split('\n').reverse().join('\r\n');
  assert.deepEqual(referenceDiagnostics(first,'/tmp/probe','/tmp/probe/Probe.cs'),referenceDiagnostics(second,'/tmp/probe','/tmp/probe/Probe.cs'));
  assert.notDeepEqual(referenceDiagnostics(first,'/tmp/probe','/tmp/probe/Probe.cs'),referenceDiagnostics(second.replace(': B',': C'),'/tmp/probe','/tmp/probe/Probe.cs'));
});
