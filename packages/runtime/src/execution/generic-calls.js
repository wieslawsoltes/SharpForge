import {genericTypeParts,substituteCallType,instantiateSignature,methodGenericParameters,decodeCoded,callStorageType} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {validatePointer,asReadonly,pointerType} from './managed-pointers.js';
const methods=new WeakMap();

export function resolveCallType(vm,typeOrToken,frame=vm.top) {
  const name=typeof typeOrToken==='number'?vm.inspector.metadata.typeName(typeOrToken):typeOrToken;
  if(typeof name!=='string')return name;
  return substituteCallType(name,frame?.method.typeArguments??genericTypeParts(frame?.genericIdentity??'').arguments,frame?.methodArguments??[]);
}

export function instantiatedMethod(vm,token,genericIdentity=null,methodArguments=[]) {
  const original=vm.inspector.getMethod(token),typeArguments=genericTypeParts(genericIdentity??'').arguments;
  const arity=original.signature.genericArity??0;
  if(arity!==methodArguments.length)throw new ManagedFault('InvalidProgramException','Generic method requires a complete instantiation');
  let cache=methods.get(vm.inspector);if(!cache)methods.set(vm.inspector,cache=new Map());
  const key=JSON.stringify([token,typeArguments,methodArguments]);if(cache.has(key))return cache.get(key);
  validateGenericArguments(vm,original.ownerToken,typeArguments,typeArguments,methodArguments);
  validateGenericArguments(vm,token,methodArguments,typeArguments,methodArguments,arity);
  const signature=instantiateSignature(original.signature,typeArguments,methodArguments),locals=original.locals.map(type=>substituteCallType(type,typeArguments,methodArguments));
  if(signature.parameters.concat(signature.returnType,locals).some(type=>/!!?\d+/.test(type)))throw new ManagedFault('InvalidProgramException','Open generic code is not executable');
  const method={...original,signature,locals,typeArguments,genericIdentity,methodArguments};cache.set(key,method);return method;
}

function validateGenericArguments(vm,owner,arguments_,typeArguments,methodArguments,arity=null) {
  const parameters=methodGenericParameters(vm.inspector,owner);
  if(arguments_.length!==parameters.length||arity!==null&&parameters.length!==arity||parameters.some((parameter,index)=>parameter.index!==index))throw new ManagedFault('InvalidProgramException','Generic parameter metadata does not match instantiation arity');
  for(const parameter of parameters) {
    const type=vm.typeSystem.table(arguments_[parameter.index]);
    if(type.containsGenericParameters||type.flags.byRef||type.flags.pointer||type.name==='System.Void')throw new ManagedFault('InvalidProgramException','Generic arguments must be closed managed types');
    if(parameter.flags&4&&type.flags.valueType||parameter.flags&8&&(!type.flags.valueType||type.flags.nullable))throw new ManagedFault('ArgumentException','Generic constraint violation');
    if(parameter.flags&16&&!type.flags.valueType) {
      const definition=vm.typeSystem.types.get(type.definitionToken);
      if(type.flags.abstract||type.name!=='System.Object'&&!definition?.methods.some(method=>method.name==='.ctor'&&(method.flags&7)===6&&vm.inspector.signature(method.token).parameters.length===0))throw new ManagedFault('ArgumentException','Generic new() constraint violation');
    }
    for(const row of vm.inspector.metadata.rows[44]??[])if(row[0]===parameter.row) {
      const target=substituteCallType(vm.inspector.metadata.typeName(decodeCoded('TypeDefOrRef',row[1])),typeArguments,methodArguments);
      if(!vm.typeSystem.castCache.isAssignableFrom(vm.typeSystem.table(target),type))throw new ManagedFault('ArgumentException','Generic type constraint violation');
    }
  }
}

export function bindCallArguments(vm,method,args) {
  const signature=method.signature,count=signature.parameters.length+(signature.isStatic?0:1);
  if(args.length!==count)throw new ManagedFault('InvalidProgramException','Managed call argument count mismatch');
  return args.map((argument,index)=>{
    const parameter=index-(signature.isStatic?0:1),type=parameter<0?null:signature.parameters[parameter];
    if(type&&callStorageType(type).endsWith('&')) {
      if(!argument?.byref||argument.vmOwner!==vm.snapshotOwner)throw new ManagedFault('InvalidProgramException','A managed reference argument is required');
      const metadata=method.parameters.find(item=>item.sequence===parameter+1),readOnly=!!(metadata?.flags&1)&&!(metadata?.flags&2)||/IsReadOnly|InAttribute/.test(type);
      validatePointer(vm,argument,{write:!readOnly,allowUninitialized:!!(metadata?.flags&2)});
      const referent=pointerType(vm,argument),expected=vm.typeSystem.table(callStorageType(type).slice(0,-1));
      if(referent!==expected)throw new ManagedFault('InvalidProgramException','Managed reference argument type mismatch');
      return readOnly?asReadonly(vm,argument):argument;
    }
    return type?vm.storage(argument,callStorageType(type)):argument;
  });
}

export function* callRoots(frame) {
  const continuation=frame.delegateContinuation;
  if(continuation){yield* continuation.delegates;for(const value of continuation.args)yield value?.byref?value.owner:value;}
}
