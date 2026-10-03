import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine,CilVirtualMachine,ManagedFault} from '@sharpforge/runtime';
import {valueFixture} from './a05-03-fixtures.js';
import {copyFrames} from '../packages/runtime/src/snapshot.js';
import {copyExecution} from '../packages/runtime/src/snapshot.js';
import {createArray} from '../packages/runtime/src/execution/arrays.js';
import {mutateArray,resumeArrayOperation} from '../packages/runtime/src/execution/array-ops.js';
import {SUSPENDED} from '../packages/runtime/src/platform.js';

const engines={source:c=>new VirtualMachine(c.image,{virtualTime:true}),reload:c=>new VirtualMachine(loadAssembly(c.assembly),{virtualTime:true}),cil:c=>new CilVirtualMachine(c.assembly,{virtualTime:true})};
function compile(source){const c=compileToIL(source);assert(c.success,JSON.stringify(c.diagnostics));return c;}
const nested=compile('class P { static int F(int n) { try { if(n==0)throw new Exception("caught");return F(n-1)+1; } catch(Exception e) { Console.WriteLine(e.Message);return 10; } finally { Console.WriteLine(n); } } static void Main(){Console.WriteLine(F(3));} }');
for(const [engine,create] of Object.entries(engines)) {
  test(`a05-06 ${engine}: every nested call/fault/finally boundary replays with monotonic identities`,()=>{
    const vm=create(nested),saved=[];
    while(['ready','running'].includes(vm.state)) {
      vm.runSlice({instructionBudget:1,timeBudgetMs:1000});
      if(vm.frames.length>1||vm.top?.unwinds?.length||vm.top?.pending)saved.push(vm.snapshot());
    }
    assert.equal(vm.state,'terminated',vm.fault?.stack);const output=vm.output.join('');
    assert.equal(output,'caught\n0\n1\n2\n3\n13\n');assert(saved.length>10);
    let frameId=vm.frameId;
    for(const snapshot of saved) {
      vm.restore(snapshot);assert(vm.frameId>=frameId);
      assert.equal(vm.run().output,output);frameId=vm.frameId;
    }
  });
  test(`a05-06 ${engine}: parked contexts replay twice and cancellation does not poison saved state`,async()=>{
    const c=compile('using System.Threading.Tasks; class P { static async Task Main(){ Console.WriteLine("start"); await Task.Delay(10); Console.WriteLine("middle"); await Task.Delay(20); Console.WriteLine("end"); } }');
    const vm=create(c);vm.run();assert.equal(vm.state,'waiting');const saved=vm.snapshot();
    assert(saved.scheduler.contexts.some(([,context])=>context.status==='waiting'));
    vm.stop();
    for(let i=0;i<2;i++) {
      vm.restore(saved);if(vm.state==='paused')vm.state='running';
      const result=await vm.runAsync();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,'start\nmiddle\nend\n');
    }
  });
  test(`a05-06 ${engine}: active resume faults remain GC roots and retain aliases across components`,()=>{
    const vm=create(nested);vm.scheduler.ensure();
    const reference=vm.heap.allocate('exception','Exception',[vm.heap.string('resume')]);
    const fault=new ManagedFault('Exception','resume',reference);vm.fault=fault;vm.top.exception=fault;vm.scheduler.current.resumeFault=fault;
    vm.heap.collect();assert.equal(vm.heap.get(reference).kind,'exception');
    const saved=vm.snapshot();assert.equal(saved.scheduler.contexts[0][1].frames,saved.frames);
    vm.restore(saved);assert.equal(vm.scheduler.current.resumeFault,vm.fault);assert.equal(vm.top.exception,vm.fault);
    assert.equal(vm.scheduler.current.frames,vm.frames);assert.notEqual(vm.fault,fault);
  });
  test(`a05-06 ${engine}: malformed component snapshots reject before any state mutates`,()=>{
    const vm=create(nested),saved=vm.snapshot();vm.run();
    const current={heap:vm.heap.records,frames:vm.frames,output:vm.output,instructions:vm.instructions,revision:vm.heap.mutationRevision};
    const malformed=[
      {...saved,heap:{...saved.heap,free:[-1]}},
      {...saved,heap:{...saved.heap,records:[{type:'int',kind:'array',data:null,size:8}]}},
      {...saved,platform:{...saved.platform,windows:[[1]]}},
      {...saved,platform:{...saved.platform,animations:{states:[],bases:null}}},
      {...saved,scheduler:{currentId:1,nextId:2,nextTaskId:1,clock:0,turn:0,steps:0,contexts:[],tasks:[]}},
      {...saved,frames:[{...saved.frames[0],pc:-1}]},
      {...saved,codeOwner:{}}
    ];
    for(const snapshot of malformed) {
      assert.throws(()=>vm.restore(snapshot),TypeError);
      assert.equal(vm.heap.records,current.heap);assert.equal(vm.frames,current.frames);assert.equal(vm.output,current.output);
      assert.equal(vm.instructions,current.instructions);assert.equal(vm.heap.mutationRevision,current.revision);
    }
  });
  test(`a05-06 ${engine}: synchronization and suspended intrinsics restore together after their live roots are gone`,()=>{
    const vm=create(nested),gate=vm.heap.object('object',[]),array=createArray(vm,'int',[256]);
    vm.heap.get(array).data=Array.from({length:256},(_,index)=>256-index);
    vm.sync.enter(gate);vm.sync.enter(gate);mutateArray(vm,'Sort',array);
    resumeArrayOperation(vm,vm.top,{workBudget:1});
    const saved=vm.snapshot(),prefix=[...vm.heap.get(array).data],work=saved.frames[0].intrinsicContinuation.work;
    vm.stop();vm.sync.clear();vm.heap.collect();assert.throws(()=>vm.heap.get(array));assert.throws(()=>vm.heap.get(gate));
    for(let replay=0;replay<2;replay++){
      vm.restore(saved);assert.equal(vm.sync.block(gate).depth,2);assert.equal(vm.scheduler.current.frames,vm.frames);
      assert.equal(vm.top.intrinsicContinuation.work,work);assert.deepEqual(vm.heap.get(array).data,prefix);
      while(!resumeArrayOperation(vm,vm.top,{workBudget:2}).done){}
      assert.deepEqual(vm.heap.get(array).data,Array.from({length:256},(_,index)=>index+1));
      vm.sync.exit(gate);assert.equal(vm.sync.block(gate).depth,1);assert.equal(saved.sync.blocks[0][1].depth,2);
    }
  });
  test(`a05-06 ${engine}: corrupt sync, shape, aliases and continuation snapshots fail atomically`,()=>{
    const vm=create(nested),gate=vm.heap.object('object',[]),array=createArray(vm,'int',[128]);
    vm.sync.enter(gate);mutateArray(vm,'Reverse',array);const saved=vm.snapshot();
    const baseline={frames:vm.frames,heap:vm.heap.records,sync:vm.sync.blocks,scheduler:vm.scheduler.contexts,revision:vm.heap.mutationRevision};
    const corruptions=[
      state=>{state.sync.blocks[0][1].depth=0;},
      state=>{state.sync.blocks[0][1].owner=999;},
      state=>{state.frames[0].intrinsicContinuation.reference={h:array.h,g:array.g+1};},
      state=>{state.frames[0].intrinsicContinuation.owner=Object.freeze({});},
      state=>{state.frames[0].intrinsicContinuation.index=4;},
      state=>{state.heap.records[array.h].arrayShape={rank:1,szArray:true,lengths:[127],lowerBounds:[0],strides:[1]};},
      state=>{state.scheduler.contexts[0][1].frames=[{...state.frames[0]}];},
      state=>{state.scheduler.unhandledFault={name:'Exception',message:'unowned host fault'};}
    ];
    for(const corrupt of corruptions){const memo=new Map([[saved.codeOwner,saved.codeOwner]]);copyFrames(saved.frames,memo);const state=copyExecution(saved,memo);corrupt(state);assert.throws(()=>vm.restore(state),TypeError);
      assert.equal(vm.frames,baseline.frames);assert.equal(vm.heap.records,baseline.heap);assert.equal(vm.sync.blocks,baseline.sync);
      assert.equal(vm.scheduler.contexts,baseline.scheduler);assert.equal(vm.heap.mutationRevision,baseline.revision);
    }
  });
  test(`a05-06 ${engine}: monitor wait tasks and Boolean addresses replay from parked contexts`,()=>{
    const vm=create(compile('bool taken=false;Console.WriteLine(taken);')),gate=vm.heap.object('object',[]);
    vm.sync.enter(gate);const entry=vm.inspector?vm.top.method.token:vm.top.methodId;
    const worker=vm.scheduler.createContext(()=>{vm.call(entry,[]);return SUSPENDED;},[],{name:'Monitor waiter'});
    vm.scheduler.save();vm.scheduler.load(vm.scheduler.contexts.get(worker));vm.top.locals[0]=vm.inspector?0:false;
    const flag=vm.address('local',0);assert.equal(vm.sync.enter(gate,{flag}),SUSPENDED);
    vm.scheduler.save();vm.scheduler.load(vm.scheduler.contexts.get(1));
    const saved=vm.snapshot();assert.equal(saved.sync.blocks[0][1].entries[0].flag,flag);
    const corrupt=copyExecution(saved.sync);corrupt.blocks[0][1].entries[0].contextId=1;
    const revision=vm.heap.mutationRevision;assert.throws(()=>vm.restore({...saved,sync:corrupt}),TypeError);assert.equal(vm.heap.mutationRevision,revision);
    vm.stop();
    for(let replay=0;replay<2;replay++){
      vm.restore(saved);assert.equal(vm.scheduler.contexts.get(worker).status,'waiting');assert.equal(!!vm.dereference(flag),false);
      vm.sync.exit(gate);assert.equal(vm.scheduler.contexts.get(worker).status,'ready');assert.equal(!!vm.dereference(flag),true);
      assert.equal(vm.sync.block(gate).owner,worker);assert.equal(saved.sync.blocks[0][1].entries.length,1);
    }
  });
}

test('a05-06: filter-style frames retain shared locals and args with immutable code metadata',()=>{
  const locals=[1],args=[2],method={instructions:[]},owner={id:1,method,locals,args},filter={id:2,method,locals,args,filterOwnerId:1};
  const frames=[owner,filter],memo=new Map(),copied=copyFrames(frames,memo);
  assert.equal(copyFrames(frames,memo),copied);assert.equal(copied[0].locals,copied[1].locals);assert.equal(copied[0].args,copied[1].args);
  assert.equal(copied[0].method,method);copied[1].locals[0]=8;assert.equal(locals[0],1);
});

test('a05-06 CIL: live frame addresses replay but post-snapshot frame identities stay expired',()=>{
  const assembly=valueFixture([
    {name:'Main',result:'int',locals:['int'],body:(w,c)=>w.op('ldc.i4.1').op('stloc.0').op('ldloca.s',0).op('call',c.methods.Bump).op('ldloc.0').op('ret')},
    {name:'Bump',parameters:['int&'],body:w=>w.op('ldarg.0').op('ldarg.0').op('ldind.i4').op('ldc.i4.1').op('add').op('stind.i4').op('ret')}
  ]);
  const vm=new CilVirtualMachine(assembly);
  while(vm.frames.length<2)vm.runSlice({instructionBudget:1,timeBudgetMs:1000});
  const pointer=vm.top.args[0],saved=vm.snapshot();assert.equal(vm.dereference(pointer),1);
  const later=vm.address('arg',0);assert.equal(vm.run().returnValue,2);
  assert.throws(()=>vm.dereference(later),{name:'InvalidProgramException'});
  vm.restore(saved);assert.equal(vm.dereference(pointer),1);assert.equal(vm.top.args[0],pointer);
  vm.heap.collect();assert.equal(vm.run().returnValue,2);
});
