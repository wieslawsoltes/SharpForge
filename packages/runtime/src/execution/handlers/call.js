import {ManagedFault} from '../../heap.js';
import {completeInitialization} from '../static-init.js';

const handlers=new Map();
for(const name of ['call','callvirt','newobj'])handlers.set(name,(vm,frame,instruction)=>vm.invoke(instruction));
handlers.set('ldftn',(vm,frame,instruction)=>{
  const descriptor=vm.inspector.resolveToken(instruction.operand),token=descriptor.resolvedToken??descriptor.token;
  if(!vm.report.methods.includes(token))throw new ManagedFault('InvalidProgramException','Unverified delegate method');
  vm.push(Object.freeze({methodPointer:true,token}));
});
handlers.set('ret',(vm,frame)=>{
  const result=frame.method.signature.returnType==='void'?null:vm.pop();
  if(frame.initializes)completeInitialization(vm,frame);
  vm.frames.pop();const value=frame.returnObject??result;
  if(vm.top){if(frame.returnObject||frame.method.signature.returnType!=='void')vm.push(value);}
  else {vm.returnValue=value;vm.exitCode=frame.method.signature.returnType==='int'?Number(value)|0:0;vm.state='terminated';}
});
export {handlers};
