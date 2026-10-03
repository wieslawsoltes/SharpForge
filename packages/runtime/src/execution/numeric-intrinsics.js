import {nativeSize} from './native-int.js';
import {ManagedFault} from '../heap.js';
import {storageValue} from './storage.js';
import {number,float} from './numeric-ops.js';
import {invokeDecimal} from './decimal-intrinsics.js';
import {numericTypeName,integerType} from './numeric-types.js';

/** Exact IEEE wire observations; these do not format or coerce through strings. */
export function singleToInt32Bits(value) {const view=new DataView(new ArrayBuffer(4));view.setFloat32(0,number(value),true);return view.getInt32(0,true);}
export function doubleToInt64Bits(value) {const view=new DataView(new ArrayBuffer(8));view.setFloat64(0,number(value),true);return view.getBigInt64(0,true);}
export function int32BitsToSingle(value) {const view=new DataView(new ArrayBuffer(4));view.setInt32(0,Number(number(value)),true);return float(view.getFloat32(0,true),'r4');}
export function int64BitsToDouble(value) {const view=new DataView(new ArrayBuffer(8));view.setBigInt64(0,BigInt(number(value)),true);return float(view.getFloat64(0,true),'r8');}
const bits={SingleToInt32Bits:singleToInt32Bits,DoubleToInt64Bits:doubleToInt64Bits,Int32BitsToSingle:int32BitsToSingle,Int64BitsToDouble:int64BitsToDouble};
const signatures={SingleToInt32Bits:['float','int'],DoubleToInt64Bits:['double','long'],Int32BitsToSingle:['int','float'],Int64BitsToDouble:['long','double']};
export function invokeNumericIntrinsic(vm,descriptor,args) {
  if (['System.IntPtr', 'System.UIntPtr'].includes(descriptor.owner) && descriptor.name === 'get_Size') {
    return {handled: true, value: nativeSize(vm.options)};
  }
  if(descriptor.owner==='System.Object'&&descriptor.name==='.ctor'&&args.length===0)return {handled:true,value:vm.heap.object('System.Object',[])};
  if(descriptor.owner==='System.Console'&&['Write','WriteLine'].includes(descriptor.name)){const signature=descriptor.signature??descriptor;vm.emitOutput((args.length?vm.format(args[0],descriptor.formatType??signature.parameters[0]):'')+(descriptor.name==='WriteLine'?'\n':''));return {handled:true,value:null};}
  const signature=descriptor.signature??descriptor;
  if(descriptor.owner==='System.Convert'&&descriptor.name==='ToString')return {handled:true,value:vm.heap.string(vm.format(args[0],descriptor.formatType??signature.parameters[0]))};
  if(descriptor.owner==='System.Math'&&!signature.parameters.some(type=>numericTypeName(type)==='decimal')) {
    const name=descriptor.name,type=numericTypeName(signature.returnType);
    const values=args.map((value,index)=>{const raw=vm.value(value),integer=integerType(signature.parameters[index],vm.options);if(!integer)return raw;const n=integer.unsigned?BigInt.asUintN(integer.bits,BigInt(raw)):BigInt.asIntN(integer.bits,BigInt(raw));return integer.bits===64?n:Number(n);});
    let value;
    if(name==='Abs') {
      const input=values[0],integer=integerType(signature.parameters[0],vm.options);
      if(integer&&!integer.unsigned&&BigInt(input)===-(1n<<BigInt(integer.bits-1)))throw new ManagedFault('OverflowException','Absolute value exceeds its signed integer width');
      value=typeof input==='bigint'?(input<0n?-input:input):Math.abs(input);
    } else if(name==='Sign') {
      if(typeof values[0]==='number'&&Number.isNaN(values[0]))throw new ManagedFault('ArithmeticException','NaN has no sign');
      value=values[0]>0?1:values[0]<0?-1:0;
    } else if((name==='Min'||name==='Max')&&typeof values[0]==='bigint')value=(name==='Min'?values[0]<values[1]:values[0]>values[1])?values[0]:values[1];
    else if(name==='Round') {
      const modeOnly=signature.parameters[1]==='System.MidpointRounding',digits=modeOnly?0:values[1]??0,mode=values[modeOnly?1:2]??0,input=values[0];
      if(!Number.isInteger(digits)||digits<0||digits>15)throw new ManagedFault('ArgumentOutOfRangeException','Rounding digits must be between 0 and 15');
      if(!Number.isInteger(mode)||mode<0||mode>4)throw new ManagedFault('ArgumentException','Invalid midpoint rounding mode');
      if(Math.abs(input)>=1e16)value=input;
      else {
        const power=10**digits,scaled=input*power,floor=Math.floor(scaled),fraction=scaled-floor;
        value=(mode===0?(fraction===.5?(floor%2===0?floor:floor+1):Math.round(scaled)):mode===1?Math.trunc(scaled+Math.sign(scaled)*.49999999999999994):mode===2?Math.trunc(scaled):mode===3?Math.floor(scaled):Math.ceil(scaled))/power;
        if(value===0&&(input<0||Object.is(input,-0)))value=-0;
      }
    } else if(name==='Log'&&values.length===2) {
      const [input,base]=values;value=base===1||input!==1&&(base===0||base===Infinity)?NaN:Math.log(input)/Math.log(base);
    } else {
      const operation={Min:'min',Max:'max',Sqrt:'sqrt',Floor:'floor',Ceiling:'ceil',Truncate:'trunc',Sin:'sin',Cos:'cos',Tan:'tan',Asin:'asin',Acos:'acos',Atan:'atan',Atan2:'atan2',Log:'log',Log10:'log10',Exp:'exp',Pow:'pow'}[name];
      if(!operation)return {handled:false};value=Math[operation](...values);
    }
    return {handled:true,value:storageValue(vm,value,type)};
  }
  if(descriptor.owner==='System.BitConverter'&&bits[descriptor.name]) {
    const signature=descriptor.signature??descriptor,[parameter,result]=signatures[descriptor.name];
    if(!signature.isStatic||signature.parameters?.length!==1||numericTypeName(signature.parameters[0])!==parameter||numericTypeName(signature.returnType)!==result)return {handled:false};
    return {handled:true,value:bits[descriptor.name](args[0])};
  }
  return invokeDecimal(vm,descriptor,args);
}
