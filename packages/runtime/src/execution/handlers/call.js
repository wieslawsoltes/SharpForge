import {continueExceptionEvent} from '../exception-events.js';
import {markUnhandled} from '../unhandled.js';
import {jumpMethod} from '../tailcall.js';
import {ManagedFault} from '../../heap.js';
import {completeInitialization} from '../static-init.js';
import {methodPointer} from '../calls.js';
import {continueDelegate} from '../delegate-calls.js';
import {unboxValue} from '../value-types.js';
import {validatePointer} from '../managed-pointers.js';
import {popFrame} from '../frame-stack.js';

const handlers=new Map([['jmp',jumpMethod]]);
for(const name of ['call','callvirt','newobj'])handlers.set(name,(vm,frame,instruction)=>vm.invoke(instruction));
handlers.set('ldftn',(vm,frame,instruction)=>vm.push(methodPointer(vm,instruction.operand)));
handlers.set('ldvirtftn',(vm,frame,instruction)=>vm.push(methodPointer(vm,instruction.operand,vm.pop())));
handlers.set('tail.',(vm,frame)=>{frame.tailCall=true;});
handlers.set('constrained.',(vm,frame,instruction)=>{frame.constrainedType=instruction.operand;});
handlers.set('ret',(vm,frame)=>{
  let result=frame.method.signature.returnType==='void'?null:vm.storage(vm.pop(),frame.method.signature.returnType);
  if(result?.byref){validatePointer(vm,result);if(result.frameId===frame.id)throw new ManagedFault('InvalidProgramException','A return reference cannot outlive its local frame');}
  if(frame.initializes)completeInitialization(vm,frame);
  popFrame(vm);
  if(frame.valueConstructor)result=unboxValue(vm,frame.returnObject,frame.valueConstructorType);
  const continuation=continueDelegate(vm,frame,result);if(continuation.continued)return;
  const event=continueExceptionEvent(vm,frame);
  if(event){if(!event.continued){if(event.phase==='unhandled')markUnhandled(vm,event.fault);else vm.raise(event.fault);}return;}
  const value=frame.valueConstructor?continuation.result:frame.returnObject??continuation.result;
  if(vm.top){if(frame.returnObject||frame.method.signature.returnType!=='void')vm.push(value);}
  else {vm.returnValue=value;vm.exitCode=frame.method.signature.returnType==='int'?Number(value)|0:0;vm.state='terminated';}
});
export {handlers};
