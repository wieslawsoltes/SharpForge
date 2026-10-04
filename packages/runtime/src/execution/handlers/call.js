import {completeInitialization} from '../static-init.js';
import {leaveCilMethod} from '../cil-method-events.js';
import {delegateMethodPointer} from '../delegate-targets.js';

const handlers=new Map();
for(const name of ['call','callvirt','newobj'])handlers.set(name,(vm,frame,instruction)=>vm.invoke(instruction));
handlers.set('ldftn',(vm,frame,instruction)=>{
  vm.push(delegateMethodPointer(vm,instruction.operand));
});
handlers.set('ret',(vm,frame)=>{
  const result=frame.method.signature.returnType==='void'?null:vm.pop();
  if(frame.initializes)completeInitialization(vm,frame);
  leaveCilMethod(vm, frame);
  vm.frames.pop();const value=frame.returnObject??result;
  if(vm.top){if(frame.returnObject||frame.method.signature.returnType!=='void')vm.push(value);}
  else {vm.heap.writeRoot(vm,'returnValue',value);vm.exitCode=frame.method.signature.returnType==='int'?Number(value)|0:0;vm.state='terminated';}
});
export {handlers};
