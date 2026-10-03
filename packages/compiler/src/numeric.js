import {numericTypeNames,numericAliases,numericTypeName,integerType,decodeScalar,encodeScalar,scalarConvert,scalarBinary,scalarUnary,decimalParse,number} from '@sharpforge/bytecode';
export const numeric=type=>numericTypeNames.includes(numericTypeName(type));
export const normalizeNumeric=type=>numericAliases[type]??type;
const implicit={sbyte:['short','int','long','nint','float','double','decimal'],byte:['short','ushort','int','uint','long','ulong','nint','nuint','float','double','decimal'],short:['int','long','nint','float','double','decimal'],ushort:['int','uint','long','ulong','nint','nuint','float','double','decimal'],char:['ushort','int','uint','long','ulong','nint','nuint','float','double','decimal'],int:['long','nint','float','double','decimal'],uint:['long','ulong','nuint','float','double','decimal'],long:['float','double','decimal'],ulong:['float','double','decimal'],nint:['long','float','double','decimal'],nuint:['ulong','float','double','decimal'],float:['double']};
export const implicitNumeric=(from,to)=>from===to||!!implicit[from]?.includes(to);
export const integral=type=>numeric(type)&&!['float','double','decimal'].includes(type);
export const unaryPromotion=(type,operator)=>['sbyte','byte','short','ushort','char'].includes(type)?'int':type==='uint'&&operator==='-'?'long':type;
export function binaryPromotion(left,right,operator) {
  if(!numeric(left)||!numeric(right))return null;
  left=unaryPromotion(left);right=unaryPromotion(right);
  if(['<<','>>','>>>'].includes(operator))return integral(left)&&implicitNumeric(right,'int')?left:null;
  if(left==='decimal'||right==='decimal')return ['float','double'].includes(left)||['float','double'].includes(right)?null:'decimal';
  if(left==='double'||right==='double')return 'double';
  if(left==='float'||right==='float')return 'float';
  if(left==='ulong'||right==='ulong')return ['int','long','nint'].includes(left)||['int','long','nint'].includes(right)?null:'ulong';
  if(left==='long'||right==='long')return 'long';
  if(left==='nuint'||right==='nuint')return ['int','nint'].includes(left)||['int','nint'].includes(right)?null:'nuint';
  if(left==='nint'||right==='nint')return left==='uint'||right==='uint'?'long':'nint';
  if(left==='uint'||right==='uint')return left==='int'||right==='int'?'long':'uint';
  return 'int';
}
export function scalarLiteral(value,type) {
  if(value?.scalar)return value.scalar==='decimal'&&typeof value.value==='string'?decimalParse(value.value):decodeScalar(value);
  if(type==='char'&&typeof value==='string')return value.charCodeAt(0);
  return value;
}
export function constantValue(value,type) {
  if(type==='int')return Number(number(value));
  if(type==='double'&&Number.isFinite(number(value))&&!Object.is(number(value),-0))return Number(number(value));
  return numeric(type)?encodeScalar(value,type):value;
}
export function numericDefault(type) {return type==='int'||type==='double'?0:type==='decimal'?{scalar:'decimal',value:[0,0,0,0]}:{scalar:type,value:'0'};}
export function constantFits(value,from,to) {
  if(!['int','long'].includes(from)||!integral(to)||from==='long'&&to!=='ulong')return false;
  try {
    const raw=number(scalarLiteral(value,from)),target=integerType(to),n=BigInt(raw),bits=BigInt(target.bits);
    return n>=(target.unsigned?0n:-(1n<<(bits-1n)))&&n<=(1n<<(target.unsigned?bits:bits-1n))-1n;
  }catch{return false;}
}
export function constantNumericUnary(operator,value,type,checked) {
  const promoted=unaryPromotion(type,operator);
  if(operator==='-'&&type==='ulong')throw Object.assign(new Error('Unary negation is not defined for UInt64'),{name:'InvalidOperationException'});
  return {type:promoted,value:constantValue(scalarUnary(operator,scalarConvert(scalarLiteral(value,type),type,promoted),promoted,checked),promoted)};
}
export function constantNumericBinary(operator,left,right,checked) {
  const type=binaryPromotion(left.type,right.type,operator);if(!type)return null;
  if(['&','|','^','<<','>>','>>>'].includes(operator)&&!integral(type))return null;
  const a=scalarConvert(scalarLiteral(left.value,left.type),left.type,type),b=['<<','>>','>>>'].includes(operator)?scalarLiteral(right.value,right.type):scalarConvert(scalarLiteral(right.value,right.type),right.type,type);
  const result=scalarBinary(operator,a,b,type,checked),resultType=typeof result==='boolean'?'bool':type;
  return {type:resultType,value:constantValue(result,resultType)};
}
