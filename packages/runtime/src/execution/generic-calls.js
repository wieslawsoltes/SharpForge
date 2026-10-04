import {exceptionEventRoots} from './exception-events.js';
import {genericTypeParts,substituteCallType,callStorageType} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {cachedTypeName} from './token-cache.js';
import {validatePointer,asReadonly,pointerType} from './managed-pointers.js';
export {instantiatedMethod} from './generics.js';

export function resolveCallType(vm,typeOrToken,frame=vm.top) {
  const name=typeof typeOrToken==='number'?cachedTypeName(vm,typeOrToken):typeOrToken;
  if(typeof name!=='string')return name;
  return substituteCallType(name,frame?.method.typeArguments??genericTypeParts(frame?.genericIdentity??'').arguments,frame?.methodArguments??[]);
}

export function bindCallArguments(vm,method,args,values=[]) {
  const signature=method.signature,count=signature.parameters.length+(signature.isStatic?0:1);
  if(args.length!==count)throw new ManagedFault('InvalidProgramException','Managed call argument count mismatch');
  for(let index=0;index<args.length;index++) {
    let argument=args[index];
    const parameter=index-(signature.isStatic?0:1),type=parameter<0?null:signature.parameters[parameter];
    if(type&&callStorageType(type).endsWith('&')) {
      if(!argument?.byref||argument.vmOwner!==vm.snapshotOwner)throw new ManagedFault('InvalidProgramException','A managed reference argument is required');
      const metadata=method.parameters.find(item=>item.sequence===parameter+1),readOnly=!!(metadata?.flags&1)&&!(metadata?.flags&2)||/IsReadOnly|InAttribute/.test(type);
      validatePointer(vm,argument,{write:!readOnly,allowUninitialized:!!(metadata?.flags&2)});
      const referent=pointerType(vm,argument),expected=vm.typeSystem.table(callStorageType(type).slice(0,-1));
      if(referent!==expected)throw new ManagedFault('InvalidProgramException','Managed reference argument type mismatch');
      values[index]=readOnly?asReadonly(vm,argument):argument;
      continue;
    }
    values[index]=type?vm.storage(argument,callStorageType(type)):argument;
  }
  return values;
}

export function* callRoots(frame) {
  yield* exceptionEventRoots(frame);
  const continuation=frame.delegateContinuation;
  if(continuation){yield* continuation.delegates;for(const value of continuation.args)yield value?.byref?value.owner:value;}
}
