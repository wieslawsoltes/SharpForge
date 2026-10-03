import {number,float} from './numeric-ops.js';
import {invokeDecimal} from './decimal-intrinsics.js';
import {numericTypeName} from './numeric-types.js';

/** Exact IEEE wire observations; these do not format or coerce through strings. */
export function singleToInt32Bits(value) {const view=new DataView(new ArrayBuffer(4));view.setFloat32(0,number(value),true);return view.getInt32(0,true);}
export function doubleToInt64Bits(value) {const view=new DataView(new ArrayBuffer(8));view.setFloat64(0,number(value),true);return view.getBigInt64(0,true);}
export function int32BitsToSingle(value) {const view=new DataView(new ArrayBuffer(4));view.setInt32(0,Number(number(value)),true);return float(view.getFloat32(0,true),'r4');}
export function int64BitsToDouble(value) {const view=new DataView(new ArrayBuffer(8));view.setBigInt64(0,BigInt(number(value)),true);return float(view.getFloat64(0,true),'r8');}
const bits={SingleToInt32Bits:singleToInt32Bits,DoubleToInt64Bits:doubleToInt64Bits,Int32BitsToSingle:int32BitsToSingle,Int64BitsToDouble:int64BitsToDouble};
const signatures={SingleToInt32Bits:['float','int'],DoubleToInt64Bits:['double','long'],Int32BitsToSingle:['int','float'],Int64BitsToDouble:['long','double']};
export function invokeNumericIntrinsic(vm,descriptor,args) {
  if(descriptor.owner==='System.BitConverter'&&bits[descriptor.name]) {
    const signature=descriptor.signature??descriptor,[parameter,result]=signatures[descriptor.name];
    if(!signature.isStatic||signature.parameters?.length!==1||numericTypeName(signature.parameters[0])!==parameter||numericTypeName(signature.returnType)!==result)return {handled:false};
    return {handled:true,value:bits[descriptor.name](args[0])};
  }
  return invokeDecimal(vm,descriptor,args);
}
