import {decodeScalar,decimalBits,numericTypeNames,numericTypeName,integerType,decodeNumericMode} from '@sharpforge/bytecode';
import {CilError} from './binary.js';
export const scalarCilNames={sbyte:'i1',byte:'u1',short:'i2',ushort:'u2',char:'u2',int:'i4',uint:'u4',long:'i8',ulong:'u8',nint:'i',nuint:'u',float:'r4',double:'r8'};
export const scalarMetadataType=type=>numericTypeName(type)==='decimal'?'System.Decimal':numericTypeName(type);
export function scalarMarker(w,c,type,checked=false,from=null) {
  if(from!==null)w.op('ldtoken',c.resolveType(scalarMetadataType(from))).op('pop');
  w.op('ldtoken',c.resolveType(scalarMetadataType(type))).op('pop');
  if(checked)w.op('nop');
}
export function emitScalarConstant(w,c,constant) {
  const type=constant.scalar,value=decodeScalar(constant);
  if(type==='decimal') {
    const bits=decimalBits(value);for(let i=0;i<3;i++)w.integer(bits[i]);
    w.integer(value.negative?1:0).integer(value.scale).op('newobj',c.external('System.Decimal','.ctor','void',['int','int','int','bool','byte'],false));
  } else if(type==='long'||type==='ulong')w.op('ldc.i8',value);
  else if(type==='float'||type==='double')w.op(type==='float'?'ldc.r4':'ldc.r8',value.value);
  else if(type==='nint'||type==='nuint'){w.op('ldc.i8',BigInt(constant.value));w.op(type==='nint'?'conv.i':'conv.u');}
  else w.integer(value);
  scalarMarker(w,c,type);
}
export function emitScalarConversion(w,c,from,to,checked=false) {
  from=numericTypeName(from);to=numericTypeName(to);
  if(from===to)return;
  if(to==='decimal') {
    if(from==='nint'||from==='nuint'){w.op(from==='nint'?'conv.i8':'conv.u8');from=from==='nint'?'long':'ulong';}
    w.op('call',c.external('System.Decimal',['float','double'].includes(from)?'op_Explicit':'op_Implicit','System.Decimal',[from]));return;
  }
  if(from==='decimal') {const native=to==='nint'||to==='nuint';w.op('call',c.external('System.Decimal','op_Explicit',native?(to==='nint'?'long':'ulong'):to,['System.Decimal']));if(native)w.op(to==='nint'?'conv.ovf.i':'conv.ovf.u.un');return;}
  const suffix=scalarCilNames[to];if(!suffix)throw new CilError('Invalid scalar conversion target');
  const source=integerType(from),target=integerType(to);
  if(!target) {if(source?.unsigned)w.op('conv.r.un');w.op('conv.'+suffix);return;}
  if(checked){w.op('conv.ovf.'+suffix+(source?.unsigned?'.un':''));return;}
  if((to==='nint'||to==='nuint')&&source&&source.bits<=32&&!source.native){w.op(source.unsigned?'conv.u':'conv.i');if(to==='nuint'&&!source.unsigned)w.op('conv.u');return;}
  // C# signed Int32 -> UInt64 widens the signed value before reinterpretation.
  if(to==='ulong'&&source&&!source.unsigned&&source.bits<64)w.op('conv.i8');
  if((to==='long'||to==='ulong')&&source?.unsigned&&source.bits<=32)w.op('conv.u8');
  else w.op('conv.'+suffix);
}
const arithmetic={'+':'add','-':'sub','*':'mul','/':'div','%':'rem','&':'and','|':'or','^':'xor','<<':'shl','>>':'shr'};
const decimalOperators={'+':'Addition','-':'Subtraction','*':'Multiply','/':'Division','%':'Modulus','==':'Equality','!=':'Inequality','<':'LessThan','<=':'LessThanOrEqual','>':'GreaterThan','>=':'GreaterThanOrEqual'};
export function emitScalarBinary(w,c,operator,mode) {
  const {type,checked}=decodeNumericMode(mode),integer=integerType(type),comparison=['==','!=','<','<=','>','>='].includes(operator);
  if(type==='decimal') {
    const name=decimalOperators[operator];if(!name)throw new CilError('Invalid Decimal operator');
    w.op('call',c.external('System.Decimal','op_'+name,comparison?'bool':'System.Decimal',['System.Decimal','System.Decimal']));
  } else if(operator in arithmetic) {
    const overflow=integer&&checked&&['+','-','*'].includes(operator),unsigned=integer?.unsigned&&(overflow||['/','%','>>'].includes(operator));
    w.op(arithmetic[operator]+(overflow?'.ovf':'')+(unsigned?'.un':''));
    if(type==='float'||type==='double')w.op('conv.'+scalarCilNames[type]);
  } else if(operator==='==')w.op('ceq');
  else if(operator==='!=')w.op('ceq').integer(0).op('ceq');
  else if(operator==='<')w.op(integer?.unsigned?'clt.un':'clt');
  else if(operator==='>')w.op(integer?.unsigned?'cgt.un':'cgt');
  else if(operator==='<=')w.op(integer?.unsigned||!integer?'cgt.un':'cgt').integer(0).op('ceq');
  else if(operator==='>=')w.op(integer?.unsigned||!integer?'clt.un':'clt').integer(0).op('ceq');
  else throw new CilError('Invalid scalar operator');
  scalarMarker(w,c,type,checked);
}
export function emitScalarUnary(w,c,operator,mode) {
  const {type,checked}=decodeNumericMode(mode);
  if(type==='decimal')w.op('call',c.external('System.Decimal',operator==='-'?'op_UnaryNegation':'op_UnaryPlus','System.Decimal',['System.Decimal']));
  else if(operator==='-'&&checked&&integerType(type)) {
    if(type==='long')w.op('ldc.i8',-1n);else {w.integer(-1);if(type==='nint')w.op('conv.i');}
    w.op('mul.ovf');
  } else if(operator==='-')w.op('neg');
  else if(operator==='~')w.op('not');
  else if(operator!=='+')throw new CilError('Invalid scalar unary operator');
  if(type!=='decimal')w.op('conv.'+scalarCilNames[type]);
  scalarMarker(w,c,type,checked);w.op('ldnull').op('pop');
}
