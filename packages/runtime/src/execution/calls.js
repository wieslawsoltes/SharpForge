import {constrainedTarget} from './handlers/constrained.js';
import {resolveVirtualCall} from './inline-cache.js';
import {splitVarargs, attachVarargs, varargsCall} from './varargs.js';
import {memoryCall} from './memory-calls.js';
import {createException} from './exception-object.js';
import {arrayCall} from './array-calls.js';
import {invokeNumericIntrinsic} from './numeric-intrinsics.js';
import {stringFromChars} from './strings.js';
import {methodOffsets} from './method-offsets.js';
import {systemType,intrinsicDefinition,supportedIntrinsic,supportedDelegateCall} from '@sharpforge/cil';
import {cachedMethod,verifiedMethod} from './token-cache.js';
import {ManagedFault,isReference} from '../heap.js';
import {SUSPENDED} from './suspension.js';
import {storageDefault} from './storage.js';
import {framePool} from './frame-pool.js';
import {ensureTypeInitialized} from './static-init.js';
import {instantiatedMethod,bindCallArguments,resolveCallType} from './generic-calls.js';
import {constructDelegate,invokeDelegateOperation} from './delegate-calls.js';
import {address,pointerType} from './managed-pointers.js';
import {boxValue} from './value-types.js';
import {pushFrame, replaceFrame} from './frame-stack.js';
import {eligibleTailCall, inheritedTailState} from './tailcall.js';

export function call(vm, token, args, extra = {}) {
  const replacement = extra.tail && eligibleTailCall(vm.top, args);
  if (replacement) extra = {...inheritedTailState(vm.top), ...extra};
  if (!replacement && vm.options.maxFrames !== undefined && vm.frames.length >= vm.options.maxFrames) {
    const fault = new ManagedFault('StackOverflowException', 'Explicit managed frame limit exceeded');
    fault.fatal = true;
    fault.runtimeOrigin = true;
    throw fault;
  }
  const method = instantiatedMethod(vm, token, extra.genericIdentity ?? null, extra.methodArguments ?? []);
  const pool = framePool(vm), frame = pool.acquire(method, extra.optionalArguments?.length ?? 0);
  try {
    bindCallArguments(vm, method, args, frame.args);
    frame.varargs = attachVarargs(method, frame.args, extra.optionalArguments) ?? undefined;
    frame.id = ++vm.frameId;
    frame.method = method;
    for (let index = 0; index < method.locals.length; index++) {
      frame.locals[index] = method.initLocals ? storageDefault(vm, method.locals[index]) : undefined;
    }
    frame.pc = 0;
    frame.lastOffset = 0;
    frame.offsets = methodOffsets(method);
    frame.exception = frame.pending = null;
    frame.needsInitialization = method.name !== '.cctor';
    for (const key in extra) if (key !== 'optionalArguments') frame[key] = extra[key];
    if (replacement) replaceFrame(vm, frame);
    else pushFrame(vm, frame);
  } catch (error) {
    pool.retire(frame);
    throw error;
  }
}
export function ensureInitialized(vm,typeToken,trigger='field',genericIdentity=null) {
  return ensureTypeInitialized(vm,typeToken,trigger,genericIdentity);
}
/** Direct scheduler/delegate entries also pass the type-initialization gate. */
export function prepareCall(vm,frame=vm.top) {
  if(!frame?.needsInitialization)return true;
  const method=frame.method,trigger=method.name==='.ctor'?'constructor':method.signature.isStatic?'static-method':'instance-method';
  if(vm.ensureInitialized(method.ownerToken,trigger,frame.genericIdentity??null))return false;
  frame.needsInitialization=false;return true;
}
export function methodPointer(vm,token,receiver=undefined) {
  let descriptor=cachedMethod(vm,token);
  if(receiver!==undefined) {
    if(receiver===null)throw new ManagedFault('NullReferenceException','Null virtual function receiver');
    if(descriptor.signature.isStatic)throw new ManagedFault('InvalidProgramException','ldvirtftn requires an instance method');
    const type=vm.heap.get(receiver).methodTable.name;
    if(!descriptor.resolvedToken)descriptor=objectOverride(vm,descriptor,receiver)??descriptor;
    const external=!descriptor.resolvedToken?vm.typeSystem.dispatch.externalTarget(type,descriptor):null;
    if(external)descriptor={...descriptor,...vm.inspector.methods.get(external),resolvedToken:external,ownerInstance:null};
    const target=descriptor.resolvedToken;
    if(target&&(vm.inspector.methods.get(target).flags&0x40)) {
      const actual=vm.typeSystem.dispatch.resolve(vm.heap.get(receiver).methodTable.name,target,descriptor.ownerInstance);
      descriptor={...descriptor,...vm.inspector.methods.get(actual),resolvedToken:actual};
      descriptor.ownerInstance=receiverIdentity(vm,descriptor,receiver);
    }
  }
  if(descriptor.resolvedToken?!verifiedMethod(vm,descriptor.resolvedToken):!supportedIntrinsic(descriptor)&&!supportedDelegateCall(vm.inspector,descriptor))throw new ManagedFault('InvalidProgramException','Unverified managed function target');
  return Object.freeze({methodPointer:true,vmOwner:vm.snapshotOwner,token,descriptor,signature:descriptor.signature,identity:Object.freeze([descriptor.resolvedToken??token,descriptor.ownerInstance,descriptor.methodArguments])});
}

function receiverIdentity(vm,descriptor,receiver) {
  if(descriptor.ownerInstance){const declared=vm.typeSystem.table(descriptor.ownerInstance);if(declared.definitionToken===descriptor.ownerToken)return declared.name;}
  let table=receiver?.byref?pointerType(vm,receiver):isReference(receiver)?vm.heap.get(receiver).methodTable:null;
  for(;table;table=table.base)if(table.definitionToken===descriptor.ownerToken)return table.typeArguments.length?table.name:null;
  return descriptor.ownerToken===vm.top?.method.ownerToken?vm.top?.genericIdentity??null:null;
}

function startManagedCall(vm,descriptor,args,extra={}) {
  const token=descriptor.resolvedToken;
  if(!verifiedMethod(vm,token))throw new ManagedFault('InvalidProgramException','Unverified managed call target');
  const genericIdentity=extra.genericIdentity??receiverIdentity(vm,descriptor,args[0]);
  const owner=vm.typeSystem.table(genericIdentity??descriptor.ownerToken);
  if(!descriptor.signature.isStatic&&owner.flags.valueType&&isReference(args[0])) {
    if(vm.heap.get(args[0]).kind!=='box')throw new ManagedFault('InvalidProgramException','Value receiver requires a managed reference');
    args[0]=address(vm,'box',0,args[0],{type:owner.name});
  }

  const variable=splitVarargs(vm,descriptor,args);
  vm.call(token,variable.args,{...extra,...variable.extra,genericIdentity,methodArguments:descriptor.methodArguments??[]});return SUSPENDED;
}

export function invokeFunctionPointer(vm,pointer,args,extra={}) {
  if(!pointer?.methodPointer||pointer.vmOwner!==vm.snapshotOwner)throw new ManagedFault('InvalidProgramException','calli requires a managed function pointer from this VM');
  const descriptor=pointer.descriptor;
  if(descriptor.resolvedToken)return startManagedCall(vm,descriptor,args,extra);
  if(supportedDelegateCall(vm.inspector,descriptor))return invokeDelegateOperation(vm,descriptor,args);
  if(!supportedIntrinsic(descriptor))throw new ManagedFault('InvalidProgramException','Unverified managed function pointer');
  return vm.intrinsic(descriptor,args);
}

export function invoke(vm,instruction) {
  const caller=vm.top;

  let descriptor=cachedMethod(vm,instruction.operand,caller),target=descriptor.resolvedToken;
  const count=descriptor.signature.parameters.length+(instruction.name!=='newobj'&&!descriptor.signature.isStatic?1:0);
  const instance=descriptor.ownerInstance??(caller.method.ownerToken===descriptor.ownerToken?caller.genericIdentity:null)??null;
  const genericIdentity=instance===null?null:vm.typeSystem.table(instance).name;
  const trigger=instruction.name==='newobj'||descriptor.name==='.ctor'?'constructor':descriptor.signature.isStatic?'static-method':'instance-method';
  if(target&&vm.ensureInitialized(descriptor.ownerToken,trigger,genericIdentity)){caller.pc--;return;}
  if(caller.stack.length<count)throw new ManagedFault('InvalidProgramException','Call argument stack underflow');
  const pool=framePool(vm),args=pool.arguments(caller.stack,count);
  const tail=!!caller.tailCall,constrained=caller.constrainedType;caller.tailCall=false;caller.constrainedType=null;
  try { vm.heap.withRoots(args,()=>{
    const delegate=supportedDelegateCall(vm.inspector,descriptor);
    if(delegate) {
      const value=instruction.name==='newobj'?constructDelegate(vm,descriptor.ownerInstance??descriptor.owner,args[0],args[1]):invokeDelegateOperation(vm,descriptor,args);
      if(value!==SUSPENDED&&(instruction.name==='newobj'||descriptor.signature.returnType!=='void'))caller.stack.push(value);return;
    }
    const array=arrayCall(vm,descriptor,args,instruction.name);if(array.handled){if(array.returns)caller.stack.push(array.value);return;}
    const memory=memoryCall(vm,descriptor,args,instruction.name);if(memory.handled){if(memory.returns)caller.stack.push(memory.value);return;}
    const variable=varargsCall(vm,descriptor,args,instruction.name);if(variable.handled){if(variable.returns)caller.stack.push(variable.value);return;}
    if(instruction.name==='newobj'&&descriptor.owner==='System.Decimal'){const decimal=invokeNumericIntrinsic(vm,descriptor,args);if(decimal.handled){caller.stack.push(decimal.value);return;}}
    const contract=intrinsicDefinition(descriptor)?.contract;
    if(instruction.name==='newobj'&&descriptor.owner==='System.String'&&descriptor.signature.parameters.join(',')==='char[]'){caller.stack.push(stringFromChars(vm,args[0]));return;}
    if(instruction.name==='newobj'&&contract){caller.stack.push(vm.platform.invoke(contract,args));return;}
    if(instruction.name==='newobj') {
      let ref;
      const type=target?vm.typeSystem.table(genericIdentity??descriptor.ownerToken):null;
      if(target&&type.flags.valueType)ref=boxValue(vm,storageDefault(vm,type.name),type.name);
      else if(target){const layout=vm.layout(genericIdentity??descriptor.ownerToken);ref=vm.heap.object(layout.methodTable,layout.fields.map(field=>storageDefault(vm,field.type)));}
      else if(systemType(descriptor.owner)==='System.Object'&&args.length===0)ref=vm.heap.object(vm.typeSystem.table('System.Object'),[]);
      else if(intrinsicDefinition(descriptor)?.implementation==='exceptionCtor')ref=createException(vm,systemType(descriptor.owner));
      else throw new ManagedFault('NotSupportedException','External object construction is unavailable');
      args.unshift(type?.flags.valueType?address(vm,'box',0,ref,{type:type.name}):ref);vm.heap.pins.push(ref);
      if(target)startManagedCall(vm,descriptor,args,{returnObject:ref,genericIdentity,valueConstructor:!!type.flags.valueType,valueConstructorType:type.name});else {vm.intrinsic(descriptor,args);caller.stack.push(ref);}
      return;
    }
    if(constrained!==undefined&&constrained!==null){descriptor=constrainedTarget(vm,descriptor,args,constrained);target=descriptor.resolvedToken;}
    const virtual=instruction.name==='callvirt'?resolveVirtualCall(vm,caller,instruction,descriptor,args[0]):null;
    const dispatch=virtual?virtual.target:target;
    if(virtual)descriptor=virtual.descriptor;
    if(dispatch) {
      if(!verifiedMethod(vm,dispatch))throw new ManagedFault('NotSupportedException','Unverified virtual override; select its method directly');
      startManagedCall(vm,virtual?descriptor:{...descriptor,...vm.inspector.methods.get(dispatch),resolvedToken:dispatch},args,{tail});
    } else {
      const value=vm.intrinsic(descriptor,args);
      if(descriptor.signature.returnType!=='void'&&value!==SUSPENDED)caller.stack.push(value);
    }
  }); } finally { pool.releaseArguments(args); }
}
