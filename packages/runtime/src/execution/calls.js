import {createException} from './exception-object.js';
import {arrayCall} from './array-calls.js';
import {invokeNumericIntrinsic} from './numeric-intrinsics.js';
import {stringFromChars} from './strings.js';
import {methodOffsets} from './method-offsets.js';
import {systemType,intrinsicDefinition,resolveExecutionMethod,callSignatureKey,supportedIntrinsic,supportedDelegateCall} from '@sharpforge/cil';
import {ManagedFault,isReference} from '../heap.js';
import {SUSPENDED} from './suspension.js';
import {storageDefault} from './storage.js';
import {createExceptionState} from './eh.js';
import {ensureTypeInitialized} from './static-init.js';
import {instantiatedMethod,bindCallArguments,resolveCallType} from './generic-calls.js';
import {constructDelegate,invokeDelegateOperation} from './delegate-calls.js';
import {address,validatePointer,pointerType} from './managed-pointers.js';
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
  const values = bindCallArguments(vm, method, args);
  const frame = {
    id: ++vm.frameId,
    method,
    args: values,
    locals: method.locals.map(type => method.initLocals ? storageDefault(vm, type) : undefined),
    stack: [],
    pc: 0,
    lastOffset: 0,
    offsets: methodOffsets(method),
    ...createExceptionState(),
    needsInitialization: method.name !== '.cctor',
    ...extra
  };
  if (replacement) replaceFrame(vm, frame);
  else pushFrame(vm, frame);
}
export function ensureInitialized(vm,typeToken,trigger='field',genericIdentity=null) {
  return ensureTypeInitialized(vm,typeToken,trigger,genericIdentity);
}
/** Direct scheduler/delegate entries also pass the type-initialization gate. */
export function prepareCall(vm) {
  const frame=vm.top;
  if(!frame?.needsInitialization)return true;
  const method=frame.method,trigger=method.name==='.ctor'?'constructor':method.signature.isStatic?'static-method':'instance-method';
  if(vm.ensureInitialized(method.ownerToken,trigger,frame.genericIdentity??null))return false;
  frame.needsInitialization=false;return true;
}
const context=frame=>({ownerToken:frame?.method.ownerToken,genericIdentity:frame?.genericIdentity??null,typeArguments:frame?.method.typeArguments,methodArguments:frame?.methodArguments??[]});
export function methodPointer(vm,token,receiver=undefined) {
  let descriptor=resolveExecutionMethod(vm.inspector,token,context(vm.top));
  if(receiver!==undefined) {
    if(receiver===null)throw new ManagedFault('NullReferenceException','Null virtual function receiver');
    if(descriptor.signature.isStatic)throw new ManagedFault('InvalidProgramException','ldvirtftn requires an instance method');
    const type=vm.heap.get(receiver).methodTable.name;
    const external=!descriptor.resolvedToken?vm.typeSystem.dispatch.externalTarget(type,descriptor):null;
    if(external)descriptor={...descriptor,...vm.inspector.methods.get(external),resolvedToken:external,ownerInstance:null};
    const target=descriptor.resolvedToken;
    if(target&&(vm.inspector.methods.get(target).flags&0x40)) {
      const actual=vm.typeSystem.dispatch.resolve(vm.heap.get(receiver).methodTable.name,target,descriptor.ownerInstance);
      descriptor={...descriptor,...vm.inspector.methods.get(actual),resolvedToken:actual};
      descriptor.ownerInstance=receiverIdentity(vm,descriptor,receiver);
    }
  }
  if(descriptor.resolvedToken?!vm.report.methods.includes(descriptor.resolvedToken):!supportedIntrinsic(descriptor)&&!supportedDelegateCall(vm.inspector,descriptor))throw new ManagedFault('InvalidProgramException','Unverified managed function target');
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
  if(!vm.report.methods.includes(token))throw new ManagedFault('InvalidProgramException','Unverified managed call target');
  const genericIdentity=extra.genericIdentity??receiverIdentity(vm,descriptor,args[0]);
  const owner=vm.typeSystem.table(genericIdentity??descriptor.ownerToken);
  if(!descriptor.signature.isStatic&&owner.flags.valueType&&isReference(args[0])) {
    if(vm.heap.get(args[0]).kind!=='box')throw new ManagedFault('InvalidProgramException','Value receiver requires a managed reference');
    args[0]=address(vm,'box',0,args[0],{type:owner.name});
  }

  vm.call(token,args,{...extra,genericIdentity,methodArguments:descriptor.methodArguments??[]});return SUSPENDED;
}

export function invokeFunctionPointer(vm,pointer,args,extra={}) {
  if(!pointer?.methodPointer||pointer.vmOwner!==vm.snapshotOwner)throw new ManagedFault('InvalidProgramException','calli requires a managed function pointer from this VM');
  const descriptor=pointer.descriptor;
  if(descriptor.resolvedToken)return startManagedCall(vm,descriptor,args,extra);
  if(supportedDelegateCall(vm.inspector,descriptor))return invokeDelegateOperation(vm,descriptor,args);
  if(!supportedIntrinsic(descriptor))throw new ManagedFault('InvalidProgramException','Unverified managed function pointer');
  return vm.intrinsic(descriptor,args);
}

function constrainedTarget(vm,descriptor,args,type) {
  const receiver=args[0];validatePointer(vm,receiver);
  const table=vm.typeSystem.table(resolveCallType(vm,type));
  if(pointerType(vm,receiver)!==table)throw new ManagedFault('InvalidProgramException','constrained. receiver type mismatch');
  if(!table.flags.valueType){args[0]=vm.dereference(receiver);return descriptor;}
  const external=descriptor.resolvedToken?null:vm.typeSystem.dispatch.externalTarget(table.name,descriptor),target=descriptor.resolvedToken??external;
  if(target) {
    const resolved=external??vm.typeSystem.dispatch.resolve(table.name,target,descriptor.ownerInstance);
    const method=vm.inspector.methods.get(resolved);
    if(method&&vm.typeSystem.table(method.ownerToken).flags.valueType)return {...descriptor,...method,resolvedToken:resolved,ownerInstance:table.typeArguments.length?table.name:null};
  } else {
    const definition=vm.typeSystem.types.get(table.definitionToken),candidate=definition?.methods.find(method=>method.name===descriptor.name&&callSignatureKey({...vm.inspector.signature(method.token),isStatic:descriptor.signature.isStatic})===callSignatureKey(descriptor.signature));
    if(candidate)return {...descriptor,...candidate,resolvedToken:candidate.token,ownerInstance:table.typeArguments.length?table.name:null};
  }
  args[0]=boxValue(vm,vm.dereference(receiver),table.name);return descriptor;
}

export function invoke(vm,instruction) {
  const caller=vm.top;

  let descriptor=resolveExecutionMethod(vm.inspector,instruction.operand,context(caller)),target=descriptor.resolvedToken;
  const count=descriptor.signature.parameters.length+(instruction.name!=='newobj'&&!descriptor.signature.isStatic?1:0);
  const instance=descriptor.ownerInstance??(caller.method.ownerToken===descriptor.ownerToken?caller.genericIdentity:null)??null;
  const genericIdentity=instance===null?null:vm.typeSystem.table(instance).name;
  const trigger=instruction.name==='newobj'||descriptor.name==='.ctor'?'constructor':descriptor.signature.isStatic?'static-method':'instance-method';
  if(target&&vm.ensureInitialized(descriptor.ownerToken,trigger,genericIdentity)){caller.pc--;return;}
  if(caller.stack.length<count)throw new ManagedFault('InvalidProgramException','Call argument stack underflow');
  const args=caller.stack.splice(caller.stack.length-count,count);
  const tail=!!caller.tailCall,constrained=caller.constrainedType;caller.tailCall=false;caller.constrainedType=null;
  vm.heap.withRoots(args,()=>{
    const delegate=supportedDelegateCall(vm.inspector,descriptor);
    if(delegate) {
      const value=instruction.name==='newobj'?constructDelegate(vm,descriptor.ownerInstance??descriptor.owner,args[0],args[1]):invokeDelegateOperation(vm,descriptor,args);
      if(value!==SUSPENDED&&(instruction.name==='newobj'||descriptor.signature.returnType!=='void'))caller.stack.push(value);return;
    }
    const array=arrayCall(vm,descriptor,args,instruction.name);if(array.handled){if(array.returns)caller.stack.push(array.value);return;}
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
    if(instruction.name==='callvirt'&&args[0]===null)throw new ManagedFault('NullReferenceException','Null virtual receiver');
    const receiverType=args[0]?.byref?pointerType(vm,args[0]).name:isReference(args[0])?vm.heap.get(args[0]).methodTable.name:null;
    const dispatch=target&&instruction.name==='callvirt'&&(vm.inspector.methods.get(target)?.flags&0x40)?vm.typeSystem.dispatch.resolve(receiverType,target,descriptor.ownerInstance):target??(instruction.name==='callvirt'?vm.typeSystem.dispatch.externalTarget(receiverType,descriptor):null);
    if(dispatch) {
      if(!vm.report.methods.includes(dispatch))throw new ManagedFault('NotSupportedException','Unverified virtual override; select its method directly');
      startManagedCall(vm,{...descriptor,...vm.inspector.methods.get(dispatch),resolvedToken:dispatch},args,{tail});
    } else {
      const value=vm.intrinsic(descriptor,args);
      if(descriptor.signature.returnType!=='void'&&value!==SUSPENDED)caller.stack.push(value);
    }
  });
}
