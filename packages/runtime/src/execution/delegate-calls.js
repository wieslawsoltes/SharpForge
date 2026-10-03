import {managedDelegateSignature} from '@sharpforge/cil';
import {ManagedFault,isReference} from '../heap.js';
import {SUSPENDED} from './suspension.js';

const equalRef=(a,b)=>a===b||isReference(a)&&isReference(b)&&a.h===b.h&&a.g===b.g&&(a.heapOwner===undefined||b.heapOwner===undefined||a.heapOwner===b.heapOwner);
function record(vm,ref) {
  const value=vm.heap.get(ref);
  if(value.kind!=='delegate')throw new ManagedFault('ArgumentException','A managed delegate is required');
  return value;
}
export function delegateEntries(vm,ref) {
  if(ref===null)return [];
  record(vm,ref);const list=vm.platform.get(ref,'invocationList');
  return list?[...vm.heap.get(list).data]:[ref];
}
function entryEquals(vm,a,b) {
  if(equalRef(a,b))return true;
  return record(vm,a).type===record(vm,b).type&&equalRef(vm.platform.get(a,'receiver'),vm.platform.get(b,'receiver'))&&JSON.stringify(vm.platform.get(a,'pointer')?.identity??vm.platform.get(a,'method'))===JSON.stringify(vm.platform.get(b,'pointer')?.identity??vm.platform.get(b,'method'));
}
export function delegatesEqual(vm,a,b) {
  if(a===null||b===null)return a===b;
  const first=delegateEntries(vm,a),second=delegateEntries(vm,b);
  return first.length===second.length&&first.every((entry,index)=>entryEquals(vm,entry,second[index]));
}
function typeCompatible(vm,source,target) {
  const a=vm.typeSystem.table(source),b=vm.typeSystem.table(target);
  return a===b||!a.flags.valueType&&!b.flags.valueType&&vm.typeSystem.castCache.isAssignableFrom(b,a);
}
export function constructDelegate(vm,type,receiver,pointer) {
  const signature=managedDelegateSignature(vm.inspector,type);
  if(!signature||!pointer?.methodPointer||pointer.vmOwner!==vm.snapshotOwner)throw new ManagedFault('ArgumentException','Delegate construction requires a verified managed function pointer');
  const method=pointer.descriptor.signature,parameters=[...method.parameters];let mode='static';
  if(!method.isStatic) {
    if(receiver===null){mode='open-instance';parameters.unshift(pointer.descriptor.ownerInstance??pointer.descriptor.owner);}
    else {mode='closed-instance';if(!vm.matches(receiver,pointer.descriptor.ownerInstance??pointer.descriptor.owner))throw new ManagedFault('ArgumentException','Delegate receiver type mismatch');}
  } else if(receiver!==null){mode='closed-static';if(!parameters.length||!vm.matches(receiver,parameters.shift()))throw new ManagedFault('ArgumentException','Closed static delegate receiver mismatch');}
  if(parameters.length!==signature.parameters.length||!parameters.every((type,index)=>type===signature.parameters[index]||!type.endsWith('&')&&!signature.parameters[index].endsWith('&')&&typeCompatible(vm,signature.parameters[index],type))||method.returnType!==signature.returnType&&(method.returnType==='void'||signature.returnType==='void'||!typeCompatible(vm,method.returnType,signature.returnType)))throw new ManagedFault('ArgumentException','Delegate signature does not match the method target');
  return vm.platform.make(type,{method:pointer.descriptor.resolvedToken??pointer.token,receiver,pointer,mode},'delegate');
}
function fromEntries(vm,type,entries) {
  if(!entries.length)return null;if(entries.length===1)return entries[0];
  if(entries.length>(vm.options.maxDelegateTargets??4096))throw new ManagedFault('ExecutionLimitException','Delegate invocation list limit exceeded');
  return vm.heap.withRoots(entries,()=>{
    const list=vm.heap.allocate('array','System.Delegate[]',entries);
    return vm.heap.withRoots([list],()=>vm.platform.make(type,{method:vm.platform.get(entries[0],'method'),receiver:vm.platform.get(entries[0],'receiver'),invocationList:list},'delegate'));
  });
}
export function combineDelegates(vm,a,b) {
  if(a===null)return b;if(b===null)return a;
  const type=record(vm,a).type;if(record(vm,b).type!==type)throw new ManagedFault('ArgumentException','Cannot combine different delegate types');
  return fromEntries(vm,type,[...delegateEntries(vm,a),...delegateEntries(vm,b)]);
}
export function removeDelegate(vm,source,value,all=false) {
  if(source===null||value===null)return source;
  const type=record(vm,source).type;if(record(vm,value).type!==type)throw new ManagedFault('ArgumentException','Cannot remove a different delegate type');
  const entries=delegateEntries(vm,source),remove=delegateEntries(vm,value);let changed=false;
  do {
    let at=-1;
    for(let index=entries.length-remove.length;index>=0;index--)if(remove.every((entry,offset)=>entryEquals(vm,entries[index+offset],entry))){at=index;break;}
    if(at<0)break;entries.splice(at,remove.length);changed=true;
  } while(all);
  return changed?fromEntries(vm,type,entries):source;
}
function invokeEntry(vm,entry,args,continuation) {
  const pointer=vm.platform.get(entry,'pointer'),receiver=vm.platform.get(entry,'receiver'),mode=vm.platform.get(entry,'mode');
  if(!pointer) {
    // Existing source-compiler/platform delegates predate explicit pointer records.
    const token=vm.platform.get(entry,'method'),method=vm.inspector.getMethod(token);
    vm.call(token,method.signature.isStatic?args:[receiver,...args],{delegateContinuation:continuation});return SUSPENDED;
  }
  const values=mode==='closed-instance'||mode==='closed-static'?[receiver,...args]:[...args];
  return vm.invokeFunctionPointer(pointer,values,{delegateContinuation:continuation});
}
export function invokeDelegate(vm,ref,args) {
  const type=record(vm,ref).type,signature=managedDelegateSignature(vm.inspector,type);
  if(!signature||args.length!==signature.parameters.length)throw new ManagedFault('ArgumentException','Delegate argument count mismatch');
  const continuation={delegates:delegateEntries(vm,ref),args:[...args],next:0,signature};
  return resumeDelegate(vm,continuation);
}
function resumeDelegate(vm,continuation) {
  let result=null;
  return vm.heap.withRoots([...continuation.delegates,...continuation.args],()=>{
    while(continuation.next<continuation.delegates.length) {
      const entry=continuation.delegates[continuation.next++];result=invokeEntry(vm,entry,continuation.args,continuation);
      if(result===SUSPENDED)return result;
    }
    return result;
  });
}
/** Return handling resumes multicast entries; only the final return reaches the caller. */
export function continueDelegate(vm,frame,result) {
  const continuation=frame.delegateContinuation;
  if(!continuation||continuation.next>=continuation.delegates.length)return {continued:false,result};
  const next=resumeDelegate(vm,continuation);
  return next===SUSPENDED?{continued:true,result:null}:{continued:false,result:next};
}
export function invokeDelegateOperation(vm,descriptor,args) {
  switch(descriptor.name) {
    case 'Invoke':if(args[0]!==null&&!vm.matches(args[0],descriptor.ownerInstance??descriptor.owner))throw new ManagedFault('InvalidProgramException','Delegate invocation receiver type mismatch');return invokeDelegate(vm,args[0],args.slice(1));
    case 'Combine': {
      if(args.length===2)return combineDelegates(vm,...args);
      if(args[0]===null)return null;
      return vm.heap.withRoots([args[0]],()=>vm.heap.get(args[0]).data.reduce((result,value)=>{const combined=combineDelegates(vm,result,value);if(combined)vm.heap.pins.push(combined);return combined;},null));
    }
    case 'Remove':case 'RemoveAll':return removeDelegate(vm,args[0],args[1],descriptor.name==='RemoveAll');
    case 'op_Equality':return delegatesEqual(vm,args[0],args[1])?1:0;
    case 'op_Inequality':return delegatesEqual(vm,args[0],args[1])?0:1;
    case 'GetInvocationList':return vm.heap.allocate('array','System.Delegate[]',delegateEntries(vm,args[0]));
  }
  throw new ManagedFault('MissingMethodException','Unknown managed delegate operation');
}
