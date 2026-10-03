import {numericTypeName,integerType,nativeIntegerBits} from './numeric-types.js';
import {float,number,nativeInteger,isNativeInteger,binary,compare,unary,convert,storage} from './numeric-ops.js';
import {isDecimal,decimalParse,decimalFromBits,decimalBits,decimalFromInteger,decimalFromFloat,decimalToFloat,decimalBinary,decimalNegate,decimalFormat} from './decimal-ops.js';

const fault=(type,message)=>Object.assign(new Error(message),{name:type});
const fail=(context,message)=>{throw (context?.fault??fault)('InvalidProgramException',message);};
const operations={'+':'add','-':'sub','*':'mul','/':'div','%':'rem','&':'and','|':'or','^':'xor','<<':'shl','>>':'shr','>>>':'shr'};
const comparisons={'==':'eq','!=':'ne','<':'lt','<=':'le','>':'gt','>=':'ge'};
const conversions={sbyte:'i1',byte:'u1',short:'i2',ushort:'u2',char:'u2',int:'i4',uint:'u4',long:'i8',ulong:'u8',nint:'i',nuint:'u',float:'r4',double:'r8'};
const unwrap=value=>value?.enumType?value.value:number(value);

/** Source expressions carry their promoted type in bytecode, not in JS typeof. */
export function scalarConvert(value,from,to,checked=false,context={}) {
  from=numericTypeName(from);to=numericTypeName(to);
  const source=integerType(from,context),target=integerType(to,context);
  if(to==='decimal') {
    if(isDecimal(value))return value;
    if(source)return decimalFromInteger(unwrap(value),source.unsigned,source.bits,context);
    if(from==='float'||from==='double')return decimalFromFloat(unwrap(value),from==='float'?'r4':'r8',context);
    return fail(context,'Invalid Decimal conversion');
  }
  if(isDecimal(value))return convert('conv.'+conversions[to],value,context);
  if(!conversions[to]||!source&&from!=='float'&&from!=='double')return fail(context,'Unknown scalar conversion');
  let input;
  if(source) {
    const raw=unwrap(value);
    if(typeof raw!=='bigint'&&!Number.isInteger(raw))return fail(context,'Integer scalar required');
    // Sign/zero extension depends on the declared source type, including the
    // C# Int32 -> UInt64 case that requires conv.i8 before unsigned reinterpretation.
    input=source.unsigned?BigInt.asUintN(source.bits,BigInt(raw)):BigInt.asIntN(source.bits,BigInt(raw));
  } else input=float(unwrap(value),from==='float'?'r4':'r8');
  if(target)return convert('conv.'+(checked?'ovf.':'')+conversions[to],input,context);
  return float(Number(number(input)),to==='float'?'r4':'r8');
}
export function scalarBinary(operator,left,right,type,checked=false,context={}) {
  type=numericTypeName(type);
  if(type==='decimal')return decimalBinary(operator,left,right,context);
  const integer=integerType(type,context),floating=type==='float'||type==='double';
  if(!integer&&!floating)return fail(context,'Unknown scalar arithmetic type');
  const normalize=value=>{
    if(floating){const kind=type==='float'?'r4':'r8';return value?.float===kind?value:float(unwrap(value),kind);}
    const raw=unwrap(value);
    if((type==='int'||type==='uint')&&typeof raw==='number'&&Number.isInteger(raw))return raw|0;
    if((type==='long'||type==='ulong')&&typeof raw==='bigint')return BigInt.asIntN(64,raw);
    return storage(value,type,context);
  };
  left=normalize(left);
  right=['<<','>>','>>>'].includes(operator)?Number(unwrap(right))|0:normalize(right);
  if(comparisons[operator])return compare(left,right,comparisons[operator],!!integer?.unsigned,context);
  const op=operations[operator];if(!op)return fail(context,'Unknown scalar binary operator');
  if(floating&&['&','|','^','<<','>>','>>>'].includes(operator))return fail(context,'Floating-point bit operations are invalid');
  const overflow=integer&&checked&&['+','-','*'].includes(operator);
  const unsigned=integer&&(integer.unsigned&&['/','%','>>'].includes(operator)||operator==='>>>'||overflow&&integer.unsigned);
  return binary(op+(overflow?'.ovf':'')+(unsigned?'.un':''),left,right,context);
}
export function scalarUnary(operator,value,type,checked=false,context={}) {
  type=numericTypeName(type);
  if(type==='decimal')return operator==='-'?decimalNegate(value,context):operator==='+'?value:fail(context,'Invalid Decimal unary operator');
  const integer=integerType(type,context);
  const prepared=storage(value,type,context);
  if(operator==='+')return prepared;
  if(operator==='~'){if(!integer)return fail(context,'Bitwise complement requires an integer');return unary('not',prepared,context);}
  if(operator!=='-')return fail(context,'Unknown scalar unary operator');
  if(checked&&integer) {
    const zero=integer.native?nativeInteger(0,integer.bits):integer.bits===64?0n:0;
    return binary(integer.unsigned?'sub.ovf.un':'sub.ovf',zero,prepared,context);
  }
  return unary('neg',prepared,context);
}

/** JSON wire constants preserve integer widths, negative zero and Decimal scale. */
export function encodeScalar(value,type,context) {
  type=numericTypeName(type);
  if(type==='decimal')return Object.freeze({scalar:type,value:Object.freeze(decimalBits(value,context))});
  const integer=integerType(type,context),raw=unwrap(value);
  if(integer) {
    const n=integer.unsigned?BigInt.asUintN(integer.bits,BigInt(raw)):BigInt.asIntN(integer.bits,BigInt(raw));
    return Object.freeze({scalar:type,value:n.toString()});
  }
  if(type!=='float'&&type!=='double')return fail(context,'Unknown scalar constant type');
  return Object.freeze({scalar:type,value:Object.is(raw,-0)?'-0':String(raw)});
}
export function decodeScalar(constant,context={}) {
  if(!constant||typeof constant!=='object'||typeof constant.scalar!=='string')return fail(context,'Malformed scalar constant');
  const type=numericTypeName(constant.scalar),value=constant.value;
  if(type==='decimal')return Array.isArray(value)?decimalFromBits(value,context):decimalParse(value,context);
  const integer=integerType(type,context);
  if(integer) {
    if(typeof value!=='string'||!/^[-+]?\d+$/.test(value)||value.length>32)return fail(context,'Malformed integer constant');
    const n=BigInt(value),min=integer.unsigned?0n:-(1n<<BigInt(integer.bits-1)),max=(1n<<BigInt(integer.unsigned?integer.bits:integer.bits-1))-1n;
    if(n<min||n>max)throw (context.fault??fault)('OverflowException','Integer literal exceeds its declared width');
    return integer.native?nativeInteger(n,nativeIntegerBits(context)):integer.bits===64?BigInt.asIntN(64,n):Number(n)|0;
  }
  if(type!=='float'&&type!=='double'||typeof value!=='string'||!/^(?:NaN|[-+]?Infinity|-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)$/.test(value))return fail(context,'Malformed floating-point constant');
  return float(Number(value),type==='float'?'r4':'r8');
}
export function scalarFormat(value,type,context) {
  if(isDecimal(value))return decimalFormat(value,'G',context);
  if(isNativeInteger(value)&&context?.nativeIntBits===undefined)context={...context,nativeIntBits:value.nativeInt};
  type=numericTypeName(type??(value?.float==='r4'?'float':value?.float?'double':isNativeInteger(value)?'nint':typeof value==='bigint'?'long':'int'));
  const integer=integerType(type,context),raw=unwrap(value);
  if(type==='char')return String.fromCharCode(Number(raw)&65535);
  if(integer)return (integer.unsigned?BigInt.asUintN(integer.bits,BigInt(raw)):BigInt.asIntN(integer.bits,BigInt(raw))).toString();
  return Object.is(raw,-0)?'-0':String(raw);
}
