import {loadToken} from '../tokens.js';

export const handlers=new Map([
  ['ldtoken',(vm,frame,instruction)=>vm.push(loadToken(vm,instruction.operand))]
]);
