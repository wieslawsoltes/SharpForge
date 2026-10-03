import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {ManagedHeap} from '@sharpforge/runtime';
import {SUSPENDED} from '../packages/runtime/src/platform.js';
import {mutateArray,resumeArrayOperation,arrayContinuationRoots,arrayWorkQuantum,validateArrayContinuation,cancelArrayOperation} from '../packages/runtime/src/execution/array-ops.js';
import {validateSliceBudget,sliceExpired} from '../packages/runtime/src/execution/slice-budget.js';
import {copyExecution} from '../packages/runtime/src/snapshot.js';
import {sortingVM,loopVM} from './a05-31-fixtures.js';

function context(values) {
  const vm={heap:new ManagedHeap(),snapshotOwner:Object.freeze({}),top:{id:1},value:value=>value};
  const reference=vm.heap.array('double',values.length);vm.heap.get(reference).data=[...values];
  vm.heap.rootProvider=()=>arrayContinuationRoots(vm.top);return {vm,reference};
}

test('preemption: budgets reject malformed host input and ordinary checks occur every 256 work units',()=>{
  for(const value of [-1,.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>validateSliceBudget(value,8),RangeError);
  for(const value of [-1,NaN,Infinity,'8'])assert.throws(()=>validateSliceBudget(1,value),RangeError);
  validateSliceBudget(0,0);validateSliceBudget(1,.1);
  let checks=0;const clock=()=>{checks++;return 100;};
  assert.equal(sliceExpired(0,0,8,clock),true);assert.equal(sliceExpired(255,0,8,clock),false);
  assert.equal(sliceExpired(256,0,8,clock),true);assert.equal(checks,2);
});

test('preemption: continuation work is bounded and checks its deadline every quantum',()=>{
  const {vm,reference}=context(Array.from({length:4096},(_,i)=>4096-i));
  assert.equal(mutateArray(vm,'Sort',reference),SUSPENDED);const state=vm.top.intrinsicContinuation;
  const noWork=resumeArrayOperation(vm,vm.top,{workBudget:0});assert.equal(noWork.work,0);assert.equal(state.work,0);
  assert.equal(resumeArrayOperation(vm,vm.top,{deadline:1,now:()=>1}).work,0);
  let time=0;const slice=resumeArrayOperation(vm,vm.top,{workBudget:100,deadline:3,now:()=>time++});
  assert.equal(slice.work,3);assert.equal(state.work,3);assert.equal(slice.done,false);assert.equal(arrayWorkQuantum,32);
  assert.throws(()=>resumeArrayOperation(vm,vm.top,{workBudget:-1}),RangeError);
});

test('preemption: heapsort retains numeric, null, NaN, and duplicate ordering semantics',()=>{
  for(const values of [[4,3,2,1],[1,1,1,1],[9],[],[null,4,null,1],[3,NaN,-Infinity,0,Infinity,NaN,-2],[5n,1n,3n],[true,false,true]]) {
    const {vm,reference}=context(values);const initial=mutateArray(vm,'Sort',reference);
    if(initial===SUSPENDED)while(!resumeArrayOperation(vm,vm.top,{workBudget:7}).done){}
    const actual=vm.heap.get(reference).data,expected=[...values].sort((a,b)=>typeof a==='number'&&Number.isNaN(a)?typeof b==='number'&&Number.isNaN(b)?0:-1:typeof b==='number'&&Number.isNaN(b)?1:a<b?-1:a>b?1:0);
    assert.deepEqual(actual,expected);
  }
  const {vm,reference}=context([3,1,2]);delete vm.top;
  assert.equal(mutateArray(vm,'Sort',reference),null);assert.deepEqual(vm.heap.get(reference).data,[1,2,3]);
  assert.equal(mutateArray(vm,'Reverse',reference),null);assert.deepEqual(vm.heap.get(reference).data,[3,2,1]);
});

test('preemption: malformed state, foreign ownership, wrong rank, and double start are rejected',()=>{
  const {vm,reference}=context([3,2,1]);mutateArray(vm,'Sort',reference);
  assert.throws(()=>mutateArray(vm,'Reverse',reference),{name:'InvalidProgramException'});
  const saved=copyExecution(vm.top.intrinsicContinuation);vm.top.intrinsicContinuation.owner=Object.freeze({});
  assert.throws(()=>resumeArrayOperation(vm,vm.top),{name:'InvalidProgramException'});
  vm.top.intrinsicContinuation=saved;vm.top.intrinsicContinuation.root=-1;
  assert.throws(()=>validateArrayContinuation(vm,vm.top),{name:'InvalidProgramException'});
  cancelArrayOperation(vm.top);assert.equal(vm.top.intrinsicContinuation,undefined);
  assert.throws(()=>mutateArray(vm,'Sort',null),{name:'ArgumentNullException'});
  assert.throws(()=>mutateArray(vm,'Sort',vm.heap.string('bad')),{name:'ArgumentException'});
  const matrix=vm.heap.allocate('array','int[,]',[0,0]);assert.throws(()=>mutateArray(vm,'Sort',matrix),{name:'RankException'});
});

for(const engine of ['source','cil']) {
  test(`preemption ${engine}: instruction budgets and zero-time slices have exact boundaries`,()=>{
    const vm=loopVM(engine),before=vm.instructions;
    vm.runSlice({instructionBudget:0,timeBudgetMs:8});assert.equal(vm.instructions,before);
    vm.runSlice({instructionBudget:100,timeBudgetMs:0});assert.equal(vm.instructions,before);
    for(const count of [1,2,255,256,257]){const previous=vm.instructions;vm.runSlice({instructionBudget:count,timeBudgetMs:1000});assert.equal(vm.instructions-previous,count);assert.equal(vm.state,'running');}
    const previous=vm.instructions;assert.throws(()=>vm.runSlice({instructionBudget:-1}),RangeError);assert.equal(vm.instructions,previous);
    assert.throws(()=>vm.runSlice({timeBudgetMs:NaN}),RangeError);assert.equal(vm.instructions,previous);vm.stop();
  });

  test(`preemption ${engine}: intrinsic work respects a one-unit slice and instruction limit`,()=>{
    const {vm}=sortingVM(engine,10000);vm.runSlice({instructionBudget:1,timeBudgetMs:8});assert.ok(vm.top.intrinsicContinuation);
    const state=vm.top.intrinsicContinuation,before=vm.instructions;
    vm.runSlice({instructionBudget:1,timeBudgetMs:8});assert.equal(vm.instructions,before+1);assert.equal(state.work,1);
    vm.options.maxInstructions=vm.instructions+2;vm.runSlice({instructionBudget:100,timeBudgetMs:100});
    assert.equal(vm.state,'faulted');assert.equal(vm.fault.name,'InstructionLimitException');
  });

  test(`preemption ${engine}: pending sorts are roots, snapshot replayable, and cancelable`,()=>{
    const {vm,reference}=sortingVM(engine,10000);vm.runSlice({instructionBudget:5,timeBudgetMs:8});assert.ok(vm.top.intrinsicContinuation);
    vm.heap.collect();assert.equal(vm.heap.get(reference).data.length,10000);
    const snapshot=vm.snapshot(),state=copyExecution(vm.top.intrinsicContinuation),prefix=vm.heap.get(reference).data.slice(0,20);
    vm.runSlice({instructionBudget:30,timeBudgetMs:100});vm.restore(snapshot);vm.state='running';
    assert.deepEqual(vm.top.intrinsicContinuation,state);assert.deepEqual(vm.heap.get(reference).data.slice(0,20),prefix);
    while(vm.state==='running')vm.runSlice({instructionBudget:10000,timeBudgetMs:8});
    assert.equal(vm.state,'terminated',vm.fault?.stack);assert.ok(vm.heap.get(reference).data.every((value,index)=>value===index+1));
    vm.restore(snapshot);vm.state='running';vm.stop();vm.heap.collect();assert.throws(()=>vm.heap.get(reference),{name:'InvalidReferenceException'});
  });

  test(`preemption ${engine}: another logical context runs while sorting is pending`,()=>{
    const {vm,reference}=sortingVM(engine,100000,{observer:true,schedulerQuantum:1});
    for(let i=0;i<100&&vm.output.join('')!=='observer\n';i++)vm.runSlice({instructionBudget:1,timeBudgetMs:8});
    assert.equal(vm.output.join(''),'observer\n');
    const frames=vm.scheduler.allFrames();assert.ok(frames.some(frame=>frame.intrinsicContinuation));
    vm.heap.collect();assert.equal(vm.heap.get(reference).data.length,100000);
    const snapshot=vm.snapshot();vm.restore(snapshot);vm.state='running';
    for(let i=0;i<10000&&vm.state==='running';i++)vm.runSlice({instructionBudget:10000,timeBudgetMs:8});
    assert.equal(vm.state,'terminated',vm.fault?.stack);assert.ok(vm.heap.get(reference).data.every((value,index)=>value===index+1));
  });

  test(`preemption ${engine}: 1M Array.Sort slices stay within twice the eight millisecond budget`,()=>{
    const {vm,data}=sortingVM(engine,1_000_000),durations=[];
    while(['ready','running'].includes(vm.state)) {
      const start=performance.now();vm.runSlice({instructionBudget:15000,timeBudgetMs:8});durations.push(performance.now()-start);
    }
    assert.equal(vm.state,'terminated',vm.fault?.stack);assert.ok(durations.length>1);assert.ok(data.every((value,index)=>value===index+1));
    const longest=Math.max(...durations);assert.ok(longest<=16,`Longest ${engine} slice ${longest.toFixed(3)}ms exceeded 16ms (${durations.length} slices)`);
  });

  test(`preemption ${engine}: runAsync abort stops a pending intrinsic at the next yield`,async()=>{
    const {vm,reference}=sortingVM(engine,100000),controller=new AbortController();
    await assert.rejects(vm.runAsync({signal:controller.signal,onSlice:()=>controller.abort()}),{name:'OperationCanceledException'});
    assert.equal(vm.state,'terminated');assert.equal(vm.frames.length,0);vm.heap.collect();assert.throws(()=>vm.heap.get(reference),{name:'InvalidReferenceException'});
  });
}

test('preemption: tiered executor uses the same work/deadline contract',{skip:'Tiered execution is E02 T11; this runtime currently has no tiered executor'},()=>{});
