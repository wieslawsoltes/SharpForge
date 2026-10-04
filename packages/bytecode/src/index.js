import {varargsStackEffect} from './varargs-verification.js';
import {referenceStackEffect} from './reference-verification.js';
import {exceptionRegionEntries} from './exception-regions.js';
import {Op, OpName} from './opcodes.js';
import {memoryStackEffect} from './memory-verification.js';
import {numericTypeNames,decodeNumericMode} from './numeric/numeric-types.js';
import {decodeScalar} from './numeric/scalar-ops.js';
import {enumTypes,frameworkType} from '@sharpforge/framework';
/** Versioned, structured-cloneable stack bytecode. Each instruction is three signed 32-bit words. */
export const FORMAT_VERSION = 2;
// Numeric conversion IDs occupy the low range; enum targets retain declared identity.
export const EnumConvertBase = 65536;
export {Op, OpName} from './opcodes.js';
export const Binary = Object.freeze(Object.fromEntries(['+','-','*','/','%','==','!=','<','<=','>','>=','&','|','^','<<','>>','>>>'].map((n,i)=>[n,i])));
export const BinaryName = Object.freeze(Object.keys(Binary));
export const Unary = Object.freeze({ '-':0, '+':1, '!':2, '~':3 });
export const UnaryName = Object.freeze(Object.keys(Unary));
import {Builtins} from './builtins.js';
export {Builtins,BuiltinMap,frameworkBuiltin,CONTRACT_BUILTIN_OFFSET,createBuiltinRegistry} from './builtins.js';
export {numericIntrinsicDefinitions} from './numeric-intrinsic-profile.js';
export {syncIntrinsicDefinitions,isSynchronizationIntrinsic} from './sync-intrinsic-profile.js';
export function disassemble(image, methodId) {
  const methods=methodId===undefined?image.methods:[image.methods[methodId]];
  return methods.map(m=>({name:m.qualifiedName,id:m.id,instructions:Array.from({length:m.code.length/3},(_,i)=>({offset:i,op:OpName[m.code[i*3]],a:m.code[i*3+1],b:m.code[i*3+2],point:m.code[i*3]===Op.SEQ?image.sequencePoints[m.code[i*3+1]]:null}))}));
}
export function serializeImage(image) { return JSON.stringify(image, (key,value)=>value instanceof Int32Array?{$int32:[...value]}:value); }
export function deserializeImage(text) { const image=JSON.parse(text,(key,value)=>value?.$int32?Int32Array.from(value.$int32):value);if(image.formatVersion!==FORMAT_VERSION)throw new Error('Unsupported SharpForge bytecode version');return image; }
/** Structural and stack-height verification for compiler output and externally loaded images. */
export function verifyImage(image){
  const errors=[];
  if(image?.formatVersion!==FORMAT_VERSION||!Array.isArray(image?.methods)||!Array.isArray(image?.constants)||!Array.isArray(image?.types)||!Array.isArray(image?.sequencePoints)||!Array.isArray(image?.statics))return ['Malformed or incompatible bytecode image'];
  const fail=(m,pc,msg)=>{if(errors.length<100)errors.push(`${m?.qualifiedName??'<image>'}:${pc}: ${msg}`);};
  if(image.outputKind==='library'?image.entryPoint!==null:!Number.isInteger(image.entryPoint)||!image.methods[image.entryPoint])fail(null,0,'Invalid entry point');
  for(const m of image.methods){
    if(![undefined,0,5].includes(m.callingConvention))fail(m,0,'Unsupported source calling convention');
    if(!(m.code instanceof Int32Array)||m.code.length%3||m.code.length>3_000_000||!Array.isArray(m.locals)||!Array.isArray(m.handlers)){fail(m,0,'Invalid code or metadata');continue;}
    const n=m.code.length/3,heights=new Map(),queue=[[0,0]];
    queue.push(...exceptionRegionEntries(m,fail));
    while(queue.length){const [pc,height]=queue.pop();if(pc<0||pc>=n){fail(m,pc,'Control flow leaves the method');continue;}if(heights.has(pc)){if(heights.get(pc)!==height)fail(m,pc,'Inconsistent stack height at join');continue;}heights.set(pc,height);
      const op=m.code[pc*3],a=m.code[pc*3+1],b=m.code[pc*3+2];let need=0,delta=0;
      const memory=varargsStackEffect(op,a,b,image,m)??referenceStackEffect(op,a,b,image,m)??memoryStackEffect(op,a,b,image.constants);
      if(memory){need=memory.need;delta=memory.delta;if(!memory.valid)fail(m,pc,'Invalid memory instruction');}
      else switch(op){
        case Op.ENUM:if(!enumTypes[a])fail(m,pc,'Invalid enum type');delta=1;break;case Op.DELEGATE:need=1;if(!image.methods[a]||frameworkType(image.constants[b])?.kind!=='delegate')fail(m,pc,'Invalid delegate');break;case Op.NOP:break;case Op.ENDFINALLY:if(height!==0)fail(m,pc,'Finally must have an empty stack');break;
        case Op.ENDFILTER:need=1;delta=-1;if(height!==1||!m.handlers.some(h=>h.filter!==undefined&&pc>=h.filter&&pc<h.target))fail(m,pc,'Invalid filter exit');break;
        case Op.SEQ:if(!image.sequencePoints[a])fail(m,pc,'Invalid sequence point');break;
        case Op.CONST:if(a<0||a>=image.constants.length)fail(m,pc,'Invalid constant');else if(image.constants[a]?.scalar){try{decodeScalar(image.constants[a]);}catch{fail(m,pc,'Invalid scalar constant');}}delta=1;break;
        case Op.LDLOC:case Op.STLOC:if(a<0||a>=m.locals.length)fail(m,pc,'Invalid local');if(op===Op.LDLOC)delta=1;else need=1;break;
        case Op.LDSTATIC:case Op.STSTATIC:if(a<0||a>=image.statics.length)fail(m,pc,'Invalid static');if(op===Op.LDSTATIC)delta=1;else need=1;break;
        case Op.LDFLD:need=1;break;case Op.STFLD:need=2;delta=-1;break;
        case Op.DUP:need=1;delta=1;break;case Op.POP:need=1;delta=-1;break;
        case Op.BINARY:need=2;delta=-1;if(!BinaryName[a])fail(m,pc,'Invalid binary operator');if(b>=16?(()=>{try{decodeNumericMode(b);return false;}catch{return true;}})():![0,1,2,3,5].includes(b)||b===5&&!['+','-','*'].includes(BinaryName[a]))fail(m,pc,'Invalid binary mode');break;
        case Op.CONVERT:need=1;if(!numericTypeNames[a]&&!enumTypes[a-EnumConvertBase]||(b>=16?(()=>{try{decodeNumericMode(b);return false;}catch{return true;}})():![0,1].includes(b)||b===1&&a===1))fail(m,pc,'Invalid numeric conversion');break;
        case Op.UNARY:need=1;if(!UnaryName[a]||(b>=16?(()=>{try{decodeNumericMode(b);return false;}catch{return true;}})():![0,1,5].includes(b)||b===5&&a!==0))fail(m,pc,'Invalid unary operator');break;
        case Op.JUMP:break;case Op.JFALSE:case Op.JTRUE:need=1;delta=-1;break;
        case Op.CALL:if(!image.methods[a])fail(m,pc,'Invalid method');else if((image.methods[a].callingConvention===5?b<image.methods[a].parameters.length+(image.methods[a].isStatic?0:1):b!==image.methods[a].parameters.length+(image.methods[a].isStatic?0:1)))fail(m,pc,'Invalid argument count');need=b;delta=1-b;break;
        case Op.BUILTIN:if(!Builtins[a]||b<Builtins[a].min||b>Builtins[a].max)fail(m,pc,'Invalid intrinsic');need=b;delta=1-b;break;
        case Op.RET:need=1;delta=-1;if(height!==1)fail(m,pc,'Return stack must contain exactly one value');break;
        case Op.NEWOBJ:if(!image.types[a])fail(m,pc,'Invalid managed type');delta=1;break;
        case Op.NEWARR:if(typeof image.constants[a]!=='string')fail(m,pc,'Invalid array element type');need=1;break;
        case Op.LDELEM:need=2;delta=-1;break;case Op.STELEM:need=3;delta=-2;break;
        case Op.LENGTH:need=1;break;case Op.THROW:need=1;delta=-1;break;case Op.RETHROW:break;
        default:fail(m,pc,'Unknown opcode');continue;
      }
      if(height<need){fail(m,pc,'Stack underflow');continue;}
      if(op===Op.RET||op===Op.THROW||op===Op.RETHROW||op===Op.ENDFINALLY||op===Op.ENDFILTER)continue;
      if(op===Op.JUMP||op===Op.JFALSE||op===Op.JTRUE)queue.push([a,height+delta]);
      if(op!==Op.JUMP)queue.push([pc+1,height+delta]);
    }
  }
  return errors;
}

export {numericTypeNames,NumericType,numericAliases,numericTypeName,numericTypeId,numericMode,decodeNumericMode,nativeIntegerBits,integerType} from './numeric/numeric-types.js';
export {float,isNativeInteger,nativeInteger,number,isNumber,defaults,compare,binary,unary,convert,storage,indirect} from './numeric/numeric-ops.js';
export {decimalMaxCoefficient,isDecimal,decimal,decimalZero,decimalFromBits,decimalBits,decimalParse,decimalFromInteger,decimalFromFloat,decimalToInteger,decimalToFloat,decimalCompare,decimalNegate,decimalAbs,decimalAdd,decimalMultiply,decimalDivide,decimalRemainder,decimalRound,decimalFormat,decimalBinary} from './numeric/decimal-ops.js';
export {scalarConvert,scalarBinary,scalarUnary,encodeScalar,decodeScalar,scalarFormat} from './numeric/scalar-ops.js';

export {numericFormat} from './numeric/numeric-format.js';

export {int64Binary, int64Compare, int64Unary, smallInt64, smallInt64Binary, smallInt64Compare, smallInt64Unary} from './numeric/int64.js';
export {checkedInteger, numericFault} from './numeric/checked.js';
export {smallInteger, smallIntegerIndirect} from './numeric/small-int.js';
export {uint32Binary, uint32Compare} from './numeric/uint32.js';
export {nativeBinary, nativeSize} from './numeric/native-int.js';
export {floatBinary, floatCompare, finiteFloat, ieeeRemainder} from './numeric/float.js';
export {conversionTargets} from './numeric/conversions.js';
export {managedExceptionTypes,exceptionTypeName,exceptionBaseType,exceptionHResult,exceptionMatches} from './exception-types.js';
export {arrayIntrinsicDefinitions} from './array-intrinsic-profile.js';

export {arrayType, spanType, memoryTypeName, memoryOpcodes} from './memory-types.js';

export {memoryStackEffect} from './memory-verification.js';

export {exceptionIntrinsicDefinitions} from './exception-intrinsic-profile.js';

export {varargsIntrinsicDefinitions,varargsTypeDefinition,fixedCallSignature,validVarargsSignature} from './varargs-profile.js';
