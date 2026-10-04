import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assignGapIds, issueCandidates } from '../../../scripts/conformance/inventory/gap-ids.js';
import { compareMembers } from '../../../scripts/conformance/inventory/bcl-api-diff.js';
import { encodingProbe } from '../../../scripts/conformance/inventory/ecma335.js';
import { compilerDiagnosticIds, diagnosticInventory } from '../../../scripts/conformance/inventory/diagnostics.js';
import { compileProbe, compileFeatureProbes, assertReferenceProbe } from '../../../scripts/conformance/inventory/csharp.js';
import { referenceProbeArguments, referenceProbeContext } from '../../../scripts/conformance/inventory/reference-language.js';
import { lspProbe, dapProbe } from '../../../scripts/conformance/inventory/ide.js';
import { executeProbe } from '../../../scripts/conformance/inventory/runtime-runner.js';
import { validateDenominator } from '../../../scripts/conformance/inventory/generate.js';
import { denominator } from '../../../scripts/conformance/inventory/denominator.js';
import { root, inventoryRoot, probeRoot, readJSON, sha256, platforms, vmEngines } from '../../../scripts/conformance/inventory/common.js';

const row=(key,domain='TEST')=>({key,domain,area:'A29',status:'missing',specRevision:'ecma-335-6'});
test('gap ledger retains identities across insert, reorder, remove and reintroduce',()=>{
  const a=assignGapIds([row('z'),row('m')],undefined,'v1'), ids=new Map(a.rows.map(r=>[r.key,r.gapId]));
  const b=assignGapIds([row('a'),row('z')],a.ledger,'v2');assert.equal(b.rows.find(r=>r.key==='z').gapId,ids.get('z'));
  assert.equal(b.ledger.entries.find(e=>e.key==='m').state,'tombstone');assert.equal(b.rows.find(r=>r.key==='a').gapId,'GAP-TEST-0003');
  const c=assignGapIds([row('m'),row('z'),row('a')],b.ledger,'v3');assert.equal(c.rows.find(r=>r.key==='m').gapId,ids.get('m'));
  assert.deepEqual(c.ledger.entries.find(e=>e.key==='m').transitions.map(t=>t.state),['active','tombstone','active']);
  assert.deepEqual(assignGapIds(c.rows,c.ledger,'v3').ledger,c.ledger);assert.equal(issueCandidates(c.rows).issues.length,3);
});
test('gap ledger rejects duplicate, malformed, changed-domain and exhausted identities',()=>{
  assert.throws(()=>assignGapIds([row('x'),row('x')]));const previous=assignGapIds([row('x')]).ledger;
  assert.throws(()=>assignGapIds([row('x','CHANGED')],previous));
  assert.throws(()=>assignGapIds([], {schemaVersion:1,entries:[...previous.entries,...previous.entries]}));
  assert.throws(()=>assignGapIds([row('y')],{schemaVersion:1,entries:[{...previous.entries[0],id:'GAP-TEST-9007199254740991'}]}));
});
test('reference matching requires full method signature and preserves missing overload denominator',()=>{
  const member={assembly:'Test',owner:'Example.C',kind:'method',name:'M',isStatic:true,genericArity:0,result:'System.Int32',parameters:['System.Int32'],signature:'M(int)'};
  const reference={files:[],rows:[member,{...member,parameters:['System.Int64'],signature:'M(long)'},{...member,isStatic:false,signature:'instance M(int)'}]};
  const result=compareMembers(reference,{registryTypes:new Map(),registryContracts:[{id:7,owner:'Example.C',name:'M',isStatic:true,result:'int',parameters:['int']}]});
  assert.deepEqual(result.rows.map(r=>r.status),['implemented','missing','missing']);assert.equal(result.totals.denominator,3);assert.match(result.totals.parity,/not calculated/);
  assert.throws(()=>compareMembers({...reference,rows:[member,member]}),/Duplicate/);
});
test('C# compile probe records actual positive, malformed and language-boundary decisions',()=>{
  assert.equal(compileProbe('class C { int M(){return 1;} }','1').accepted,true);
  assert.equal(compileProbe('class C { void M( }','14').accepted,false);
  const expressionBody='class C { int M() => 1; }';
  assert.equal(compileProbe(expressionBody,'6').accepted,true);
  assert.equal(compileProbe(expressionBody,'5').accepted,false);
  const crash=compileProbe('','14',()=>{throw new Error('bounded crash')});assert.equal(crash.accepted,false);assert.equal(crash.error,'bounded crash');
});
test('feature probes preserve executable context for positive, malformed and boundary compilation',async()=>{
  const catalog=await readJSON(path.join(probeRoot,'csharp.json'));
  const feature=catalog.features.find(row=>row.id==='csharp-7-1-async-main');
  assert.equal(feature.outputKind,'exe');
  const source=await readFile(path.join(root,feature.probe),'utf8'), calls=[];
  compileFeatureProbes(source,feature,'7.0',(text,options)=>{
    calls.push({text,options});return {success:true,diagnostics:[]};
  });
  assert.deepEqual(calls.map(call=>call.options),['7.1','7.1','7.0'].map(langVersion=>({langVersion,outputKind:'exe',allowUnsafe:true})));
  assert.equal(calls[0].text,source);assert.match(calls[1].text,/class __Invalid/);assert.equal(calls[2].text,source);
  for(const langVersion of ['7.1','7.0']) {
    const args=referenceProbeArguments(feature,{file:'Probe.cs',directory:os.tmpdir(),references:['Core.dll'],langVersion});
    assert.ok(args.includes('/target:exe'));assert.ok(args.includes(`/langversion:${langVersion}`));
  }
});
test('native validity cannot be reused after a fixture compilation context changes',()=>{
  const feature={id:'entry',langVersion:'7.1',outputKind:'exe',nativeFeatures:['flag']};
  const native={sourceSHA256:'digest',...referenceProbeContext(feature)};
  assertReferenceProbe(feature,native,'digest');
  for(const change of [{target:'library'},{langVersion:'7.0'},{features:[]},{sourceSHA256:'old'}]) {
    assert.throws(()=>assertReferenceProbe(feature,{...native,...change},'digest'),/Stale native probe/);
  }
  assert.deepEqual(referenceProbeContext({langVersion:'1.2'}),{langVersion:'1',target:'library',features:[]});
});
test('pinned reference hashes and all C# history feature probes are present',async()=>{
  const manifest=await readJSON(path.join(inventoryRoot,'references/manifest.json'));
  for(const ref of manifest.references)assert.equal(sha256(await readFile(path.join(inventoryRoot,'references',ref.file))),ref.sha256);
  const catalog=await readJSON(path.join(probeRoot,'csharp.json'));
  const history=await readJSON(path.join(inventoryRoot,'references/csharp-history.json'));
  assert.equal(catalog.features.length,history.entries.length);
  assert.equal(new Set(catalog.features.map(f=>f.id)).size,catalog.features.length);
  for(const feature of catalog.features)assert.ok((await readFile(path.join(root,feature.probe),'utf8')).trim());
  for(let version=1;version<=15;version++)assert.ok(catalog.features.some(f=>parseInt(f.version)===version));
});
test('ECMA denominator includes normative prefixes absent from informative annex and rejects unknown opcode',async()=>{
  const ref=await readJSON(path.join(inventoryRoot,'references/ecma335.json'));assert.equal(ref.opcodes.length,219);assert.equal(ref.tables.length,45);
  for(const name of ['no.','constrained.','readonly.','unbox.any'])assert.equal(encodingProbe(ref.opcodes.find(r=>r.name===name)).status,'pass');
  assert.equal(encodingProbe({name:'not-an-opcode',value:0xffff}).status,'unsupported');assert.equal(encodingProbe({name:'ret',value:0xffff}).status,'fail');
});
test('diagnostic denominator coalesces enum aliases but keeps missing IDs',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'sf-diag-'));
  try {await writeFile(path.join(directory,'compiler.js'),"const id='CS0123'; const custom='SF1000';");
    const source=await compilerDiagnosticIds(directory),result=await diagnosticInventory({rows:[{name:'ERR_A',value:123},{name:'WRN_Alias',value:123},{name:'ERR_Missing',value:124}]},{source});
    assert.equal(result.rows.length,2);assert.equal(result.rows[0].status,'implemented');assert.equal(result.rows[1].status,'missing');assert.equal(result.rows[0].names.length,2);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('protocol probes distinguish actual recognized errors from unsupported methods and cleanup',async()=>{
  assert.equal((await lspProbe('initialize')).status,'implemented');assert.equal((await lspProbe('textDocument/noSuchMethod')).status,'missing');
  assert.equal((await lspProbe('textDocument/completion')).malformed.error.code,-32602);
  assert.equal((await dapProbe('initialize')).status,'implemented');assert.equal((await dapProbe('noSuchCommand')).status,'missing');
  assert.equal((await dapProbe('goto')).status,'unknown');assert.equal((await dapProbe('disconnect')).response.success,true);
});
test('both independent VMs execute arithmetic/disposal/bounds and report cancellation as failure',async()=>{
  const fixtures=(await readJSON(path.join(probeRoot,'runtime.json'))).fixtures;
  for(const engine of ['js-source-vm','js-cil-vm']) {
    for(const fixture of fixtures.filter(f=>['execution-int32','execution-dispose','execution-array-positive'].includes(f.id))) {
      const result=await executeProbe(fixture,engine);assert.equal(result.status,'pass',JSON.stringify(result));assert.ok(result.managedAllocations.allocatedBytes>=0);
    }
    const controller=new AbortController();controller.abort();const canceled=await executeProbe(fixtures.find(f=>f.id==='execution-array-positive'),engine,{signal:controller.signal});assert.equal(canceled.status,'fail');assert.match(canceled.error,/cancel/i);
  }
});
test('rollup denominator binds all 30 areas to leaf IDs and never silently accepts shrinkage',async()=>{
  const snapshot=await readJSON(path.join(root,'planning/backlog.snapshot.json')),obligations=await readJSON(path.join(inventoryRoot,'obligations.json'));
  const rows=[];for(const name of ['csharp-features','ecma335','bcl-api','winui-api','diagnostics','ide-capabilities','runtime-gc'])rows.push(...(await readJSON(path.join(inventoryRoot,`${name}.json`))).rows);
  const generated=denominator(rows,snapshot);validateDenominator(generated,obligations);assert.equal(new Set(generated.rows.map(r=>r.area)).size,30);
  assert.throws(()=>validateDenominator({...generated,rows:generated.rows.slice(1)},obligations),/changed/);
  assert.throws(()=>denominator([{...rows[0],leafId:'SF-A29-T03'}],snapshot),/Invalid inventory owner/);
});


test('inventory obligations retain unqualified Firefox/WebKit and both DAP VM backends', async () => {
  const obligations=await readJSON(path.join(inventoryRoot,'obligations.json'));
  assert.deepEqual(platforms,['browser-chromium','browser-firefox','browser-webkit','node-linux-x64','node-win32-x64','node-darwin-arm64']);
  for (const row of obligations.rows) for (const browser of ['browser-chromium','browser-firefox','browser-webkit']) assert.ok(row.platforms.includes(browser),row.id);
  const dap=obligations.rows.filter(row=>row.id.startsWith('GAP-DAP-'));
  assert.ok(dap.length>50);for(const row of dap)assert.deepEqual(row.engines,vmEngines);
  assert.ok(obligations.rows.every(row=>!Object.hasOwn(row,'status')),'inventory rows must not turn target presence into passing evidence');
});

test('inventory native/browser qualification is explicit and serial', async () => {
  const workflow=await readFile(path.join(root,'.github/workflows/inventory.yml'),'utf8');
  assert.doesNotMatch(workflow,/^  (?:push|pull_request|schedule|merge_group):/m);
  assert.match(workflow,/^  workflow_dispatch:/m);
  const jobs=workflow.slice(workflow.indexOf('jobs:'));
  assert.equal([...jobs.matchAll(/^  [a-z-]+:/gm)].length,3);
  assert.match(jobs,/desktop:\n    needs: linux/);
  assert.match(jobs,/browser:\n    needs: desktop/);
  assert.equal([...jobs.matchAll(/max-parallel: 1/g)].length,2);
});
