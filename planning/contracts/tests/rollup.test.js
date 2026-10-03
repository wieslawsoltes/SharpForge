import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rollup } from '../../../scripts/planning/rollup.js';
import { publishRollup } from '../../../scripts/planning/rollup-publish.js';

function inputs(){
  const revisions={revisions:[{id:'csharp-14'}]},leafId='SF-A00-T12.1';
  const snapshot={issues:[{id:'SF-A00-E02',kind:'Epic',area:'A00',state:'CLOSED',parent:null},{id:'SF-A00-T12',kind:'Task',area:'A00',state:'CLOSED',parent:'SF-A00-E02'},{id:leafId,kind:'Task',area:'A00',state:'CLOSED',parent:'SF-A00-T12'}]};
  const inventory={schemaVersion:1,rows:[{id:'feature.one',leafId,area:'A00',platforms:['linux','windows'],engines:['source','cil'],specRevisions:['csharp-14']}]};
  const evidence=[['linux','source','pass'],['linux','cil','fail'],['windows','source','unsupported']].map(([platform,engine,status])=>({schemaVersion:1,leafId,capabilityId:'feature.one',platform,engine,specRevision:'csharp-14',status,commit:'a'.repeat(40),evidenceDigest:'b'.repeat(64)}));
  return {revisions,snapshot,inventory,evidence,ancestor:()=>true,verified:()=>true};
}
test('inventory obligations produce distinct fractions and unknown prevents parent complete',()=>{
  const result=rollup(inputs());assert.equal(result.obligations.length,4);
  const epic=result.groups.filter(g=>g.id==='SF-A00-E02');assert.equal(epic.reduce((n,g)=>n+g.pass,0),1);assert.equal(epic.reduce((n,g)=>n+g.unknown,0),1);assert.equal(epic.reduce((n,g)=>n+g.unsupported,0),1);
  assert.equal(epic.filter(g=>g.unknown).every(g=>!g.complete),true);
  assert.equal(epic.every(g=>!g.scopeComplete),true);
  assert.deepEqual(rollup(inputs()),result);
});
test('reopen, stale commit and altered proof each invalidate previous pass',()=>{
  for(const condition of ['reopen','stale','proof']){
    const input=inputs();if(condition==='reopen') input.snapshot.issues.at(-1).state='OPEN';if(condition==='stale')input.ancestor=()=>false;if(condition==='proof')input.verified=()=>false;
    const result=rollup(input);assert.equal(result.obligations.every(r=>r.status==='unknown'),true);assert.ok(result.obligations[0].invalidated.length);
  }
});
test('missing revision, duplicate identities, parent cycles and absent denominator fail closed',()=>{
  const missing=inputs();delete missing.evidence[0].specRevision;assert.throws(()=>rollup(missing),/specRevision/);
  const bad=inputs();bad.evidence[0].specRevision='unregistered';assert.throws(()=>rollup(bad),/Unregistered/);
  const duplicate=inputs();duplicate.evidence.push(duplicate.evidence[0]);assert.throws(()=>rollup(duplicate),/Duplicate evidence/);
  const cycle=inputs();cycle.snapshot.issues[0].parent=cycle.snapshot.issues[1].id;assert.throws(()=>rollup(cycle),/cycle/);
  assert.throws(()=>rollup({...inputs(),inventory:{schemaVersion:1,rows:[]}}),/denominator/);
});
test('report bytes are deterministic, numeric parity updates are changed-only and include zero',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'sf-rollup-')),result=rollup(inputs()),updates=[];
  const item={id:'epic',content:{title:'[SF-A00-E02] Epic'},fields:{}},client={items:async()=>[item],setFields:async(_,fields)=>{updates.push(fields);Object.assign(item.fields,fields);}};
  try{
    await publishRollup({result,directory,client});const bytes=readFileSync(join(directory,'parity.json'),'utf8');assert.equal(updates[0]['Parity percent'],25);
    await publishRollup({result,directory,client});assert.equal(updates.length,1);assert.equal(readFileSync(join(directory,'parity.json'),'utf8'),bytes);
    const md=readFileSync(join(directory,'parity.md'),'utf8');assert.match(md,/Unknown \| Unsupported/);
    const zero=inputs();zero.verified=()=>false;await publishRollup({result:rollup(zero),directory,client});assert.equal(updates.at(-1)['Parity percent'],0);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
