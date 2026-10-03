import {ManagedFault} from '../heap.js';

export const fatalFaults=new Set(['InstructionLimitException','OutputLimitException','StackOverflowException','ExecutionLimitException']);
const within=(offset,handler)=>offset>=handler.start&&offset<handler.end;

// Preserve the debugger/snapshot frame shape; this module alone mutates CIL EH state.
export function createExceptionState(){return {exception:null,pending:null,caught:[],unwinds:[]};}
export function* exceptionRoots(frame) {
  if(frame.exception?.reference)yield frame.exception.reference;
  for(const caught of frame.caught??[])if(caught.fault.reference)yield caught.fault.reference;
  for(const unwind of frame.unwinds??[])if(unwind.error?.reference)yield unwind.error.reference;
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
  if(frame.initializes)vm.initialized.set(frame.initializes,'failed');
  vm.frames.pop();throwFault(vm,pending.error);
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
  const frame=vm.top;
  if(!frame){vm.state='faulted';return;}
  const handlers=frame.method.handlers.filter(handler=>within(frame.lastOffset,handler)).sort((a,b)=>(a.end-a.start)-(b.end-b.start));
  const catcher=handlers.find(handler=>handler.flags===0&&vm.matches(fault.reference,vm.inspector.metadata.typeName(handler.catchType)));
  const finals=handlers.filter(handler=>(handler.flags===2||handler.flags===4)&&(!catcher||!within(catcher.target,handler)));
  frame.unwinds=frame.unwinds.filter(unwind=>unwind.active&&catcher&&catcher.target>=unwind.active.target&&catcher.target<unwind.active.handlerEnd);
  frame.pending={kind:'exception',error:fault,catch:catcher,handlers:finals};frame.unwinds.push(frame.pending);
  frame.stack=[];vm.fault=null;continueUnwind(vm,frame);
}
