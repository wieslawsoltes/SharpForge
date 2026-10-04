import {instantiatedMethod} from './generics.js';
import {callDescriptor, selectedCallOwner} from './generic-calls.js';
import {invokeDecimal} from './decimal-intrinsics.js';
import {stringFromChars} from './strings.js';
import {cilCallFrame} from './call-frames.js';
import {framePool} from './frame-pool.js';
import {systemType,intrinsicDefinition,supportedDelegateCall} from '@sharpforge/cil';
import {invokeBoundDelegate} from './delegate-targets.js';
import {ManagedFault} from '../heap.js';
import {SUSPENDED} from '../platform.js';
import {storageDefault} from './storage.js';
import {ensureTypeInitialized} from './static-init.js';
import {enterCilMethod} from './cil-method-events.js';
import {verifiedMethod} from './token-cache.js';
import {resolveVirtualTarget} from './inline-cache.js';

export function call(vm,token,args,extra={}) {
  if(vm.frames.length>=vm.options.maxFrames)throw new ManagedFault('StackOverflowException','Managed call depth exceeded');
  const method=instantiatedMethod(vm,token,extra.genericIdentity??null,extra.methodArguments??[]);
  if(!method.signature.isStatic&&args[0]===null)throw new ManagedFault('NullReferenceException','Instance method receiver is null');
  vm.frames.push(cilCallFrame(vm,method,args,extra));
  enterCilMethod(vm, vm.top);
}
export function ensureInitialized(vm,typeToken,trigger='field',genericIdentity=null) {
  return ensureTypeInitialized(vm,typeToken,trigger,genericIdentity);
}
/** Direct scheduler/delegate entries also pass the type-initialization gate. */
export function prepareCall(vm,frame=vm.top) {
  if(!frame?.needsInitialization)return true;
  const method=frame.method;
  let trigger='instance-method';
  if(method.name==='.ctor')trigger='constructor';
  else if(method.signature.isStatic)trigger='static-method';
  else if(vm.typeSystem.types.get(method.ownerToken)?.flags&0x20)trigger='interface-method';
  if(vm.ensureInitialized(method.ownerToken,trigger,frame.genericIdentity??null))return false;
  frame.needsInitialization=false;return true;
}
export function invoke(vm,instruction) {
  const caller=vm.top,descriptor=callDescriptor(vm,instruction.operand,caller),target=descriptor.resolvedToken??(descriptor.token>>>24===6?descriptor.token:null);
  const count=descriptor.signature.parameters.length+(instruction.name!=='newobj'&&!descriptor.signature.isStatic?1:0);
  const instance=descriptor.genericIdentity??descriptor.ownerInstance??(caller.method.ownerToken===descriptor.ownerToken?caller.genericIdentity:null)??null;
  const genericIdentity=instance===null?null:vm.typeSystem.table(instance).name;
  const trigger=instruction.name==='newobj'||descriptor.name==='.ctor'?'constructor':descriptor.signature.isStatic?'static-method':'instance-method';
  if(target&&vm.ensureInitialized(descriptor.ownerToken,trigger,genericIdentity)){caller.pc--;return;}
  const delegate = supportedDelegateCall(vm.inspector, descriptor);
  const intrinsic = intrinsicDefinition(descriptor), contract = intrinsic?.contract;
  // Managed delegates copy their inputs before returning; ordinary intrinsics
  // consume them synchronously. Platform contracts may retain an owned array.
  const pool = delegate || !contract ? framePool(vm) : null;
  const args = pool ? pool.arguments(caller.stack, count) : caller.stack.splice(caller.stack.length - count, count);
  try {
  vm.heap.withRoots(args,()=>{
    if(delegate) {
      const value=invokeBoundDelegate(vm,descriptor,args,instruction.name==='newobj');
      if((instruction.name==='newobj'||descriptor.signature.returnType!=='void')&&value!==SUSPENDED)caller.stack.push(value);
      return;
    }
    if(instruction.name==='newobj'&&intrinsic?.implementation==='decimal') {
      caller.stack.push(invokeDecimal(vm,descriptor,args).value);return;
    }
    if(instruction.name==='newobj'&&descriptor.owner==='System.String'&&descriptor.signature.parameters.join(',')==='char[]'){caller.stack.push(stringFromChars(vm,args[0]));return;}
    if(instruction.name==='newobj'&&contract){caller.stack.push(vm.platform.invoke(contract,args));return;}
    if(instruction.name==='newobj') {
      let ref;
      if(target){const layout=vm.layout(genericIdentity??descriptor.ownerToken);ref=vm.heap.object(layout.methodTable,layout.fields.map(field=>storageDefault(vm,field.type)));}
      else if(systemType(descriptor.owner)==='System.Object'&&args.length===0)ref=vm.heap.object(vm.typeSystem.table('System.Object'),[]);
      else if(systemType(descriptor.owner)==='System.Exception')ref=vm.heap.allocate('exception','System.Exception',[args[0]??null]);
      else throw new ManagedFault('NotSupportedException','External object construction is unavailable');
      args.unshift(ref);vm.heap.pins.push(ref);
      if(target)vm.call(target,args,{returnObject:ref,genericIdentity,methodArguments:descriptor.methodArguments});else {vm.intrinsic(descriptor,args);caller.stack.push(ref);}
      return;
    }
    if(instruction.name==='callvirt'&&args[0]===null)throw new ManagedFault('NullReferenceException','Null virtual receiver');
    const dispatch=target&&instruction.name==='callvirt'&&(vm.inspector.methods.get(target)?.flags&0x40)?resolveVirtualTarget(vm,caller,instruction,descriptor,args[0]):target;
    if(dispatch) {
      if(!verifiedMethod(vm,dispatch))throw new ManagedFault('NotSupportedException','Unverified virtual override; select its method directly');
      const owner=descriptor.signature.isStatic?genericIdentity:selectedCallOwner(vm,dispatch,args[0],genericIdentity);
      vm.call(dispatch,args,{genericIdentity:owner,methodArguments:descriptor.methodArguments});
    } else {
      const value=vm.intrinsic(descriptor,args);
      if(descriptor.signature.returnType!=='void'&&value!==SUSPENDED)caller.stack.push(value);
    }
  });
  } finally {
    if (pool) pool.releaseArguments(args);
  }
}
