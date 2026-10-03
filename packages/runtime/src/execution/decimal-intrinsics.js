import {numericIntrinsicDefinitions} from '@sharpforge/cil';
import {ManagedFault,isReference} from '../heap.js';
import {numericTypeName} from './numeric-types.js';
import {number} from './numeric-ops.js';
import {scalarConvert} from './scalar-ops.js';
import {isDecimal,decimal,decimalZero,decimalMaxCoefficient,decimalFromBits,decimalBits,decimalParse,decimalFromInteger,decimalFromFloat,decimalCompare,decimalAbs,decimalRound,decimalNegate,decimalBinary,decimalFormat} from './decimal-ops.js';

const definitions=numericIntrinsicDefinitions.filter(definition=>definition.owner!=='System.BitConverter');
export const decimalIntrinsicDefinitions=Object.freeze(definitions);
export const decimalConstants=Object.freeze({Zero:decimalZero,One:decimal(1n),MinusOne:decimal(1n,0,true),MaxValue:decimal(decimalMaxCoefficient),MinValue:decimal(decimalMaxCoefficient,0,true)});
const key=descriptor=>{const signature=descriptor.signature??descriptor;return [descriptor.owner,descriptor.name,signature.isStatic?'static':'instance',signature.parameters.map(numericTypeName).join(','),numericTypeName(signature.returnType??signature.result)].join('|');};
const keys=new Set(definitions.map(key));
const operators={Add:'+',op_Addition:'+',Subtract:'-',op_Subtraction:'-',Multiply:'*',op_Multiply:'*',Divide:'/',op_Division:'/',Remainder:'%',op_Modulus:'%',op_Equality:'==',op_Inequality:'!=',op_LessThan:'<',op_LessThanOrEqual:'<=',op_GreaterThan:'>',op_GreaterThanOrEqual:'>='};

/** Adapter for source framework calls and verified CIL Decimal MemberRefs. */
export function invokeDecimal(vm,descriptor,args) {
  if(!keys.has(key(descriptor)))return {handled:false};
  const signature=descriptor.signature??descriptor,context={...vm.options,fault:(type,message)=>new ManagedFault(type,message)},name=descriptor.name;
  const raw=value=>{if(value?.byref)return raw(vm.dereference(value));if(value?.enumType)return raw(value.value);if(isReference(value)){const record=vm.heap.get(value);return record.kind==='box'?raw(record.data[0]):record.kind==='string'?record.data:value;}return value;};
  const ctor=name==='.ctor',hasReceiver=!signature.isStatic&&(!ctor||args.length===signature.parameters.length+1),receiver=hasReceiver?args[0]:null;
  const values=(hasReceiver?args.slice(1):args).map((value,index)=>signature.parameters[index]?.endsWith('&')?value:isDecimal(value)?value:raw(value));
  const result=value=>({handled:true,value:signature.returnType==='bool'&&vm.inspector?value?1:0:value});
  if(ctor) {
    let value;
    if(signature.parameters.length===5){const scale=Number(number(values[4]));if(!Number.isInteger(scale)||scale<0||scale>28)throw new ManagedFault('ArgumentOutOfRangeException','Decimal scale must be between zero and 28');value=decimalFromBits([number(values[0]),number(values[1]),number(values[2]),(scale<<16)|(number(values[3])?0x80000000:0)],context);}
    else if(signature.parameters[0]==='int[]')value=decimalFromBits(vm.heap.get(args.at(-1)).data,context);
    else if(['float','double'].includes(signature.parameters[0]))value=decimalFromFloat(number(values[0]),signature.parameters[0]==='float'?'r4':'r8',context);
    else value=scalarConvert(values[0],signature.parameters[0],'decimal',false,context);
    if(receiver!==null){vm.dereference(receiver,true,value);return result(null);}return result(value);
  }
  const operand=hasReceiver?raw(receiver):values[0];
  if(operators[name])return result(decimalBinary(operators[name],values[0],values[1],context));
  if(name==='op_Implicit'||name==='op_Explicit'||name.startsWith('To')&&name!=='ToString')return result(scalarConvert(values[0],signature.parameters[0],signature.returnType,false,context));
  if(name==='Parse'||name==='TryParse') {
    let value=decimalZero,success=true;
    try{value=decimalParse(values[0],{...context,allowExponent:false,allowThousands:true,allowTrailingSign:true});}
    catch(error){if(name==='Parse'||!['ArgumentNullException','FormatException','OverflowException'].includes(error.name))throw error;success=false;}
    if(name==='TryParse'){vm.dereference(args.at(-1),true,value);return result(success);}return result(value);
  }
  if(name==='ToString')return result(vm.heap.string(decimalFormat(operand,values[0]??'G',context)));
  if(name==='GetBits'){const bits=decimalBits(operand,context),reference=vm.heap.array('int',4);vm.heap.get(reference).data=bits;return result(reference);}
  if(name==='Equals')return result(isDecimal(operand)&&isDecimal(hasReceiver?values[0]:values[1])&&decimalCompare(operand,hasReceiver?values[0]:values[1],context)===0);
  if(name==='Compare'||name==='CompareTo') {
    const other=hasReceiver?values[0]:values[1];if(other===null)return result(1);
    if(!isDecimal(other))throw new ManagedFault('ArgumentException','Object must be a Decimal');
    return result(decimalCompare(operand,other,context));
  }
  if(name==='GetHashCode') {
    if(operand.coefficient===0n)return result(0);
    let n=operand.coefficient,scale=operand.scale;while(scale>0&&n%10n===0n){n/=10n;scale--;}
    const bits=decimalBits(decimal(n,scale,operand.negative));return result(bits.reduce((hash,word)=>hash^word,0));
  }
  if(name==='Abs')return result(decimalAbs(operand,context));
  if(name==='Negate'||name==='op_UnaryNegation')return result(decimalNegate(operand,context));
  if(name==='op_UnaryPlus')return result(operand);
  if(name==='op_Increment'||name==='op_Decrement')return result(decimalBinary(name==='op_Increment'?'+':'-',operand,decimalConstants.One,context));
  if(name==='Min'||name==='Max'){const order=decimalCompare(values[0],values[1],context);return result((name==='Min'?order<0:order>=0)?values[0]:values[1]);}
  if(name==='Sign')return result(decimalCompare(operand,decimalZero,context));
  if(name==='Ceiling'||name==='Floor'||name==='Truncate')return result(decimalRound(operand,0,{Ceiling:4,Floor:3,Truncate:2}[name],context));
  if(name==='Round') {
    const modeOnly=signature.parameters[1]==='System.MidpointRounding',digits=modeOnly?0:Number(number(values[1]??0)),mode=Number(number(values[modeOnly?1:2]??0));
    return result(decimalRound(operand,digits,mode,context));
  }
  throw new ManagedFault('MissingMethodException','Unimplemented Decimal intrinsic '+name);
}
