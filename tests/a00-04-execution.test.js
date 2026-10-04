import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {compileToIL} from '@sharpforge/compiler';import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';
import {runSafepointFixtures,forceCollections} from '../scripts/planning/run-safepoint-fixtures.js';import {checkRootProviders,rootSites} from '../scripts/planning/check-root-providers.js';import {snapshotRecord,faultRecord} from '../scripts/planning/schema/adapters.js';import {validate} from '../scripts/planning/schema/validate.js';
const build=text=>{const c=compileToIL(text);assert(c.success,JSON.stringify(c.diagnostics));return c;};const engines={source:c=>new VirtualMachine(c.image,{virtualTime:true}),cil:c=>new CilVirtualMachine(c.assembly,{virtualTime:true})};const schema=name=>JSON.parse(readFileSync(new URL('../planning/contracts/schema/'+name+'.schema.json',import.meta.url)));const tick=()=>new Promise(resolve=>setImmediate(resolve));
const portableFault=(cause=null)=>({schemaVersion:2,typeToken:'T:Exception',messageHandle:null,exceptionHandle:null,frames:[{method:'Example.Main',offset:0}],uncatchable:false,cause});
test('A00 fault schema preserves default v1 projection and explicitly selects v2 recursively',()=>{
  const vm={fault:{name:'OuterException',frames:[{method:'Outer',point:{offset:7}}],cause:{name:'InnerException',frames:[{method:'Inner',ilOffset:0}]}}};
  const inner={schemaVersion:1,typeToken:'T:InnerException',messageHandle:null,exceptionHandle:null,frames:[{method:'Inner',offset:0}],uncatchable:false,cause:null};
  const expected={schemaVersion:1,typeToken:'T:OuterException',messageHandle:null,exceptionHandle:null,frames:[{method:'Outer',offset:7}],uncatchable:false,cause:inner};
  assert.deepEqual(faultRecord(vm),expected);assert.deepEqual(faultRecord(vm,vm.fault,{schemaVersion:1}),expected);
  assert.equal(validate(schema('fault'),expected),expected);
  const legacyCause={...expected,cause:{legacy:true}};
  assert.equal(validate(schema('fault'),legacyCause),legacyCause);
  assert.throws(()=>validate(schema('fault'),{...expected,schemaVersion:2}),{code:'SCHEMA_VERSION'});
  const modern=faultRecord(vm,undefined,{schemaVersion:2});
  assert.deepEqual(modern,{...expected,schemaVersion:2,cause:{...inner,schemaVersion:2}});
  assert.equal(validate(schema('fault-v2'),modern,{supportedVersion:2}),modern);
  for(const schemaVersion of [0,3,null,'2',true,NaN])assert.throws(()=>faultRecord(vm,vm.fault,{schemaVersion}),{code:'SCHEMA_VERSION'});
});
test('A00 fault schema v2 accepts complete nested causes and preserves root version rejection',()=>{
  const definition=schema('fault-v2'),options={supportedVersion:2},leaf={...portableFault(),messageHandle:{h:1,g:2},exceptionHandle:{h:3,g:4},frames:[{method:'Example.Throw',offset:null}]};
  const record=portableFault(portableFault(leaf));
  assert.equal(validate(definition,record,options),record);assert.equal(validate(definition,portableFault(),options).cause,null);
  assert.throws(()=>validate(definition,record),{code:'SCHEMA_VERSION'});
  assert.throws(()=>validate(definition,{...record,schemaVersion:3},options),{code:'SCHEMA_VERSION'});
  assert.throws(()=>validate(definition,portableFault({...leaf,schemaVersion:1}),options),{code:'SCHEMA_INVALID'});
});
test('A00 fault schema v2 rejects malformed nested records, handles and frames',()=>{
  const definition=schema('fault-v2'),options={supportedVersion:2},valid=portableFault();
  const missing=Object.keys(valid).map(key=>{const copy={...valid};delete copy[key];return copy;});
  const malformed=[...missing,{},true,'cause',[],{...valid,extra:true},{...valid,typeToken:1},{...valid,uncatchable:'false'},
    {...valid,messageHandle:{h:0,g:1}},{...valid,exceptionHandle:{h:1,g:0x100000000}},
    {...valid,messageHandle:{h:1,g:1,extra:true}},
    {...valid,frames:[{method:'Example.Throw',offset:-1}]},{...valid,frames:[{method:'Example.Throw'}]},
    {...valid,frames:[{method:7,offset:0}]},{...valid,frames:[{method:'Example.Throw',offset:0,extra:true}]}];
  for(const cause of malformed){
    assert.throws(()=>validate(definition,portableFault(cause),options),{code:'SCHEMA_INVALID'});
    assert.throws(()=>validate(definition,portableFault(portableFault(cause)),options),{code:'SCHEMA_INVALID'});
  }
});
test('A00 fault schema v2 bounds recursive cause validation',()=>{
  const definition=schema('fault-v2'),options={supportedVersion:2},record=portableFault(portableFault(portableFault()));
  assert.equal(validate(definition,record,options),record);
  assert.throws(()=>validate(definition,record,{...options,maxDepth:4}),{code:'SCHEMA_LIMIT'});
  const cyclic=portableFault();cyclic.cause=cyclic;
  assert.throws(()=>validate(definition,cyclic,options),{code:'SCHEMA_LIMIT'});
});
test('A00 force GC at safepoints in both actual VMs',async()=>{const results=await runSafepointFixtures();assert.equal(results.length,14);assert(results.every(r=>r.collections>r.polls));});
test('A00 root provider manifest guards new sites',()=>{assert(checkRootProviders().length>=13);const root=mkdtempSync(join(tmpdir(),'sf-roots-'));try{mkdirSync(join(root,'packages/runtime/src'),{recursive:true});mkdirSync(join(root,'planning/contracts'),{recursive:true});writeFileSync(join(root,'packages/runtime/src/new.js'),'class NewProvider { *roots(){ yield null; } }');writeFileSync(join(root,'planning/contracts/gc-roots.md'),'');assert.throws(()=>checkRootProviders(root),/Undocumented root site new.js/);writeFileSync(join(root,'planning/contracts/gc-roots.md'),'`new.js:roots:1`');assert.equal(checkRootProviders(root).length,1);mkdirSync(join(root,'packages/runtime/src/execution'));writeFileSync(join(root,'packages/runtime/src/execution/parked.js'),'function roots(){}');assert.throws(()=>checkRootProviders(root),/execution\/parked.js/);}finally{rmSync(root,{recursive:true,force:true});}});
for(const [engine,make]of Object.entries(engines)){
 test('A00 '+engine+' snapshot projection, owner isolation and stable frame IDs',()=>{const c=build('int[] data = new int[] {1,2}; Console.WriteLine(data[0]);'),vm=make(c),other=make(c);try{vm.runSlice({instructionBudget:2,timeBudgetMs:100});const snapshot=vm.snapshot(),record=snapshotRecord(vm);validate(schema('pause-snapshot'),record);const initial=vm.frameId;vm.run();vm.restore(snapshot);assert(vm.frameId>=initial);assert.throws(()=>other.restore(snapshot),/another/);assert.throws(()=>validate(schema('pause-snapshot'),{...record,frames:[{id:-1}]}),{code:'SCHEMA_INVALID'});}finally{vm.stop();other.stop();}});
 test('A00 '+engine+' faults and fatal budget transfer',()=>{for(const [text,message,budget]of [['throw new Exception("catchable");','catchable',undefined],['while(true) { }','Program exceeded its instruction budget',10]]){const vm=make(build('using System;'+text));try{if(budget)vm.options.maxInstructions=budget;vm.run();assert.equal(vm.state,'faulted');assert.equal(vm.fault.message,message);const record=faultRecord(vm);validate(schema('fault'),record);assert.equal(record.uncatchable,!!budget);const modern=faultRecord(vm,undefined,{schemaVersion:2});validate(schema('fault-v2'),modern,{supportedVersion:2});assert.deepEqual(modern,{...record,schemaVersion:2});}finally{vm.stop();}}});
 test('A00 '+engine+' actual host callback roots and rejection',async()=>{const vm=make(build('Console.WriteLine("host");'));const restore=forceCollections(vm);try{const witness=vm.heap.string('host-witness');let complete;const pending=new Promise(resolve=>{complete=resolve;});const ref=vm.heap.withRoots([witness],()=>vm.platform.hostOperations.start('string',()=>pending,()=>{vm.heap.collect();assert.equal(vm.heap.get(witness).data,'host-witness');return witness;},[witness],'fixture'));const lease=vm.heap.createHandle(ref);vm.heap.collect();assert.equal(vm.heap.get(witness).data,'host-witness');assert.throws(()=>vm.snapshot(),/pending external/);complete('done');await tick();const task=vm.scheduler.taskRecord(ref);assert.equal(task.status,'completed');assert.equal(task.result,witness);vm.heap.collect();assert.equal(vm.heap.get(witness).data,'host-witness');vm.heap.releaseHandle(lease);const failure=vm.platform.hostOperations.start('void',()=>{throw new Error('callback fault');},()=>null,[],'fixture');await tick();assert.equal(vm.scheduler.taskRecord(failure).status,'faulted');assert.equal(vm.scheduler.taskRecord(failure).error.message,'callback fault');}finally{restore();vm.stop();}});
 test('A00 '+engine+' cancel, dispose and late completion boundaries',async()=>{const vm=make(build('Console.WriteLine("cancel");'));try{const before=vm.snapshot();const ref=vm.platform.hostOperations.start('void',signal=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})),()=>null,[],'cancel');await tick();vm.platform.hostOperations.cancel('cancel');await tick();assert.equal(vm.scheduler.taskRecord(ref).status,'canceled');assert.throws(()=>vm.restore(before),/Cannot reverse/);let complete;const late=vm.platform.hostOperations.start('void',()=>new Promise(r=>{complete=r;}),()=>{throw new Error('Late conversion must not run');},[],'late');await tick();vm.platform.hostOperations.dispose();assert.equal(vm.scheduler.taskRecord(late).status,'canceled');complete('late');await tick();assert.equal(vm.scheduler.taskRecord(late).status,'canceled');assert.equal(vm.platform.hostOperations.active.size,0);assert.throws(()=>vm.platform.hostOperations.start('void',()=>null,()=>null),/closed/);}finally{vm.stop();}});
 test('A00 '+engine+' ignored abort currently permits late success',async()=>{const vm=make(build('Console.WriteLine("race");'));try{let finish;const ref=vm.platform.hostOperations.start('void',()=>new Promise(r=>{finish=r;}),()=>null,[],'race');await tick();vm.platform.hostOperations.cancel('race');finish();await tick();assert.equal(vm.scheduler.taskRecord(ref).status,'completed');}finally{vm.stop();}});
}
