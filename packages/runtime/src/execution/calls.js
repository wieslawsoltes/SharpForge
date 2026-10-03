import {methodOffsets} from './method-offsets.js';
import {systemType,intrinsicDefinition} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {SUSPENDED} from '../platform.js';
import {defaults} from './numeric-ops.js';
import {createExceptionState} from './eh.js';

export function call(vm,token,args,extra={}) {
  if(vm.frames.length>=vm.options.maxFrames)throw new ManagedFault('StackOverflowException','Managed call depth exceeded');
  const method=vm.inspector.getMethod(token);
  if(!method.signature.isStatic&&args[0]===null)throw new ManagedFault('NullReferenceException','Instance method receiver is null');
  vm.frames.push({id:++vm.frameId,method,args,locals:method.locals.map(type=>method.initLocals?defaults(type):undefined),stack:[],pc:0,lastOffset:0,offsets:methodOffsets(method),...createExceptionState(),...extra});
}
export function ensureInitialized(vm,typeToken) {
  if(vm.initialized.has(typeToken))return false;
  const initializer=vm.typeSystem.initializers.get(typeToken);
  vm.initialized.set(typeToken,initializer?'initializing':'initialized');
  if(initializer){vm.call(initializer.token,[],{initializes:typeToken});return true;}
  return false;
}
export function invoke(vm,instruction) {
  const caller=vm.top,descriptor=vm.inspector.resolveToken(instruction.operand),target=descriptor.resolvedToken??(descriptor.token>>>24===6?descriptor.token:null);
  const count=descriptor.signature.parameters.length+(instruction.name!=='newobj'&&!descriptor.signature.isStatic?1:0);
  if(target&&vm.ensureInitialized(descriptor.ownerToken)){caller.pc--;return;}
  const args=caller.stack.splice(caller.stack.length-count,count);
  vm.heap.withRoots(args,()=>{
    const contract=intrinsicDefinition(descriptor)?.contract;
    if(instruction.name==='newobj'&&contract){caller.stack.push(vm.platform.invoke(contract,args));return;}
    if(instruction.name==='newobj') {
      let ref;
      if(target){const layout=vm.layout(descriptor.ownerToken);ref=vm.heap.object(layout.name,layout.fields.map(field=>defaults(field.type)));}
      else if(systemType(descriptor.owner)==='System.Exception')ref=vm.heap.allocate('exception','System.Exception',[args[0]??null]);
      else throw new ManagedFault('NotSupportedException','External object construction is unavailable');
      args.unshift(ref);vm.heap.pins.push(ref);
      if(target)vm.call(target,args,{returnObject:ref});else {vm.intrinsic(descriptor,args);caller.stack.push(ref);}
      return;
    }
    if(instruction.name==='callvirt'&&args[0]===null)throw new ManagedFault('NullReferenceException','Null virtual receiver');
    const dispatch=target&&instruction.name==='callvirt'&&(descriptor.flags&0x40)?vm.typeSystem.virtualTarget(args[0],descriptor,target):target;
    if(dispatch) {
      if(!vm.report.methods.includes(dispatch))throw new ManagedFault('NotSupportedException','Unverified virtual override; select its method directly');
      vm.call(dispatch,args);
    } else {
      const value=vm.intrinsic(descriptor,args);
      if(descriptor.signature.returnType!=='void'&&value!==SUSPENDED)caller.stack.push(value);
    }
  });
}
