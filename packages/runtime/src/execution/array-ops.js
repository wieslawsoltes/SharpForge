import {ManagedFault,isReference} from '../heap.js';
import {SUSPENDED} from './suspension.js';

/** One charged work unit has a fixed upper bound independent of array length. */
export const arrayWorkQuantum=32;
const owner=vm=>vm.snapshotOwner??vm.heap.handleOwner;
const invalid=message=>new ManagedFault('InvalidProgramException',message);
const clock=()=>performance.now();
const integer=Number.isSafeInteger;
function recordFor(vm,reference) {
  if(reference===null)throw new ManagedFault('ArgumentNullException','Array cannot be null');
  const record=vm.heap.get(reference);
  if(record.kind!=='array')throw new ManagedFault('ArgumentException','Array required');
  if(record.methodTable?.rank>1)throw new ManagedFault('RankException','Array.Sort and Array.Reverse require one dimension');
  return record;
}
function compare(vm,left,right) {
  const a=vm.value(left),b=vm.value(right);
  if(a===null||b===null)return a===b?0:a===null?-1:1;
  if(typeof a==='number'&&typeof b==='number')return Number.isNaN(a)?Number.isNaN(b)?0:-1:Number.isNaN(b)?1:a<b?-1:a>b?1:0;
  if(typeof a==='bigint'&&typeof b==='bigint'||typeof a==='boolean'&&typeof b==='boolean')return a<b?-1:a>b?1:0;
  return String(a).localeCompare(String(b),'en');
}
function swap(data,a,b) {const value=data[a];data[a]=data[b];data[b]=value;}
function step(vm,state,data) {
  if(state.operation==='Reverse') {
    if(state.index>=state.end)return true;
    swap(data,state.index++,state.end--);return state.index>=state.end;
  }
  if(!state.sifting) {
    if(state.phase==='build') {
      if(state.buildIndex<0){state.phase='extract';return false;}
      state.root=state.buildIndex--;state.sifting=true;
    } else {
      if(state.end<=0)return true;
      swap(data,0,state.end--);state.root=0;state.sifting=true;
    }
  }
  const child=state.root*2+1;
  if(child>state.end){state.sifting=false;return false;}
  const greater=child+1<=state.end&&compare(vm,data[child],data[child+1])<0?child+1:child;
  if(compare(vm,data[state.root],data[greater])>=0){state.sifting=false;return false;}
  swap(data,state.root,greater);state.root=greater;return false;
}

/** Validate the small state record; never scan the array during a slice. */
export function validateArrayContinuation(vm,frame,record=null) {
  const state=frame.intrinsicContinuation;
  if(!state)return null;
  if(state.kind!=='array'||state.owner!==owner(vm)||state.frameId!==(frame.id??0)||(state.operation!=='Sort'&&state.operation!=='Reverse')||(state.phase!=='build'&&state.phase!=='extract')||typeof state.sifting!=='boolean'||typeof state.pushResult!=='boolean')throw invalid('Malformed or foreign array continuation');
  if(!isReference(state.reference)||!integer(state.reference.h)||state.reference.h<0||!integer(state.reference.g)||state.reference.g<1||state.reference.heapOwner!==undefined&&state.reference.heapOwner!==vm.heap.handleOwner)throw invalid('Array continuation reference belongs to another heap');
  if(!integer(state.length)||state.length<2||!integer(state.index)||state.index<0||state.index>state.length||!integer(state.end)||state.end<0||state.end>=state.length||!integer(state.root)||state.root<0||state.root>=state.length||!integer(state.buildIndex)||state.buildIndex< -1||state.buildIndex>=Math.floor(state.length/2)||!integer(state.work)||state.work<0)throw invalid('Array continuation indices are invalid');
  record??=recordFor(vm,state.reference);
  if(record.kind!=='array'||record.data.length!==state.length||record.methodTable?.rank>1)throw invalid('Array changed shape during an intrinsic');
  if(state.operation==='Reverse'&&(state.phase!=='build'||state.sifting||state.root!==0||state.buildIndex!==Math.floor(state.length/2)-1||state.index+state.end!==state.length-1)||
    state.operation==='Sort'&&(state.index!==0||state.phase==='build'&&state.end!==state.length-1||state.phase==='extract'&&state.buildIndex!==-1||state.root>state.end))throw invalid('Array continuation phase is inconsistent');
  return state;
}

/** Start an in-place operation. The VM resumes it before its next IL/IR opcode. */
export function mutateArray(vm,name,reference) {
  const record=recordFor(vm,reference);
  if(!['Sort','Reverse'].includes(name))throw new ManagedFault('MissingMethodException','Unsupported array operation');
  if(record.data.length<2)return null;
  const frame=vm.top??{id:0};
  if(frame.intrinsicContinuation)throw invalid('A frame already has a pending intrinsic');
  frame.intrinsicContinuation={kind:'array',owner:owner(vm),frameId:frame.id??0,operation:name,reference,length:record.data.length,
    phase:'build',buildIndex:Math.floor(record.data.length/2)-1,root:0,sifting:false,index:0,end:record.data.length-1,work:0,pushResult:!vm.inspector};
  // The extracted builtin seam remains callable without an image or VM frame.
  // Such direct synchronous callers have no runSlice contract to yield through.
  if(!vm.top){while(!resumeArrayOperation(vm,frame,{workBudget:1024}).done){}return null;}
  return SUSPENDED;
}

/** No data copies, callbacks, native sort, or heap allocation in the work loop. */
export function resumeArrayOperation(vm,frame,{deadline=Infinity,workBudget=1,now=clock}={}) {
  if(!Number.isSafeInteger(workBudget)||workBudget<0||typeof deadline!=='number'||Number.isNaN(deadline))throw new RangeError('Invalid intrinsic work budget');
  const state=validateArrayContinuation(vm,frame);
  if(!state)return {work:0,done:true,returns:false,value:null};
  const record=recordFor(vm,state.reference);let work=0,done=false;
  try {
    while(work<workBudget&&now()<deadline) {
      for(let i=0;i<arrayWorkQuantum;i++){if(step(vm,state,record.data)){done=true;break;}}
      work++;state.work++;
      if(done)break;
    }
  } catch(error) {
    delete frame.intrinsicContinuation;vm.heap.mutationRevision++;throw error;
  }
  if(work)vm.heap.mutationRevision++;
  if(done)delete frame.intrinsicContinuation;
  return {work,done,returns:state.pushResult,value:null};
}
export function cancelArrayOperation(frame) {delete frame.intrinsicContinuation;}
export function* arrayContinuationRoots(frame) {if(frame.intrinsicContinuation?.kind==='array')yield frame.intrinsicContinuation.reference;}
