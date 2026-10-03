import {numeric,normalizeNumeric,scalarLiteral,constantValue,numericDefault,constantNumericUnary,constantNumericBinary} from './numeric.js';
import {scalarConvert, number} from '@sharpforge/bytecode';
import {formatMessage} from './diagnostics/codes.js';
import {ConstantValue, foldUnary, foldBinary, foldConversion, isFoldError} from './constants/fold.js';
/** Bounded constant evaluation; runtime scalar representation and Roslyn constant-conversion policy. */
export class ConstantError extends Error {
  constructor(node, code, args = []) {
    super(formatMessage(code, Array.isArray(args) ? args : []));
    this.name = 'ConstantError'; this.node = node; this.code = code; this.args = Array.isArray(args) ? args : [];
  }
}
const raw = value => number(scalarLiteral(value.value, value.type));
const long = value => ConstantValue.long(BigInt(raw(value)));
const int32 = value => ConstantValue.int(Number(raw(value)) | 0);
const double = value => ConstantValue.double(raw(value));
const foldResult = (node, result) => {
  if (!result) return null;
  if (isFoldError(result)) throw new ConstantError(node, result.error.code, [...result.error.args]);
  return {type: result.type, value: constantValue(result.value, result.type)};
};
const narrowInt = (node, result, checked) => {
  if (isFoldError(result)) return foldResult(node, result);
  const value = result.value;
  if (checked && (value < -2147483648n || value > 2147483647n)) throw new ConstantError(node, 'CS0220');
  return {type: 'int', value: Number(BigInt.asIntN(32, value))};
};
function primitiveBinary(node, left, right, checked) {
  const operator = node.operator;
  if (left.type === 'double' || right.type === 'double') {
    return foldResult(node, foldBinary(operator, double(left), double(right)));
  }
  if (['<<', '>>', '>>>', '&', '|', '^'].includes(operator)) {
    return foldResult(node, foldBinary(operator, int32(left), int32(right)));
  }
  const result = foldBinary(operator, long(left), long(right), {checked: false});
  if (!result || isFoldError(result) || result.type === 'bool') return foldResult(node, result);
  const divisionOverflow = operator === '/' && raw(left) === -2147483648 && raw(right) === -1;
  return narrowInt(node, result, checked || divisionOverflow);
}
export function evaluateConstant(node,{resolve=()=>null,checked=true,maxNodes=2048}={}) {
  let remaining=maxNodes;
  const fail=(n,code,message)=>{throw new ConstantError(n,code,message);};
  const walk=(n,check)=>{
    if(!n||--remaining<0)return null;
    try {
      if(n.kind==='Literal')return numeric(n.type)?{type:n.type,value:constantValue(scalarLiteral(n.value,n.type),n.type)}:['bool','string','null'].includes(n.type)?{type:n.type,value:n.value}:null;
      if(n.kind==='Name'||n.kind==='Member')return resolve(n);
      if(n.kind==='Checked'||n.kind==='Unchecked')return walk(n.expression,n.kind==='Checked');
      if(n.kind==='Default'){const type=normalizeNumeric(n.type);return numeric(type)?{type,value:numericDefault(type)}:['bool','string','object'].includes(type)?{type,value:type==='bool'?false:null}:null;}
      if(n.kind==='Unary') {
        const operand=n.operand;
        if(n.operator==='-'&&operand.kind==='Literal') {
          if(operand.type==='int'&&operand.value===2147483648||operand.type==='uint'&&operand.value?.value==='2147483648'&&!/[uUlL]$/.test(operand.literalText??''))return {type:'int',value:-2147483648};
          if(operand.type==='ulong'&&operand.value?.value==='9223372036854775808'&&!/[uU]/.test(operand.literalText??''))return {type:'long',value:{scalar:'long',value:'-9223372036854775808'}};
        }
        const x=walk(operand,check);if(!x)return null;
        if(n.operator==='!'&&x.type==='bool')return {type:'bool',value:!x.value};
        if(x.type==='int'&&['+','-'].includes(n.operator))return narrowInt(n,foldUnary(n.operator,long(x),{checked:false}),check);
        return numeric(x.type)&&['+','-','~'].includes(n.operator)?constantNumericUnary(n.operator,x.value,x.type,check):null;
      }
      if(n.kind==='Cast') {
        const x=walk(n.expression,check),to=normalizeNumeric(n.type);if(!x||!numeric(x.type)||!numeric(to)||['nint','nuint'].includes(x.type)||['nint','nuint'].includes(to))return null;
        if(['float','double'].includes(x.type)&&!['float','double','decimal'].includes(to)) {
          const value=Math.trunc(raw(x));
          if(x.type==='double'&&to==='int'&&check&&Number.isFinite(value)&&(value<-2147483648||value>2147483647)) {
            throw new ConstantError(n,'CS0220');
          }
          return foldResult(n,foldConversion(ConstantValue.of(x.type,raw(x)),to,{checked:check}));
        }
        return {type:to,value:constantValue(scalarConvert(scalarLiteral(x.value,x.type),x.type,to,check),to)};
      }
      if(n.kind==='Conditional') {
        const condition=walk(n.condition,check),yes=walk(n.whenTrue,check),no=walk(n.whenFalse,check);
        return condition?.type==='bool'&&yes&&no?(condition.value?yes:no):null;
      }
      if(n.kind!=='Binary')return null;
      const l=walk(n.left,check),r=walk(n.right,check),op=n.operator;if(!l||!r)return null;
      const a=l.value,b=r.value;
      if(op==='+'&&(l.type==='string'||r.type==='string'))return ['string','null'].includes(l.type)&&['string','null'].includes(r.type)?{type:'string',value:(a??'')+(b??'')}:null;
      if(l.type==='bool'&&r.type==='bool'&&['&&','||','&','|','^','==','!='].includes(op))return {type:'bool',value:op==='&&'||op==='&'?a&&b:op==='||'||op==='|'?a||b:op==='^'||op==='!='?a!==b:a===b};
      if(['==','!='].includes(op)&&['string','null'].includes(l.type)&&['string','null'].includes(r.type))return {type:'bool',value:op==='=='?a===b:a!==b};
      if(['int','double'].includes(l.type)&&['int','double'].includes(r.type))return primitiveBinary(n,l,r,check);
      return numeric(l.type)&&numeric(r.type)?constantNumericBinary(op,l,r,check):null;
    } catch(error) {
      if(error instanceof ConstantError)throw error;
      if(error.name==='DivideByZeroException')fail(n,'CS0020','Division by constant zero');
      if(error.name==='OverflowException')fail(n,'CS0220','The operation overflows at compile time in checked mode');
      return null;
    }
  };
  return walk(node,checked);
}
