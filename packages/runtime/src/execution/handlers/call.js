import {continueControlReturn} from '../return-control.js';
import {popPooledFrame} from '../frame-retirement.js';
import {isNativeStorageType} from '../native-int.js';
import {completeInitialization} from '../static-init.js';
import {leaveCilMethod} from '../cil-method-events.js';
import {delegateMethodPointer} from '../delegate-targets.js';
import {valueCallResult} from '../value-calls.js';

const handlers=new Map();
for(const name of ['call','callvirt','newobj'])handlers.set(name,(vm,frame,instruction)=>vm.invoke(instruction));
handlers.set('ldftn',(vm,frame,instruction)=>{
  vm.push(delegateMethodPointer(vm,instruction.operand));
});
handlers.set('ret',(vm,frame)=>{
  const type=frame.method.signature.returnType;
  let result=type==='void'?null:vm.pop();
  if(isNativeStorageType(type)||type.startsWith('method '))result=vm.storage(result,type);
  let value=valueCallResult(vm,frame,result);
  if(frame.initializes)completeInitialization(vm,frame);
  leaveCilMethod(vm, frame);
  popPooledFrame(vm);
  const control=continueControlReturn(vm,frame,value);
  if(control.handled)return;
  value=control.value;
  if(vm.top){if(frame.returnObject||frame.method.signature.returnType!=='void')vm.push(value);}
  else {vm.returnValue=value;vm.exitCode=frame.method.signature.returnType==='int'?Number(value)|0:0;vm.state='terminated';}
});
export {handlers};
