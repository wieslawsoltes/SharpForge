/** Side-effect-free C# constant evaluation for this compiler's primitive type profile.
 * Returning null means nonconstant; diagnostics retain the exact source node.
 *
 * This module is a thin syntax adapter over the typed folder in constants/fold.js: it walks the current AST profile
 * (Literal, Name/Member, Checked/Unchecked, Default, Unary, Cast, Conditional, Binary), keeps the profile's plain
 * `{type:'int'|'double'|'bool'|'string'|'null',value}` results and raises `ConstantError` for fold failures.
 * Profile behaviour preserved on purpose (it differs from Roslyn, which fold.js follows):
 *   - an int literal may carry 2147483648 (the lexer admits it for `-2147483648`), so int arithmetic is folded in
 *     long and narrowed here: CS0220 when checked, wrap-around otherwise;
 *   - int.MinValue / -1 is CS0220 in both contexts;
 *   - (int) of a finite out-of-range double is CS0220 when checked (NaN/infinity report CS0221).
 * Unchecked floating constants follow Roslyn's zero result, independently of CoreCLR's saturating runtime casts.
 */
import {DiagnosticId} from './diagnostics/codes.js';
import {formatMessage} from './diagnostics/codes.js';
import {ConstantValue,foldUnary,foldBinary,foldConversion,isFoldError} from './constants/fold.js';
export class ConstantError extends Error {
  constructor(node, code, args=[]) { super(formatMessage(code,args)); this.name='ConstantError';this.node=node;this.code=code;this.args=args; }
}
const ARITHMETIC=['+','-','*','/','%'],COMPARISON=['==','!=','<','>','<=','>='],BITWISE=['<<','>>','&','|','^'];
/** Typed operands for the profile's plain values. */
const long=x=>ConstantValue.long(BigInt(x.value)),int32=x=>ConstantValue.int(x.value|0),double=x=>ConstantValue.double(x.value);
const reference=x=>x.type==='null'?ConstantValue.null():ConstantValue.string(x.value);
/**
 * Evaluates a constant expression node.
 * @param node expression syntax @param {{resolve?:(node:object)=>({type:string,value:any}|null),checked?:boolean,maxNodes?:number}} [options]
 *   `resolve` supplies the value of Name/Member nodes, `checked` the enclosing overflow context, `maxNodes` the budget.
 * @returns {{type:string,value:any}|null} the constant, or null when the expression is not constant
 * @throws {ConstantError} CS0220, CS0020 or CS0221 at the offending node
 */
export function evaluateConstant(node, {resolve=()=>null, checked=true, maxNodes=2048}={}) {
  let remaining=maxNodes;
  /** Unwraps a fold result into the profile's plain shape, raising fold failures at `n`. */
  const plain=(n,result)=>{
    if(result===null)return null;
    if(isFoldError(result))throw new ConstantError(n,result.error.code,[...result.error.args]);
    return {type:result.type,value:typeof result.value==='bigint'?Number(result.value):result.value};
  };
  /** Narrows a folded long (or BigInt) to the profile's int. */
  const int=(n,result,check)=>{
    if(isFoldError(result))return plain(n,result);
    const big=typeof result==='bigint'?result:result.value;
    if(check&&(big< -2147483648n||big>2147483647n))throw new ConstantError(n,DiagnosticId.CS0220,[]);
    return {type:'int',value:Number(BigInt.asIntN(32,big))};
  };
  const walk=(n,check)=>{
    if(!n||--remaining<0)return null;
    if(n.kind==='Literal')return ['int','double','bool','string','null'].includes(n.type)?{type:n.type,value:n.value}:null;
    if(n.kind==='Name'||n.kind==='Member')return resolve(n);
    if(n.kind==='Checked'||n.kind==='Unchecked')return walk(n.expression,n.kind==='Checked');
    if(n.kind==='Default'&&['int','double','bool','string','object'].includes(n.type))return {type:n.type,value:n.type==='bool'?false:['int','double'].includes(n.type)?0:null};
    if(n.kind==='Unary'){
      if(n.operator==='-'&&n.operand.kind==='Literal'&&n.operand.type==='int'&&n.operand.value===2147483648)return int(n,-2147483648n,check);
      const x=walk(n.operand,check);if(!x)return null;
      if(n.operator==='!'&&x.type==='bool')return plain(n,foldUnary('!',ConstantValue.bool(x.value)));
      if(n.operator==='~'&&x.type==='int')return plain(n,foldUnary('~',int32(x)));
      if(['+','-'].includes(n.operator)&&x.type==='int')return int(n,foldUnary(n.operator,long(x),{checked:false}),check);
      if(['+','-'].includes(n.operator)&&x.type==='double')return plain(n,foldUnary(n.operator,double(x)));
      return null;
    }
    if(n.kind==='Cast'){
      const x=walk(n.expression,check);if(!x||!['int','double'].includes(x.type)||!['int','double'].includes(n.type))return null;
      if(n.type==='double')return plain(n,foldConversion(x.type==='int'?long(x):double(x),'double'));
      if(x.type==='int')return int(n,BigInt(Math.trunc(x.value)),check);
      const value=Math.trunc(x.value);
      if(Number.isFinite(value)&&(value<-2147483648||value>2147483647)&&check)throw new ConstantError(n,DiagnosticId.CS0220,[]);
      return plain(n,foldConversion(double(x),'int',{checked:check}));
    }
    if(n.kind==='Conditional'){
      const condition=walk(n.condition,check),yes=walk(n.whenTrue,check),no=walk(n.whenFalse,check);
      return condition?.type==='bool'&&yes&&no?(condition.value?yes:no):null;
    }
    if(n.kind!=='Binary')return null;
    const l=walk(n.left,check),r=walk(n.right,check),op=n.operator;
    if(!l||!r)return null;
    const references=['string','null'].includes(l.type)&&['string','null'].includes(r.type);
    if(op==='+'&&(l.type==='string'||r.type==='string')){
      // C# constant string concatenation is restricted to strings/null, not boxing.
      return references?plain(n,foldBinary('+',reference(l),reference(r))):null;
    }
    if(l.type==='bool'&&r.type==='bool'&&['&&','||','&','|','^','==','!='].includes(op))return plain(n,foldBinary(op,ConstantValue.bool(l.value),ConstantValue.bool(r.value)));
    if(['==','!='].includes(op)&&references)return plain(n,foldBinary(op,reference(l),reference(r)));
    if(!['int','double'].includes(l.type)||!['int','double'].includes(r.type))return null;
    const floating=l.type==='double'||r.type==='double',operand=floating?double:long;
    if(COMPARISON.includes(op))return plain(n,foldBinary(op,operand(l),operand(r)));
    if(floating)return ARITHMETIC.includes(op)?plain(n,foldBinary(op,double(l),double(r))):null;
    if(BITWISE.includes(op))return plain(n,foldBinary(op,int32(l),int32(r)));
    if(!ARITHMETIC.includes(op))return null;
    // Folded in long, where 32-bit operands cannot overflow, then narrowed with the profile's int rules.
    return int(n,foldBinary(op,long(l),long(r),{checked:false}),check||op==='/'&&l.value===-2147483648&&r.value===-1);
  };
  return walk(node,checked);
}
