import {ManagedFault} from '../heap.js';

const triggers=new Set(['field','static-method','constructor','instance-method','interface-method']);
export function initializationKey(typeToken,genericIdentity=null) {
  return genericIdentity===null||genericIdentity===undefined?typeToken:`${typeToken}:${JSON.stringify(genericIdentity)}`;
}
function mustInitialize(vm,typeToken,trigger) {
  if(!triggers.has(trigger))throw new TypeError(`Unknown type initialization trigger '${trigger}'`);
  const type=vm.typeSystem.types.get(typeToken);
  if(!type)return false;
  if(type.flags&0x100000)return trigger==='field';
  if(trigger==='interface-method')return !!(type.flags&0x20);
  if(trigger!=='instance-method')return true;
  const base=type.baseToken?vm.inspector.metadata.typeName(type.baseToken):null;
  return base==='System.ValueType'||base==='System.Enum';
}
function createsInitializationCycle(vm,ownerContext,currentContext) {
  const seen=new Set();
  while(ownerContext&&!seen.has(ownerContext)) {
    if(ownerContext===currentContext)return true;
    seen.add(ownerContext);
    const waiting=vm.scheduler.contexts.get(ownerContext)?.wait;
    if(!waiting)return false;
    ownerContext=vm.scheduler.taskRecord(waiting.task).contextId;
  }
  return false;
}
/** Returns true when the triggering instruction must retry after initialization/waiting.
 * ECMA-335 I.8.9.5: beforefieldinit chooses the permitted lazy field-trigger policy.
 */
export function ensureTypeInitialized(vm,typeToken,trigger='field',genericIdentity=null) {
  if(!mustInitialize(vm,typeToken,trigger))return false;
  const key=initializationKey(typeToken,genericIdentity),context=vm.scheduler?.currentId??1;
  const state=vm.initialized.get(key);
  if(state?.status==='initialized')return false;
  if(state?.status==='failed')throw state.fault;
  if(state?.status==='initializing') {
    if(state.ownerContext===context||createsInitializationCycle(vm,state.ownerContext,context))return false;
    if(!state.waitTask)state.waitTask=vm.scheduler.createTask('void',{contextId:state.ownerContext}).ref;
    vm.scheduler.wait(state.waitTask,{pushResult:false});
    return true;
  }
  const initializer=vm.typeSystem.initializers.get(typeToken);
  const record={status:initializer?'initializing':'initialized',typeToken,genericIdentity,ownerContext:initializer?context:null,waitTask:null,fault:null};
  vm.initialized.set(key,record);
  if(!initializer)return false;
  try {vm.call(initializer.token,[],{initializes:key,genericIdentity});}
  catch(error) {throw failInitialization(vm,{initializes:key},error);}
  return true;
}
function wakeWaiters(vm,state) {
  if(state.waitTask) {
    // Waiters retry their original instruction, including its normal first-chance
    // exception boundary when the cached initializer failure is rethrown.
    vm.scheduler.complete(vm.scheduler.taskRecord(state.waitTask));
    state.waitTask=null;
  }
}
export function completeInitialization(vm,frame) {
  const state=vm.initialized.get(frame.initializes);
  if(!state||state.status!=='initializing')return;
  state.status='initialized';state.ownerContext=null;wakeWaiters(vm,state);
}
export function failInitialization(vm,frame,error) {
  const state=vm.initialized.get(frame.initializes);
  if(!state)return error;
  if(state.status==='failed')return state.fault;
  const inner=error instanceof ManagedFault?error:new ManagedFault('InvalidProgramException',error.message??String(error));
  // EH has already popped its pending unwind. Keep the initiating cause rooted
  // and recoverable if allocating TypeInitializationException itself fails.
  state.fault = inner;
  if(['InstructionLimitException','OutputLimitException','StackOverflowException','ExecutionLimitException'].includes(inner.name)) {
    state.status='failed';state.fault=inner;state.ownerContext=null;wakeWaiters(vm,state);return inner;
  }
  const name=state.genericIdentity??vm.typeSystem.types.get(state.typeToken)?.name??String(state.typeToken);
  const message=`The type initializer for '${name}' threw an exception.`;
  const fault=vm.heap.withRoots([inner.reference],()=>{
    if(!inner.reference) {
      const text=vm.heap.string(inner.message);
      inner.reference=vm.heap.allocate('exception',inner.name,[text],[text]);
    }
    return vm.heap.withRoots([inner.reference],()=>{
      const text=vm.heap.string(message);
      const reference=vm.heap.allocate('exception','System.TypeInitializationException',[text,inner.reference],[text,inner.reference]);
      const wrapped=new ManagedFault('TypeInitializationException',message,reference);
      wrapped.innerException=inner;wrapped.typeName=name;wrapped.frames=inner.frames;return wrapped;
    });
  });
  state.status='failed';state.fault=fault;state.ownerContext=null;wakeWaiters(vm,state);return fault;
}

function recoverInitializationWaiters(vm, state) {
  const task = vm.scheduler.taskRecord(state.waitTask);
  try { vm.scheduler.complete(task); }
  finally {
    // Initialization waits only retry an instruction. A host write observer may
    // throw after complete marks the task terminal but before it releases waiters.
    for (const id of task.waiters) {
      const context = vm.scheduler.contexts.get(id);
      if (!context?.wait || ['completed', 'faulted', 'canceled'].includes(context.status)) continue;
      const reference = context.wait.task;
      if (reference.h !== task.ref.h || reference.g !== task.ref.g) continue;
      context.wait = null;
      context.status = 'ready';
    }
    task.waiters.clear();
    state.waitTask = null;
  }
}

/** Settle an abandoned initializer even if its exception wrapper or host task notification fails.
 * Return secondary failures for the callback owner to retain on the original thrown error.
 */
export function abandonInitialization(vm, frame, error) {
  const state = vm.initialized.get(frame.initializes);
  if (!state) return null;
  const inner = state.fault ?? frame.pending?.error ?? error;
  let failures = null;
  try { failInitialization(vm, frame, inner); }
  catch (failure) {
    (failures ??= []).push(failure);
    if (state.status !== 'failed') {
      state.status = 'failed';
      state.fault = inner instanceof ManagedFault ? inner
        : new ManagedFault('InvalidProgramException', inner.message ?? String(inner));
    }
    state.ownerContext = null;
  }
  if (state.waitTask) {
    try { recoverInitializationWaiters(vm, state); }
    catch (failure) { (failures ??= []).push(failure); }
  }
  return failures;
}

export function* initializationRoots(vm) {
  for(const state of vm.initialized.values()) {
    if(state.fault?.reference)yield state.fault.reference;
    if(state.waitTask)yield state.waitTask;
  }
}
