import {frameworkType,findContracts} from '@sharpforge/framework';
import {Binary} from '@sharpforge/bytecode';
import {numeric,assignable} from '../type-utils.js';
/**
 * Binary operator classification for the string-typed profile, shared by the binder (which reports the errors)
 * and code generation (which only needs the result).
 *
 * Returns `{result, contract, negate, errors, implemented}`: `result` is the legacy result type, `contract` a framework
 * operator method (Vector<T> arithmetic) with `negate` set for `!=`, `errors` the CS0019 conditions that apply
 * ('compare' | 'operands' | 'integers'), and `implemented` false when the back end has no such operator.
 */
const vectorOperators=Object.freeze({'+':'Add','-':'Subtract','*':'Multiply','/':'Divide','&':'BitwiseAnd','^':'Xor','==':'EqualsAll','!=':'EqualsAll'});
export function classifyBinary(operator,left,right){
  if(frameworkType(left)?.family==='vector'&&left===right){const name=vectorOperators[operator],contract=name&&findContracts('System.Numerics.Vector',name,true).find(d=>d.parameters[0]===left);if(contract)return {result:contract.result,contract,negate:operator==='!=',errors:[],implemented:true};}
  const errors=[];let result;
  if(operator==='+'&&(left==='string'||right==='string'))result='string';
  else if(operator==='=='||operator==='!='){if(!assignable(left,right)&&!assignable(right,left))errors.push('compare');result='bool';}
  else if(['&','|','^'].includes(operator)&&left==='bool'&&right==='bool')result='bool';
  else{if(!numeric(left)||!numeric(right))errors.push('operands');if(['&','|','^','<<','>>'].includes(operator)&&(left!=='int'||right!=='int'))errors.push('integers');result=['<','<=','>','>='].includes(operator)?'bool':left==='double'||right==='double'?'double':'int';}
  return {result,contract:null,negate:false,errors,implemented:operator in Binary};
}
/** The operand-kind flag of the BINARY instruction: 1 int, 5 checked int, 2 string, 3 bool, 0 otherwise. */
export function binaryMode(operator,left,result,checked){return result==='int'?(checked&&['+','-','*'].includes(operator)?5:1):result==='string'?2:result==='bool'&&left==='bool'?3:0;}
