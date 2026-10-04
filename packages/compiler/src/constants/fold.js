/**
 * C# constant folding over typed operands (SF-A02-T32). Pinned against Roslyn by tests/compiler-constant-folding.test.js.
 *
 * Every function takes `ConstantValue` operands (never syntax) and returns one of
 *   - a `ConstantValue`        the folded constant;
 *   - `null`                   the operation is not a constant expression for these operands (the operator or conversion
 *                              does not apply, or the result is not a compile-time constant such as `"a" + 1`); reporting
 *                              CS0019/CS0023/CS0030/CS0034 for inapplicable operators is the binder's job;
 *   - `{error:{code,args}}`    (see `isFoldError`) the operation applies but fails at compile time. Codes: CS0220
 *                              (checked overflow), CS0020 (division by constant zero), CS0221 (constant out of range in a
 *                              checked conversion), CS0031 (decimal constant out of range), CS0463 (decimal overflow).
 * Nothing is thrown for C# level failures. `checked` is the overflow context of the expression: C# folds constants
 * checked unless the expression is inside `unchecked(...)`, whatever /checked says.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import {ConstantValue,Decimal,foldError,isFoldError,integralRanges,isIntegralType,enumUnderlyingType,enumTypeName,sameEnumType,bigIntToFloat} from './constant-value.js';
export {ConstantValue,Decimal,foldError,isFoldError,literalConstant,negatedLiteralConstant} from './constant-value.js';

const SMALL=['sbyte','byte','short','ushort','char'],SIGNED=['sbyte','short','int','long'];
const COMPARISONS=['==','!=','<','>','<=','>='];
const promoteIntegral=type=>SMALL.includes(type)?'int':type;
const wrap=(type,value)=>integralRanges[type][0]<0n?BigInt.asIntN(type==='long'?64:32,value):BigInt.asUintN(type==='ulong'?64:32,value);
const inRange=(type,value)=>value>=integralRanges[type][0]&&value<=integralRanges[type][1];
const implicitNumeric=Object.freeze({
  sbyte:['short','int','long','float','double','decimal'],byte:['short','ushort','int','uint','long','ulong','float','double','decimal'],
  short:['int','long','float','double','decimal'],ushort:['int','uint','long','ulong','float','double','decimal'],
  int:['long','float','double','decimal'],uint:['long','ulong','float','double','decimal'],long:['float','double','decimal'],ulong:['float','double','decimal'],
  char:['ushort','int','uint','long','ulong','float','double','decimal'],float:['double'],double:[],decimal:[]});

/**
 * True when a non-enum numeric/char constant converts implicitly to primitive `type`: identity, the implicit numeric
 * conversions, and the implicit constant expression conversions (an int constant to any integral type that holds its
 * value, a non-negative long constant to ulong).
 */
export function hasImplicitConstantConversion(value,type){
  if(!value||value.isEnum||!Object.hasOwn(implicitNumeric,value.type))return false;
  if(value.type===type||implicitNumeric[value.type].includes(type))return true;
  if(value.type==='int'&&['sbyte','byte','short','ushort','uint','ulong'].includes(type))return inRange(type,value.bigint);
  return value.type==='long'&&type==='ulong'&&value.value>=0n;
}
/**
 * The operand type C# binary numeric promotion selects for two non-enum numeric/char constants, or null when no
 * predefined operator applies (decimal with float/double, ulong with a signed operand that is not a non-negative
 * int/long constant).
 */
export function binaryNumericPromotion(left,right){
  const a=left.type,b=right.type,either=t=>a===t||b===t,other=t=>a===t?right:left;
  if(either('decimal'))return either('float')||either('double')?null:'decimal';
  if(either('double'))return 'double';
  if(either('float'))return 'float';
  if(either('ulong')){const o=other('ulong');return SIGNED.includes(o.type)&&!hasImplicitConstantConversion(o,'ulong')?null:'ulong';}
  if(either('long'))return 'long';
  if(either('uint')){const o=other('uint');return SIGNED.includes(o.type)&&!hasImplicitConstantConversion(o,'uint')?'long':'uint';}
  return 'int';
}

const isNullReference=v=>v.value===null;
const isNumericOperand=v=>!v.isEnum&&v.value!==null&&Object.hasOwn(implicitNumeric,v.type);
/** A numeric constant re-typed to `type` when the conversion is known to be value preserving (promotion). */
function promote(value,type){
  if(value.type===type&&!value.isEnum)return value;
  if(isIntegralType(type))return ConstantValue.integral(type,value.bigint);
  if(type==='decimal')return new ConstantValue('decimal',new Decimal(value.bigint,0));
  if(value.type==='float'||value.type==='double')return new ConstantValue(type,value.value);
  return new ConstantValue(type,type==='float'?bigIntToFloat(value.bigint):Number(value.bigint));
}
const compare=(op,order)=>ConstantValue.bool(op==='=='?order===0:op==='!='?order!==0:op==='<'?order<0:op==='>'?order>0:op==='<='?order<=0:order>=0);

function integralBinary(op,type,x,y,checked){
  const [min]=integralRanges[type];
  const result=value=>inRange(type,value)?ConstantValue.integral(type,value):checked?foldError(DiagnosticId.CS0220):ConstantValue.integral(type,wrap(type,value));
  switch(op){
    case '+':return result(x+y);
    case '-':return result(x-y);
    case '*':return result(x*y);
    case '/':if(y===0n)return foldError(DiagnosticId.CS0020);if(min<0n&&x===min&&y===-1n)return checked?foldError(DiagnosticId.CS0220):ConstantValue.integral(type,min);return ConstantValue.integral(type,x/y);
    case '%':if(y===0n)return foldError(DiagnosticId.CS0020);return ConstantValue.integral(type,min<0n&&y===-1n?0n:x%y);
    case '&':return ConstantValue.integral(type,x&y);
    case '|':return ConstantValue.integral(type,x|y);
    case '^':return ConstantValue.integral(type,x^y);
    default:return COMPARISONS.includes(op)?compare(op,x<y?-1:x>y?1:0):null;
  }
}
function floatingBinary(op,type,a,b){
  const make=v=>new ConstantValue(type,type==='float'?Math.fround(v):v);
  switch(op){
    case '+':return make(a+b);case '-':return make(a-b);case '*':return make(a*b);case '/':return make(a/b);case '%':return make(a%b);
    case '==':return ConstantValue.bool(a===b);case '!=':return ConstantValue.bool(a!==b);case '<':return ConstantValue.bool(a<b);
    case '>':return ConstantValue.bool(a>b);case '<=':return ConstantValue.bool(a<=b);case '>=':return ConstantValue.bool(a>=b);
    default:return null;
  }
}
function decimalBinary(op,a,b){
  const make=d=>d?new ConstantValue('decimal',d):foldError(DiagnosticId.CS0463);
  switch(op){
    case '+':return make(a.add(b));case '-':return make(a.subtract(b));case '*':return make(a.multiply(b));
    case '/':return b.isZero?foldError(DiagnosticId.CS0020):make(a.divide(b));
    case '%':return b.isZero?foldError(DiagnosticId.CS0020):make(a.remainder(b));
    default:return COMPARISONS.includes(op)?compare(op,a.compare(b)):null;
  }
}
function numericBinary(op,left,right,checked){
  const type=binaryNumericPromotion(left,right);if(!type)return null;
  const l=promote(left,type),r=promote(right,type);
  if(type==='decimal')return decimalBinary(op,l.value,r.value);
  if(type==='float'||type==='double')return floatingBinary(op,type,l.value,r.value);
  return integralBinary(op,type,l.bigint,r.bigint,checked);
}
function shift(op,left,right){
  if(!isNumericOperand(left)||!isNumericOperand(right)||!left.isIntegral||!hasImplicitConstantConversion(right,'int'))return null;
  const type=promoteIntegral(left.type),size=type==='long'||type==='ulong'?64:32,count=BigInt(Number(BigInt.asIntN(32,right.bigint))&(size-1)),x=left.bigint;
  const value=op==='<<'?wrap(type,x<<count):op==='>>'?x>>count:BigInt.asUintN(size,x)>>count;
  return ConstantValue.integral(type,op==='>>>'?wrap(type,value):value);
}
/** Roslyn converts any numeric constant with value zero (0, 0L, (byte)0, 0.0, 0m; not '\0') implicitly to every enum type. */
const isZeroConstant=v=>!v.isEnum&&v.value!==null&&v.type!=='char'&&(v.isIntegral?v.bigint===0n:v.type==='decimal'?v.value.isZero:v.isFloatingPoint&&v.value===0);
function enumBinary(op,left,right,checked){
  const enumType=(left.isEnum?left:right).enumType,underlying=enumUnderlyingType(enumType),promoted=promoteIntegral(underlying);
  let resultType,x=left.isEnum?left.bigint:0n,y=right.isEnum?right.bigint:0n;// resultType: 'bool' | 'underlying' | 'enum'
  if(left.isEnum&&right.isEnum){
    if(!sameEnumType(left.enumType,right.enumType))return null;
    resultType=COMPARISONS.includes(op)?'bool':op==='-'?'underlying':['&','|','^'].includes(op)?'enum':null;
  }else{
    const other=left.isEnum?right:left;
    if(other.type==='null')return op==='=='||op==='!='?ConstantValue.bool(op==='!='):null;
    if(!isNumericOperand(other))return null;
    const zero=isZeroConstant(other),convertible=hasImplicitConstantConversion(other,underlying);
    if(COMPARISONS.includes(op)||['&','|','^'].includes(op))resultType=zero?(COMPARISONS.includes(op)?'bool':'enum'):null;
    // 0 - E and E - 0 bind to E - E (underlying result), except E - 0 with a zero of the underlying type; otherwise E + U, U + E, E - U, U - E give E.
    else if(op==='-'&&zero&&(right.isEnum||other.type!==underlying))resultType='underlying';
    else if(op==='+'||op==='-')resultType=convertible?'enum':null;
    else resultType=null;
    if(resultType&&!zero){if(left.isEnum)y=other.bigint;else x=other.bigint;}
  }
  if(!resultType)return null;
  const folded=integralBinary(op,promoted,x,y,checked);
  if(resultType==='bool'||!folded||isFoldError(folded))return folded;
  return convertIntegral(folded,underlying,resultType==='enum'?enumType:null,checked);
}
/** Integral constant -> integral type (optionally an enum type): CS0221 when out of range in a checked context, wrap otherwise. */
function convertIntegral(value,type,enumType,checked){
  const big=value.bigint;
  if(inRange(type,big))return ConstantValue.integral(type,big,enumType);
  if(checked)return foldError(DiagnosticId.CS0221,[value.displayValue,enumType?enumTypeName(enumType):type]);
  const size=BigInt({sbyte:8,byte:8,short:16,ushort:16,char:16,int:32,uint:32,long:64,ulong:64}[type]);
  return ConstantValue.integral(type,integralRanges[type][0]<0n?BigInt.asIntN(Number(size),big):BigInt.asUintN(Number(size),big),enumType);
}

/**
 * Folds a unary operator (`+`, `-`, `!`, `~`) applied to a constant.
 * @param {string} op @param {ConstantValue} operand @param {{checked?:boolean}} [context]
 * @returns {ConstantValue|null|{error:{code:string,args:any[]}}}
 */
export function foldUnary(op,operand,{checked=true}={}){
  if(!operand||isFoldError(operand))return operand??null;
  if(op==='!')return operand.type==='bool'&&operand.value!==null?ConstantValue.bool(!operand.value):null;
  if(operand.isEnum){
    if(op!=='~')return null;
    const underlying=enumUnderlyingType(operand.enumType);
    const promoted=promoteIntegral(underlying);
    return convertIntegral(ConstantValue.integral(promoted,wrap(promoted,~operand.bigint)),underlying,operand.enumType,false);
  }
  if(!isNumericOperand(operand))return null;
  if(operand.isIntegral){
    const type=promoteIntegral(operand.type),x=operand.bigint;
    if(op==='+')return ConstantValue.integral(type,x);
    if(op==='~')return ConstantValue.integral(type,wrap(type,~x));
    if(op!=='-'||type==='ulong')return null;
    if(type==='uint')return ConstantValue.long(-x);
    return inRange(type,-x)?ConstantValue.integral(type,-x):checked?foldError(DiagnosticId.CS0220):ConstantValue.integral(type,x);
  }
  if(op==='+')return operand;
  if(op!=='-')return null;
  return operand.type==='decimal'?new ConstantValue('decimal',operand.value.negate()):new ConstantValue(operand.type,-operand.value);
}

/**
 * Folds a binary operator over two constants: arithmetic (`+ - * / %`) with binary numeric promotion, shifts
 * (`<< >> >>>`, count masked to the promoted width), bitwise and logical (`& | ^ && ||`), comparison
 * (`== != < > <= >=`), string concatenation and equality (string and null operands only), and the enum operators
 * (E+U, U+E, E-U, E-E, E&E, E|E, E^E, comparisons; the literal 0 converts to any enum).
 * @param {string} op @param {ConstantValue} left @param {ConstantValue} right @param {{checked?:boolean}} [context]
 * @returns {ConstantValue|null|{error:{code:string,args:any[]}}}
 */
export function foldBinary(op,left,right,{checked=true}={}){
  if(isFoldError(left))return left;if(isFoldError(right))return right;
  if(!left||!right)return null;
  if(left.isEnum||right.isEnum)return enumBinary(op,left,right,checked);
  if(left.type==='bool'&&right.type==='bool'&&left.value!==null&&right.value!==null){
    const a=left.value,b=right.value;
    switch(op){case '&&':case '&':return ConstantValue.bool(a&&b);case '||':case '|':return ConstantValue.bool(a||b);case '^':case '!=':return ConstantValue.bool(a!==b);case '==':return ConstantValue.bool(a===b);default:return null;}
  }
  const equality=op==='=='||op==='!=',stringLike=v=>v.type==='string'||v.type==='null';
  // Two null references are equal whatever their static types; a null literal never equals a value-type constant.
  if(isNullReference(left)&&isNullReference(right))return equality?ConstantValue.bool(op==='=='):op==='+'&&(left.type==='string'||right.type==='string')&&stringLike(left)&&stringLike(right)?ConstantValue.string(''):null;
  if(left.type==='string'||right.type==='string'){
    if(!stringLike(left)||!stringLike(right))return null;
    if(op==='+')return ConstantValue.string((left.value??'')+(right.value??''));
    return equality?ConstantValue.bool((left.value===right.value)===(op==='==')):null;
  }
  if(left.type==='null'||right.type==='null'){const other=left.type==='null'?right:left;return equality&&(isNumericOperand(other)||other.type==='bool'&&other.value!==null)?ConstantValue.bool(op==='!='):null;}
  if(!isNumericOperand(left)||!isNumericOperand(right))return null;
  if(op==='<<'||op==='>>'||op==='>>>')return shift(op,left,right);
  if(['&','|','^'].includes(op)&&!(left.isIntegral&&right.isIntegral))return null;
  if(!['+','-','*','/','%','&','|','^',...COMPARISONS].includes(op))return null;
  return numericBinary(op,left,right,checked);
}

/** Normalises a conversion target: a primitive name, a reference type name, or an enum type record/symbol. */
function target(type){
  if(typeof type==='string')return {type,enumType:null,name:type};
  return {type:enumUnderlyingType(type),enumType:type,name:enumTypeName(type)};
}
/**
 * Folds a numeric, enum or reference conversion of a constant to `type` (a primitive name such as 'byte', 'string',
 * 'object', or an enum type record/symbol). The same value is produced for implicit and explicit conversions; whether
 * an implicit conversion exists is the caller's decision (see `hasImplicitConstantConversion`). Integral and
 * floating-point sources that do not fit an integral target give CS0221 in a checked context and wrap (integral) or
 * yield 0 (floating point) in an unchecked one; decimal sources or targets out of range give CS0031 in both contexts.
 * Boxing and non-null reference conversions other than string identity are not constant (null).
 * @returns {ConstantValue|null|{error:{code:string,args:any[]}}}
 */
export function foldConversion(value,type,{checked=true}={}){
  if(!value||isFoldError(value))return value??null;
  const to=target(type),numericTarget=Object.hasOwn(implicitNumeric,to.type);
  if(value.value===null)return numericTarget||to.type==='bool'?null:ConstantValue.null(to.type);
  if(value.type==='string')return to.type==='string'?value:null;
  if(value.type==='bool')return to.type==='bool'&&!to.enumType?value:null;
  if(!numericTarget||!Object.hasOwn(implicitNumeric,value.type))return null;
  if(value.type===to.type)return to.enumType===value.enumType?value:new ConstantValue(value.type,value.value,to.enumType);
  if(isIntegralType(to.type)){
    if(value.isIntegral)return convertIntegral(value,to.type,to.enumType,checked);
    if(value.type==='decimal'){
      const big=value.value.truncate();
      return inRange(to.type,big)?ConstantValue.integral(to.type,big,to.enumType):foldError(DiagnosticId.CS0031,[value.displayValue,to.name]);
    }
    const truncated=Math.trunc(value.value);
    if(Number.isFinite(truncated)&&inRange(to.type,BigInt(truncated)))return ConstantValue.integral(to.type,BigInt(truncated),to.enumType);
    return checked?foldError(DiagnosticId.CS0221,[value.displayValue,to.name]):ConstantValue.integral(to.type,0n,to.enumType);
  }
  if(to.type==='decimal'){
    const d=value.isIntegral?Decimal.fromBigInt(value.bigint):value.type==='decimal'?value.value:Decimal.fromDouble(value.value,value.type==='float');
    return d?new ConstantValue('decimal',d):foldError(DiagnosticId.CS0031,[value.displayValue,'decimal']);
  }
  const double=value.isIntegral?Number(value.bigint):value.type==='decimal'?value.value.toDouble():value.value;
  if(to.type==='double')return new ConstantValue('double',double);
  return new ConstantValue('float',value.isIntegral?bigIntToFloat(value.bigint):Math.fround(double));
}

/**
 * Folds `condition ? whenTrue : whenFalse` over three constants. The result has the conditional's natural type: the
 * common type when the branches agree, otherwise the branch type the other branch converts to implicitly (constant
 * expression conversions included); a null branch takes the string type of the other and a constant 0 its enum type.
 * Returns null when the condition is not a bool constant or the branches have no natural type.
 */
export function foldConditional(condition,whenTrue,whenFalse){
  for(const v of [condition,whenTrue,whenFalse])if(isFoldError(v))return v;
  if(!condition||!whenTrue||!whenFalse||condition.type!=='bool'||condition.value===null)return null;
  const type=conditionalType(whenTrue,whenFalse);if(!type)return null;
  return foldConversion(condition.value?whenTrue:whenFalse,type,{checked:true});
}
function conditionalType(a,b){
  const typeOf=v=>v.isEnum?v.enumType:v.type;
  if(a.isEnum||b.isEnum){
    if(a.isEnum&&b.isEnum)return sameEnumType(a.enumType,b.enumType)?a.enumType:null;
    return isZeroConstant(a.isEnum?b:a)?(a.isEnum?a:b).enumType:null;
  }
  if(a.type===b.type)return a.type;
  if(a.type==='null'||b.type==='null'){const other=a.type==='null'?b:a;return other.value===null||other.type==='string'?other.type:null;}
  if(!isNumericOperand(a)||!isNumericOperand(b))return null;
  // Type-based conversions decide first; the constant expression conversions only break a tie-less case.
  const typed=(x,y)=>implicitNumeric[x.type].includes(y.type);
  if(typed(a,b)!==typed(b,a))return typed(a,b)?typeOf(b):typeOf(a);
  const toB=hasImplicitConstantConversion(a,b.type),toA=hasImplicitConstantConversion(b,a.type);
  return toB===toA?null:toB?b.type:a.type;
}

/**
 * The constant `default(T)` of a primitive name, a reference type name or an enum type record/symbol: zero for the
 * numeric types and char, false for bool, a typed null for reference types, the zero value for an enum.
 */
export function defaultValue(type){
  const to=target(type);
  if(isIntegralType(to.type))return ConstantValue.integral(to.type,0n,to.enumType);
  if(to.type==='float'||to.type==='double')return new ConstantValue(to.type,0);
  if(to.type==='decimal')return new ConstantValue('decimal',new Decimal(0n,0));
  if(to.type==='bool')return ConstantValue.bool(false);
  return ConstantValue.null(to.type);
}
