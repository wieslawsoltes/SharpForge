import {number} from '../numeric-ops.js';
import {continueUnwind,throwFault} from '../eh.js';

const handlers=new Map([
  ['switch',(vm,frame,instruction)=>{const index=number(vm.pop());if(Number.isInteger(index)&&index>=0&&index<instruction.operand.length)frame.pc=frame.offsets.get(instruction.operand[index]);}],
  ['endfinally',(vm,frame)=>continueUnwind(vm,frame)],
  ['throw',(vm,frame,instruction)=>throwFault(vm,null,instruction)],
  ['rethrow',(vm,frame,instruction)=>throwFault(vm,null,instruction)]
]);
for(const suffix of ['', '.s']) {
  handlers.set('leave'+suffix,(vm,frame,instruction)=>continueUnwind(vm,frame,instruction));
  handlers.set('br'+suffix,(vm,frame,instruction)=>{frame.pc=frame.offsets.get(instruction.operand);});
  for(const truthy of [true,false])handlers.set((truthy?'brtrue':'brfalse')+suffix,(vm,frame,instruction)=>{
    const value=number(vm.pop()),truth=value!==null&&value!==0&&value!==0n;
    if(truth===truthy)frame.pc=frame.offsets.get(instruction.operand);
  });
  for(const op of ['eq','ge','gt','le','lt','ne'])for(const unsigned of [false,true]) {
    if(op==='eq'&&unsigned||op==='ne'&&!unsigned)continue;
    handlers.set('b'+op+(unsigned?'.un':'')+suffix,(vm,frame,instruction)=>{
      const right=vm.pop(),left=vm.pop();
      if(vm.compare(left,right,op,unsigned,true))frame.pc=frame.offsets.get(instruction.operand);
    });
  }
}
export {handlers};
