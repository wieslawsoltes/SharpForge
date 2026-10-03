import {numericIntrinsicDefinitions} from './numeric-intrinsic-profile.js';
import {syncIntrinsicDefinitions} from './sync-intrinsic-profile.js';
import {numericTypeNames,decodeNumericMode} from './numeric/numeric-types.js';
import {decodeScalar} from './numeric/scalar-ops.js';
import {contracts,enumTypes,frameworkType} from '@sharpforge/framework';
/** Versioned, structured-cloneable stack bytecode. Each instruction is three signed 32-bit words. */
export const FORMAT_VERSION = 1;
// Numeric conversion IDs occupy the low range; enum targets retain declared identity.
export const EnumConvertBase = 65536;
export const Op = Object.freeze(Object.fromEntries(['SEQ','CONST','LDLOC','STLOC','LDSTATIC','STSTATIC','LDFLD','STFLD','DUP','POP','BINARY','UNARY','JUMP','JFALSE','JTRUE','CALL','BUILTIN','RET','NEWOBJ','NEWARR','LDELEM','STELEM','LENGTH','THROW','RETHROW','CONVERT','NOP','ENDFINALLY','DELEGATE','ENUM','ADDRESS'].map((n,i)=>[n,i])));
export const OpName = Object.freeze(Object.keys(Op));
export const Binary = Object.freeze(Object.fromEntries(['+','-','*','/','%','==','!=','<','<=','>','>=','&','|','^','<<','>>'].map((n,i)=>[n,i])));
export const BinaryName = Object.freeze(Object.keys(Binary));
export const Unary = Object.freeze({ '-':0, '+':1, '!':2, '~':3 });
export const UnaryName = Object.freeze(Object.keys(Unary));
const definitions = [
 ['Console.WriteLine',0,1,'void',['any']],['Console.Write',1,1,'void',['any']],
 ['Math.Abs',1,1,'numeric',['number']],['Math.Min',2,2,'numeric',['number','number']],['Math.Max',2,2,'numeric',['number','number']],
 ['Math.Pow',2,2,'double',['number','number']],['Math.Sqrt',1,1,'double',['number']],['Math.Floor',1,1,'double',['number']],['Math.Ceiling',1,1,'double',['number']],['Math.Round',1,1,'double',['number']],
 ['GC.Collect',0,0,'void',[]],['GC.GetTotalMemory',0,1,'long',['bool']],['GC.CollectionCount',1,1,'int',['int']],
 ['int.Parse',1,1,'int',['string']],['double.Parse',1,1,'double',['string']],['Convert.ToInt32',1,1,'int',['any']],['Convert.ToDouble',1,1,'double',['any']],['Convert.ToString',1,1,'string',['any']],
 ['string.Concat',2,2,'string',['string','string']],['string.IsNullOrEmpty',1,1,'bool',['string']],
 ['Array.Reverse',1,1,'void',['array']],['Array.Sort',1,1,'void',['array']],
 ['string.Substring',2,3,'string',['string','int','int']],['string.Contains',2,2,'bool',['string','string']],['string.IndexOf',2,2,'int',['string','string']],
 ['string.StartsWith',2,2,'bool',['string','string']],['string.EndsWith',2,2,'bool',['string','string']],['string.ToUpper',1,1,'string',['string']],['string.ToLower',1,1,'string',['string']],['string.Trim',1,1,'string',['string']],['string.Replace',3,3,'string',['string','string','string']],
 ['object.ToString',1,1,'string',['any']],['Exception.Message',1,1,'string',['exception']],['Exception.new',1,1,'Exception',['string']],
 ['Debug.Assert',1,2,'void',['bool','string']],['Environment.TickCount',0,0,'int',[]],['$Math.Abs.Int32',1,1,'int',['int']]
];
// Append new intrinsics after framework entries so released builtin IDs do not move.
const additions=[['string.Intern',1,1,'string',['string']],['string.IsInterned',1,1,'string',['string']],['string.get_Chars',2,2,'int',['string','int']],['object.ReferenceEquals',2,2,'bool',['object','object']],['Enum.HasFlag',2,2,'bool',['any','any']],['object.GetType',1,1,'System.Type',['any']],['Type.Name',1,1,'string',['System.Type']],['Type.FullName',1,1,'string',['System.Type']],...['int','double','bool','long',...numericTypeNames.filter(type=>!['int','double','long'].includes(type))].map(type=>['$type.'+type+'.GetType',1,1,'System.Type',['any']])];
const originalBuiltins = [...definitions.map(([name,min,max,result,params],id)=>Object.freeze({id,name,min,max,result,params})),...contracts.map(contract=>{const id=definitions.length+contract.id,count=contract.parameters.length+(!contract.isStatic&&contract.kind!=='constructor'?1:0);return Object.freeze({id,name:'$framework:'+contract.id,min:count,max:count,result:contract.result,params:[...(!contract.isStatic&&contract.kind!=='constructor'?[contract.owner]:[]),...contract.parameters],contract});}),...additions.map(([name,min,max,result,params],index)=>Object.freeze({id:definitions.length+contracts.length+index,name,min,max,result,params}))];

const profileBuiltin=(descriptor,kind,id)=>{const constructor=descriptor.name==='.ctor',count=descriptor.parameters.length+(!descriptor.isStatic&&!constructor?1:0);return Object.freeze({id,name:'$'+kind+':'+descriptor.owner+'::'+descriptor.name+'('+descriptor.parameters.join(',')+'):'+descriptor.returnType,min:count,max:count,result:constructor?descriptor.owner:descriptor.returnType,params:Object.freeze([...(!descriptor.isStatic&&!constructor?[descriptor.owner]:[]),...descriptor.parameters]),[kind]:descriptor});};
export const Builtins=Object.freeze([...originalBuiltins,...numericIntrinsicDefinitions.map((descriptor,index)=>profileBuiltin(descriptor,'numeric',originalBuiltins.length+index)),...syncIntrinsicDefinitions.map((descriptor,index)=>profileBuiltin(descriptor,'synchronization',originalBuiltins.length+numericIntrinsicDefinitions.length+index))]);
export {numericIntrinsicDefinitions} from './numeric-intrinsic-profile.js';
export {syncIntrinsicDefinitions,isSynchronizationIntrinsic} from './sync-intrinsic-profile.js';
export const frameworkBuiltin = contract=>contract?Builtins[definitions.length+contract.id]:null;
export const BuiltinMap = new Map(Builtins.map(b=>[b.name,b]));
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
    if(!(m.code instanceof Int32Array)||m.code.length%3||m.code.length>3_000_000||!Array.isArray(m.locals)||!Array.isArray(m.handlers)){fail(m,0,'Invalid code or metadata');continue;}
    const n=m.code.length/3,heights=new Map(),queue=[[0,0]];
    for(const h of m.handlers){if(h.start<0||h.end>n||h.start>=h.end||h.target<0||h.target>=n||(h.kind==='finally'?(!Number.isInteger(h.handlerEnd)||h.handlerEnd<=h.target||h.handlerEnd>n):(h.slot<0||h.slot>=m.locals.length)))fail(m,0,'Invalid exception handler');else queue.push([h.target,0]);}
    while(queue.length){const [pc,height]=queue.pop();if(pc<0||pc>=n){fail(m,pc,'Control flow leaves the method');continue;}if(heights.has(pc)){if(heights.get(pc)!==height)fail(m,pc,'Inconsistent stack height at join');continue;}heights.set(pc,height);
      const op=m.code[pc*3],a=m.code[pc*3+1],b=m.code[pc*3+2];let need=0,delta=0;
      switch(op){
        case Op.ENUM:if(!enumTypes[a])fail(m,pc,'Invalid enum type');delta=1;break;case Op.DELEGATE:need=1;if(!image.methods[a]||frameworkType(image.constants[b])?.kind!=='delegate')fail(m,pc,'Invalid delegate');break;case Op.NOP:break;case Op.ENDFINALLY:if(height!==0)fail(m,pc,'Finally must have an empty stack');break;
        case Op.SEQ:if(!image.sequencePoints[a])fail(m,pc,'Invalid sequence point');break;
        case Op.CONST:if(a<0||a>=image.constants.length)fail(m,pc,'Invalid constant');else if(image.constants[a]?.scalar){try{decodeScalar(image.constants[a]);}catch{fail(m,pc,'Invalid scalar constant');}}delta=1;break;
        case Op.LDLOC:case Op.STLOC:if(a<0||a>=m.locals.length)fail(m,pc,'Invalid local');if(op===Op.LDLOC)delta=1;else need=1;break;
        case Op.LDSTATIC:case Op.STSTATIC:if(a<0||a>=image.statics.length)fail(m,pc,'Invalid static');if(op===Op.LDSTATIC)delta=1;else need=1;break;
        case Op.ADDRESS:if(a<0||a>7||b<0||(a&3)===0&&b>=m.locals.length||(a&3)===1&&b>=image.statics.length||(a&3)===3&&b!==0)fail(m,pc,'Invalid managed address');need=(a&3)===2?1:(a&3)===3?2:0;delta=1-need;break;
        case Op.LDFLD:need=1;break;case Op.STFLD:need=2;delta=-1;break;
        case Op.DUP:need=1;delta=1;break;case Op.POP:need=1;delta=-1;break;
        case Op.BINARY:need=2;delta=-1;if(!BinaryName[a])fail(m,pc,'Invalid binary operator');if(b>=16?(()=>{try{decodeNumericMode(b);return false;}catch{return true;}})():![0,1,2,3,5].includes(b)||b===5&&!['+','-','*'].includes(BinaryName[a]))fail(m,pc,'Invalid binary mode');break;
        case Op.CONVERT:need=1;if(!numericTypeNames[a]&&!enumTypes[a-EnumConvertBase]||(b>=16?(()=>{try{decodeNumericMode(b);return false;}catch{return true;}})():![0,1].includes(b)||b===1&&a===1))fail(m,pc,'Invalid numeric conversion');break;
        case Op.UNARY:need=1;if(!UnaryName[a]||(b>=16?(()=>{try{decodeNumericMode(b);return false;}catch{return true;}})():![0,1,5].includes(b)||b===5&&a!==0))fail(m,pc,'Invalid unary operator');break;
        case Op.JUMP:break;case Op.JFALSE:case Op.JTRUE:need=1;delta=-1;break;
        case Op.CALL:if(!image.methods[a])fail(m,pc,'Invalid method');else if(b!==image.methods[a].parameters.length+(image.methods[a].isStatic?0:1))fail(m,pc,'Invalid argument count');need=b;delta=1-b;break;
        case Op.BUILTIN:if(!Builtins[a]||b<Builtins[a].min||b>Builtins[a].max)fail(m,pc,'Invalid intrinsic');need=b;delta=1-b;break;
        case Op.RET:need=1;delta=-1;if(height!==1)fail(m,pc,'Return stack must contain exactly one value');break;
        case Op.NEWOBJ:if(!image.types[a])fail(m,pc,'Invalid managed type');delta=1;break;
        case Op.NEWARR:if(typeof image.constants[a]!=='string')fail(m,pc,'Invalid array element type');need=1;break;
        case Op.LDELEM:need=2;delta=-1;break;case Op.STELEM:need=3;delta=-2;break;
        case Op.LENGTH:need=1;break;case Op.THROW:need=1;delta=-1;break;case Op.RETHROW:break;
        default:fail(m,pc,'Unknown opcode');continue;
      }
      if(height<need){fail(m,pc,'Stack underflow');continue;}
      if(op===Op.RET||op===Op.THROW||op===Op.RETHROW||op===Op.ENDFINALLY)continue;
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

export {int64Binary, int64Compare, int64Unary} from './numeric/int64.js';
export {checkedInteger, numericFault} from './numeric/checked.js';
export {smallInteger, smallIntegerIndirect} from './numeric/small-int.js';
export {uint32Binary, uint32Compare} from './numeric/uint32.js';
