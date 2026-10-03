import {validateExceptionEventsSnapshot} from './execution/exception-events-snapshot.js';
import {validateVarargsSnapshot} from './execution/varargs-snapshot-validation.js';
import {validateStackSnapshot} from './execution/stack-budget.js';
import {validateMemorySnapshot} from './execution/memory-snapshot-validation.js';
import {heapDataBytes} from './execution/snapshot-buffers.js';
import {ManagedFault,isReference} from './heap.js';
import {validateSynchronizationSnapshot} from './execution/sync-snapshot-validation.js';
import {validateAsyncSnapshot} from './execution/async-snapshot-validation.js';
import {isSnapshotSequence} from './execution/snapshot-buffers.js';
import {validateArrayContinuation} from './execution/array-ops.js';
import {validateArrayShape} from './execution/arrays.js';
import {validatePointer,pointerType} from './execution/managed-pointers.js';

/** Validate every component before a restore can replace live execution state. */
export function validateSnapshotState(vm,s,engine) {
  const fail=part=>{throw new TypeError('Invalid snapshot '+part);};
  const integer=value=>Number.isSafeInteger(value)&&value>=0;
  const pairs=(values,part)=>{
    if(!Array.isArray(values)||values.some(row=>!Array.isArray(row)||row.length!==2))fail(part);
    if(new Set(values.map(row=>row[0])).size!==values.length)fail(part+' keys');
  };
  const allFrames=new Map();
  const frames=(values)=>{
    if(!Array.isArray(values))fail('frames');
    const ids=new Set();
    for(const frame of values) {
      if(!frame||!integer(frame.id)||frame.id===0||ids.has(frame.id)||!integer(frame.pc)||!Array.isArray(frame.locals))fail('frame');
      ids.add(frame.id);
      if(frame.id>s.frameId)fail('frame identity counter');
      if(allFrames.has(frame.id)&&allFrames.get(frame.id)!==frame)fail('duplicate frame identity');
      allFrames.set(frame.id,frame);
      for(const prefix of ['readonlyAccess','volatileAccess','tailCall'])if(frame[prefix]!==undefined&&typeof frame[prefix]!=='boolean')fail('frame prefix');
      if(engine==='cil') {
        if(!frame.method||!Array.isArray(frame.method.instructions)||!Array.isArray(frame.args)||!Array.isArray(frame.stack)||frame.pc>frame.method.instructions.length)fail('CIL frame');
        let original;try{original=vm.inspector.getMethod(frame.method.token);}catch{fail('method identity');}
        if(original.instructions!==frame.method.instructions)fail('method code generation');
        if(!(frame.offsets instanceof Map)||frame.offsets.size!==original.instructions.length||
            original.instructions.some((instruction,index)=>frame.offsets.get(instruction.offset)!==index))fail('method offsets');
      } else {
        const method=vm.image.methods[frame.methodId];
        if(!method||frame.pc>method.code.length/3||!integer(frame.base))fail('source frame');
      }
    }
  };
  frames(s.frames);
  if(!Array.isArray(s.output)||s.output.some(value=>typeof value!=='string')||!integer(s.instructions)||!integer(s.frameId)||!integer(s.outputCharacters)||!Number.isFinite(s.elapsedMs)||s.elapsedMs<0||!['ready','running','paused','waiting','terminated','faulted'].includes(s.state))fail('execution state');
  if(engine==='source'){
    if(!Array.isArray(s.stack)||!Array.isArray(s.statics))fail('source storage');
    pairs(s.constantValues,'source constant cache');
  }
  if(engine==='cil'&&(!(s.statics instanceof Map)||!(s.initialized instanceof Map)))fail('CIL storage');
  if(!(s.strings instanceof Map)||s.typeObjects!==undefined&&!(s.typeObjects instanceof Map))fail('type/string caches');
  const heap=s.heap;
  if(!heap||!Array.isArray(heap.records)||!Array.isArray(heap.generations)||heap.generations.length<heap.records.length||!Array.isArray(heap.free)||!heap.stats||!integer(heap.generationCounter)||!Number.isFinite(heap.threshold)||heap.threshold<0)fail('heap');
  pairs(heap.handles??[],'heap handles');
  const free=new Set();
  for(const index of heap.free) {
    if(!integer(index)||index>=heap.records.length||heap.records[index]!==null||free.has(index))fail('heap free list');
    free.add(index);
  }
  let liveBytes=0,liveObjects=0;
  for(const [index,record] of heap.records.entries()) {
    if(record===null){if(!free.has(index))fail('missing free record');continue;}
    if(!record||typeof record.kind!=='string'||typeof record.type!=='string'||!integer(record.size)||!integer(heap.generations[index])||heap.generations[index]===0||heap.generations[index]>heap.generationCounter)fail('heap record');
    const validData=record.kind==='string'?typeof record.data==='string'
      :record.kind==='array'?isSnapshotSequence(record.data):Array.isArray(record.data);
    if(!validData)fail('heap data');
    const size=record.kind==='string'?24+record.data.length*2:32+heapDataBytes(record.data);
    if(record.size!==size)fail('heap record size');
    liveBytes+=size;liveObjects++;
    if(record.methodTable?.registry!==vm.heap.methodTables)fail('heap type identity');
    if(record.kind==='array')validateArrayShape(record);
  }
  if(liveBytes!==heap.stats.liveBytes||liveObjects!==heap.stats.liveObjects||liveBytes>vm.heap.maxBytes)fail('heap accounting');
  const referenceRecord=reference=>{
    if(!isReference(reference)||!integer(reference.h)||!integer(reference.g)||reference.g===0||reference.heapOwner!==undefined&&reference.heapOwner!==vm.heap.handleOwner||
      heap.generations[reference.h]!==reference.g||!heap.records[reference.h])fail('managed reference');
    return heap.records[reference.h];
  };
  const fault=value=>{if(value!==null&&value!==undefined&&(!(value instanceof ManagedFault)||typeof value.name!=='string'||typeof value.message!=='string'))fail('fault');};
  fault(s.fault);fault(s.pendingFault);
  const scheduler=s.scheduler;
  const contexts=new Map(),tasksByReference=new Map();
  if(scheduler!==null) {
    if(!scheduler||!integer(scheduler.currentId)||!integer(scheduler.nextId)||!integer(scheduler.nextTaskId)||!Number.isFinite(scheduler.clock)||scheduler.clock<0||!integer(scheduler.turn)||!integer(scheduler.steps))fail('scheduler');
    pairs(scheduler.contexts,'scheduler contexts');pairs(scheduler.tasks,'scheduler tasks');
    if(typeof scheduler.parked!=='boolean'||typeof scheduler.suppressed!=='boolean')fail('scheduler flags');
    fault(scheduler.unhandledFault);
    const contextIds=new Set(),parkedFrameIds=new Set();
    for(const [id,context] of scheduler.contexts) {
      if(!integer(id)||id===0||context.id!==id||!['ready','running','waiting','completed','faulted','canceled'].includes(context.status))fail('context');
      if(id>=scheduler.nextId||typeof context.frozen!=='boolean')fail('context identity');
      contextIds.add(id);contexts.set(id,context);frames(context.frames);
      for(const frame of context.frames){if(parkedFrameIds.has(frame.id))fail('duplicate frame identity');parkedFrameIds.add(frame.id);}
      if(context.stack!==undefined&&!Array.isArray(context.stack))fail('context stack');
      fault(context.fault);fault(context.pendingFault);fault(context.resumeFault);
      if(context.wait!==null&&context.wait!==undefined){
        if(!context.wait||typeof context.wait!=='object')fail('context wait');
        referenceRecord(context.wait.task);
        for(const flag of ['pushResult','voidResult','propagateFault'])if(context.wait[flag]!==undefined&&typeof context.wait[flag]!=='boolean')fail('context wait flags');
      }
    }
    if(!contextIds.has(scheduler.currentId))fail('current context');
    const current=contexts.get(scheduler.currentId);
    if(!scheduler.parked&&(current.frames!==s.frames||engine==='source'&&current.stack!==s.stack))fail('current context aliases');
    if(scheduler.parked&&(s.frames.length||engine==='source'&&s.stack.length))fail('parked execution');
    for(const [id,task] of scheduler.tasks){
      if(!integer(id)||id===0||id>=scheduler.nextTaskId||task?.id!==id||!Array.isArray(task.waiters)||new Set(task.waiters).size!==task.waiters.length||task.waiters.some(id=>!contextIds.has(id))||
        !['waiting','running','completed','faulted','canceled'].includes(task.status)||task.dependencies!==null&&task.dependencies!==undefined&&!Array.isArray(task.dependencies))fail('task');
      fault(task.error);
      if(!isReference(task.ref)||!integer(task.ref.h)||!integer(task.ref.g)||task.ref.g===0||task.ref.heapOwner!==undefined&&task.ref.heapOwner!==vm.heap.handleOwner)fail('task reference');
      // Completed task rows may remain until the scheduler next prunes them.
      if(!['completed','faulted','canceled'].includes(task.status))referenceRecord(task.ref);
      const key=task.ref.h+':'+task.ref.g;
      if(tasksByReference.has(key))fail('duplicate task reference');tasksByReference.set(key,task);
    }
  }
  for(const frame of allFrames.values()) {
    if(frame.filterOwnerId!==undefined&&frame.filterOwnerId!==null){
      const owner=allFrames.get(frame.filterOwnerId);
      if(!owner||frame.locals!==owner.locals||engine==='cil'&&frame.args!==owner.args)fail('filter storage aliases');
    }
    if(frame.intrinsicContinuation!==undefined){
      const record=referenceRecord(frame.intrinsicContinuation?.reference);
      try{validateArrayContinuation(vm,frame,record);}catch{fail('array continuation');}
      if(frame.intrinsicContinuation.pushResult!==(engine==='source'))fail('array continuation result');
    }
  }
  validateSynchronizationSnapshot(vm,s.sync,s);
  if(s.sync.blocks.length&&scheduler===null)fail('synchronization contexts');
  const snapshotContext={snapshotOwner:vm.snapshotOwner,heap:{methodTables:vm.heap.methodTables,handleOwner:vm.heap.handleOwner,get:referenceRecord},
    frameIndex:allFrames,options:vm.options,memorySequence:s.memorySequence,
    inspector:vm.inspector,image:vm.image,frames:s.frames,statics:s.statics,slotType:vm.slotType?.bind(vm),
    scheduler:{contexts,currentId:scheduler?.currentId,parked:scheduler?.parked}};
  const queuedContexts=new Set();
  for(const [,block] of s.sync.blocks)for(const item of [...block.entries,...block.conditions]) {
    const context=contexts.get(item.contextId),task=tasksByReference.get(item.task.h+':'+item.task.g);
    if(!context||context.status!=='waiting'||!task||task.status!=='waiting'||!task.waiters.includes(item.contextId)||
      !context.wait||context.wait.task.h!==item.task.h||context.wait.task.g!==item.task.g||queuedContexts.has(item.contextId))fail('synchronization wait');
    queuedContexts.add(item.contextId);
    if(item.flag!==null){
      try{validatePointer(snapshotContext,item.flag,{write:true});if(pointerType(snapshotContext,item.flag)?.name!=='System.Boolean')fail('monitor flag');}
      catch{fail('monitor flag address');}
    }
  }
  const platform=s.platform;
  if(!platform||!integer(platform.sequence)||!platform.animations)fail('platform');
  pairs(platform.windows,'platform windows');pairs(platform.singletons??[],'platform singletons');
  const animations=platform.animations;
  if(!Array.isArray(animations.states)||!Array.isArray(animations.bases))fail('animation state');
  validateExceptionEventsSnapshot(vm,s);
  validateAsyncSnapshot(vm,s);
  validateMemorySnapshot(vm,s);
  validateStackSnapshot(vm,s);
  validateVarargsSnapshot(vm,s);
}
