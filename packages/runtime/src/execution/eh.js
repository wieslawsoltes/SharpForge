import {ManagedFault} from '../heap.js';
import {failInitialization} from './static-init.js';

export const fatalFaults=new Set(['InstructionLimitException','OutputLimitException','StackOverflowException','ExecutionLimitException']);
const within=(offset,handler)=>offset>=handler.start&&offset<handler.end;

// Preserve the debugger/snapshot frame shape; this module alone mutates CIL EH state.
export function createExceptionState(){return {exception:null,pending:null,caught:[],unwinds:[]};}
export function* exceptionRoots(frame) {
  if(frame.exception?.reference)yield frame.exception.reference;
  for(const caught of frame.caught??[])if(caught.fault.reference)yield caught.fault.reference;
  for(const unwind of frame.unwinds??[]){if(unwind.error?.reference)yield unwind.error.reference;if(unwind.value!==undefined)yield unwind.value;}
  if(frame.filterSearch?.error.reference)yield frame.filterSearch.error.reference;
}

const activeClauses=(frame,offset)=>frame.method.handlers.filter(handler=>within(offset,handler)).sort((a,b)=>(a.end-a.start)-(b.end-b.start));
const frameById=(vm,id)=>vm.frames.find(frame=>frame.id===id);

/** ECMA-335 I.12.4.2: search runs before any finally/fault cleanup, even across calls. */
function searchHandlers(vm,search) {
  while(search.cursor<search.frames.length) {
    const location=search.frames[search.cursor],frame=frameById(vm,location.id);
    if(!frame){search.cursor++;search.clause=0;continue;}
    const clauses=frame.needsInitialization||frame.filterSearch?[]:activeClauses(frame,location.offset);
    while(search.clause<clauses.length) {
      const handler=clauses[search.clause++];
      if(handler.flags===0&&vm.matches(search.error.reference,vm.inspector.metadata.typeName(handler.catchType))) {
        search.selection={kind:'catch',frameId:frame.id,handler};beginUnwind(vm,search);return;
      }
      if(handler.flags===1) {
        if(vm.frames.length>=vm.options.maxFrames)throw new ManagedFault('StackOverflowException','Managed filter call depth exceeded');
        // A filter evaluates in its declaring method's locals while younger frames
        // remain live. Shared arrays also retain their aliasing through snapshots.
        vm.frames.push({id:++vm.frameId,method:frame.method,args:frame.args,locals:frame.locals,stack:[search.error.reference],pc:frame.offsets.get(handler.catchType),lastOffset:handler.catchType,offsets:frame.offsets,...createExceptionState(),needsInitialization:false,
          genericIdentity:frame.genericIdentity??null,methodArguments:frame.methodArguments??[],filterSearch:search,filterOwnerId:frame.id,filterHandler:handler});
        return;
      }
    }
    if(frame.initializes) {
      // The runtime's cctor boundary first completes its own cleanup, wraps the
      // failure, then starts an outer search for TypeInitializationException.
      search.selection={kind:'initializer',frameId:frame.id};beginUnwind(vm,search);return;
    }
    if(frame.filterSearch) {
      search.selection={kind:'filter-failure',frameId:frame.id};beginUnwind(vm,search);return;
    }
    search.cursor++;search.clause=0;
  }
  beginUnwind(vm,search);
}

function beginUnwind(vm,search) {
  const frame=vm.top;
  if(!frame){vm.fault=search.error;vm.state='faulted';return;}
  const location=search.frames.find(location=>location.id===frame.id),selection=search.selection;
  const catcher=selection?.kind==='catch'&&selection.frameId===frame.id?selection.handler:null;
  const finals=frame.needsInitialization||frame.filterSearch?[]:activeClauses(frame,location?.offset??frame.lastOffset).filter(handler=>(handler.flags===2||handler.flags===4)&&(!catcher||!within(catcher.target,handler)));
  frame.unwinds=frame.unwinds.filter(unwind=>unwind.active&&catcher&&catcher.target>=unwind.active.target&&catcher.target<unwind.active.handlerEnd);
  frame.pending={kind:'exception',error:search.error,catch:catcher,handlers:finals,search};frame.unwinds.push(frame.pending);
  frame.stack=[];frame.volatileAccess=false;vm.fault=null;continueUnwind(vm,frame);
}

export function endFilter(vm,value) {
  const frame=vm.top,search=frame?.filterSearch;
  if(!search)throw new ManagedFault('InvalidProgramException','endfilter outside a filter');
  if(!Number.isInteger(value))throw new ManagedFault('InvalidProgramException','endfilter requires an Int32 decision');
  vm.frames.pop();
  if(value!==0){search.selection={kind:'catch',frameId:frame.filterOwnerId,handler:frame.filterHandler};beginUnwind(vm,search);}
  else searchHandlers(vm,search);
}

/** Enter a leave or resume an exception/finally continuation. */
export function continueUnwind(vm,frame,leave=null) {
  if(leave) {
    frame.stack=[];
    frame.pending={kind:'leave',target:leave.operand,handlers:frame.method.handlers.filter(handler=>handler.flags===2&&within(leave.offset,handler)&&!within(leave.operand,handler)).sort((a,b)=>(a.end-a.start)-(b.end-b.start))};
    frame.unwinds.push(frame.pending);
  }
  const pending=frame.pending;
  if(!pending)throw new ManagedFault('InvalidProgramException','endfinally outside an unwind');
  if(pending.handlers.length) {
    const next=pending.handlers.shift();pending.active=next;
    frame.pc=frame.offsets.get(next.target);frame.stack=[];return;
  }
  frame.unwinds.pop();frame.pending=frame.unwinds.at(-1)??null;
  if(pending.kind==='leave'){frame.pc=frame.offsets.get(pending.target);return;}
  if(pending.catch) {
    frame.caught=(frame.caught??[]).filter(caught=>pending.catch.target>=caught.start&&pending.catch.target<caught.end&&caught.start!==pending.catch.target);
    frame.caught.push({start:pending.catch.target,end:pending.catch.handlerEnd,fault:pending.error});
    frame.exception=pending.error;frame.stack=[pending.error.reference];frame.pc=frame.offsets.get(pending.catch.target);return;
  }
  const search=pending.search;
  if(search?.selection?.kind==='filter-failure'&&search.selection.frameId===frame.id){endFilter(vm,0);return;}
  const error=frame.initializes?failInitialization(vm,frame,pending.error):pending.error;
  vm.frames.pop();
  if(frame.initializes||!search)throwFault(vm,error);
  else beginUnwind(vm,search);
}

/** Raise a runtime fault, or execute throw/rethrow through the first-chance boundary. */
export function throwFault(vm,error,instruction=null) {
  if(instruction?.name==='rethrow')throw [...(vm.top.caught??[])].reverse().find(caught=>instruction.offset>=caught.start&&instruction.offset<caught.end)?.fault??new ManagedFault('InvalidProgramException','No active catch');
  if(instruction?.name==='throw') {
    const ref=vm.pop();
    if(ref===null)throw new ManagedFault('NullReferenceException','Null exception');
    const record=vm.heap.get(ref);
    if(record.kind!=='exception'&&!vm.matches(ref,'System.Exception'))throw new ManagedFault('InvalidProgramException','Thrown value is not an exception');
    throw new ManagedFault(record.type,vm.format(record.data[0]),ref);
  }
  const fault=error instanceof ManagedFault?error:new ManagedFault('InvalidProgramException',error.message??String(error));vm.fault=fault;
  if(fatalFaults.has(fault.name)){vm.state='faulted';return;}
  if(!fault.reference) {
    try{const message=vm.heap.string(fault.message);fault.reference=vm.heap.allocate('exception',fault.name,[message],[message]);}
    catch{vm.state='faulted';return;}
  }
  if(!vm.top){vm.state='faulted';return;}
  vm.top.volatileAccess=false;vm.fault=null;
  const search={error:fault,frames:[...vm.frames].reverse().map(frame=>({id:frame.id,offset:frame.lastOffset})),cursor:0,clause:0,selection:null};
  searchHandlers(vm,search);
}
