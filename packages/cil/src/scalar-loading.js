import {Op,Binary,Unary,EnumConvertBase,NumericType,numericTypeName,numericMode,encodeScalar,decodeScalar,decimalFromBits} from '@sharpforge/bytecode';
import {enumTypes} from '@sharpforge/framework';
import {CilError} from './binary.js';
const arithmetic={add:'+',sub:'-',mul:'*',div:'/',rem:'%',and:'&',or:'|',xor:'^',shl:'<<',shr:'>>'};
const decimalOperators={Addition:'+',Subtraction:'-',Multiply:'*',Division:'/',Modulus:'%',Equality:'==',Inequality:'!=',LessThan:'<',LessThanOrEqual:'<=',GreaterThan:'>',GreaterThanOrEqual:'>='};
const constant=i=>i.name==='ldc.i4.m1'?-1:i.name==='ldc.i4'||i.name==='ldc.i4.s'||['ldc.i8','ldc.r4','ldc.r8'].includes(i.name)?i.operand:/^ldc\.i4\.[0-8]$/.test(i.name)?Number(i.name.at(-1)):undefined;
/** Type marker tokens are ordinary no-op IL, never executable debug metadata.
 * Canonical re-emission still validates the entire span and its signatures. */
export function scalarSpan(span,c) {
  let end=span.length,unary=false;
  if(span[end-2]?.name==='ldnull'&&span[end-1]?.name==='pop'){unary=true;end-=2;}
  const checked=span[end-1]?.name==='nop';if(checked)end--;
  const marker=()=>{
    if(span[end-2]?.name!=='ldtoken'||span[end-1]?.name!=='pop')return null;
    const type=c.metadata.typeName(span[end-2].operand);end-=2;return numericTypeName(type);
  };
  const type=marker();if(type===null)return null;
  if(NumericType[type]===undefined&&!enumTypes.includes(type))throw new CilError('Invalid scalar type marker');
  const from=marker(),body=span.slice(0,end),emit=(op,a=0,b=0)=>({op,a,b});
  if(from!==null)return emit(Op.CONVERT,NumericType[type]??EnumConvertBase+enumTypes.indexOf(type),numericMode(from,checked));
  const call=body.filter(i=>i.name==='call'||i.name==='newobj').at(-1);
  // Metadata resolution is supplied by the loader because it includes signatures.
  const target=call?c.resolveCall(call.operand):null;
  if(unary) {
    const name=target?.name,operator=name==='op_UnaryNegation'||body.some(i=>i.name==='neg'||i.name==='mul.ovf')?'-':body.some(i=>i.name==='not')?'~':'+';
    return emit(Op.UNARY,Unary[operator],numericMode(type,checked));
  }
  if(body.length&&constant(body[0])!==undefined) {
    let wire;
    if(type==='decimal') {
      const numbers=body.slice(0,5).map(constant);
      if(numbers.some(value=>value===undefined)||target?.owner!=='System.Decimal'||target.name!=='.ctor')throw new CilError('Invalid Decimal constant span');
      wire=encodeScalar(decimalFromBits([numbers[0],numbers[1],numbers[2],(numbers[4]<<16)|(numbers[3]?0x80000000:0)]),'decimal');
    } else {
      const value=constant(body[0]),text=typeof value==='number'&&Object.is(value,-0)?'-0':String(value);
      if(['uint','ulong','nuint','byte','ushort','char'].includes(type)) {
        const bits=type==='ulong'?64:type==='byte'?8:type==='ushort'||type==='char'?16:32;
        wire={scalar:type,value:BigInt.asUintN(bits,BigInt(value)).toString()};
      } else wire={scalar:type,value:text};
      wire=encodeScalar(decodeScalar(wire),type);
    }
    return emit(Op.CONST,c.intern(wire),type==='double'?1:0);
  }
  let operator;
  if(target?.owner==='System.Decimal')operator=decimalOperators[target.name?.replace(/^op_/,'')];
  if(!operator){const operation=body.find(i=>arithmetic[i.name.split('.')[0]]);if(operation)operator=arithmetic[operation.name.split('.')[0]];}
  if(!operator) {
    const comparisons=body.filter(i=>['ceq','clt','clt.un','cgt','cgt.un'].includes(i.name)),first=comparisons[0]?.name;
    if(first==='ceq')operator=comparisons.length===1?'==':'!=';
    else if(first?.startsWith('clt'))operator=comparisons.length===1?'<':'>=';
    else if(first?.startsWith('cgt'))operator=comparisons.length===1?'>':'<=';
  }
  if(!operator)throw new CilError('Invalid scalar operation span');
  return emit(Op.BINARY,Binary[operator],numericMode(type,checked));
}
