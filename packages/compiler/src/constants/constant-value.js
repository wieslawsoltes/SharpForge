import {DiagnosticId} from '../diagnostics/codes.js';
/**
 * Typed compile-time constant values (SF-A02-T32).
 *
 * `ConstantValue` is the immutable, typed result of C# constant evaluation: one discriminator per primitive type
 * (sbyte, byte, short, ushort, int, uint, long, ulong, char, float, double, decimal, bool, string, null), an optional
 * enum type for enum constants (the value is then stored in the enum's underlying type) and typed null references
 * (`default(string)`, `(object)null`). Value representation:
 *   sbyte/byte/short/ushort/int/uint/char  JS number (char is the UTF-16 code unit)
 *   long/ulong                             BigInt
 *   float                                  JS number already rounded with Math.fround
 *   double                                 JS number
 *   decimal                                `Decimal` (exact System.Decimal model: 96-bit magnitude, scale 0..28)
 *   bool / string / null                   boolean / string (or null for a typed null) / null
 * This module has no dependency on the syntax tree, the symbol model or the diagnostic catalog; operations that can
 * fail return `{error:{code,args}}` records (see `isFoldError`) whose codes are Roslyn ids.
 */

/** Inclusive ranges of the integral types, as BigInt pairs. */
export const integralRanges=Object.freeze({sbyte:[-128n,127n],byte:[0n,255n],short:[-32768n,32767n],ushort:[0n,65535n],int:[-2147483648n,2147483647n],uint:[0n,4294967295n],long:[-(1n<<63n),(1n<<63n)-1n],ulong:[0n,(1n<<64n)-1n],char:[0n,65535n]});
/** Every primitive discriminator a `ConstantValue` can carry. */
export const constantTypes=Object.freeze(['sbyte','byte','short','ushort','int','uint','long','ulong','char','float','double','decimal','bool','string','null']);
export const isIntegralType=type=>Object.hasOwn(integralRanges,type);
export const isNumericType=type=>isIntegralType(type)&&type!=='char'||type==='float'||type==='double'||type==='decimal';
const specialTypeNames=Object.freeze({System_SByte:'sbyte',System_Byte:'byte',System_Int16:'short',System_UInt16:'ushort',System_Int32:'int',System_UInt32:'uint',System_Int64:'long',System_UInt64:'ulong',System_Char:'char'});

/** A fold failure record: `{error:{code,args}}` with a Roslyn diagnostic id and its message arguments. */
export function foldError(code,args=[]){return Object.freeze({error:Object.freeze({code,args:Object.freeze([...args])})});}
/** True when a fold result is a failure record rather than a `ConstantValue` or null (not constant). */
export const isFoldError=result=>!!result&&typeof result==='object'&&!(result instanceof ConstantValue)&&'error' in result;

const MAX96=(1n<<96n)-1n,MAX_SCALE=28,MASK64=(1n<<64n)-1n;
const pow10=n=>10n**BigInt(n);
const abs=v=>v<0n?-v:v;
/** n/d for positive BigInts, rounded half to even. */
function roundDiv(n,d){const q=n/d,twice=(n%d)*2n;return twice>d||twice===d&&(q&1n)===1n?q+1n:q;}
/** Largest-precision System.Decimal for magnitude*10^-scale (rounding half to even when digits must go), or null on overflow. */
function fitDecimal(negative,magnitude,scale){
  for(let drop=Math.max(0,scale-MAX_SCALE);drop<=scale;drop++){
    const m=drop===0?magnitude:roundDiv(magnitude,pow10(drop));
    if(m<=MAX96)return new Decimal(negative?-m:m,scale-drop);
  }
  return null;
}
const float32=new Float32Array(1),int32=new Int32Array(float32.buffer),float64=new Float64Array(1),int64=new BigInt64Array(float64.buffer);
/** IEEE bit patterns, as lower-case hex, of a float (8 digits) or double (16 digits). */
export function floatBits(value){float32[0]=value;return (int32[0]>>>0).toString(16).padStart(8,'0');}
export function doubleBits(value){float64[0]=value;return BigInt.asUintN(64,int64[0]).toString(16).padStart(16,'0');}

/**
 * Exact model of System.Decimal: `mantissa` is a signed BigInt with |mantissa| < 2^96 and `scale` (0..28) the number
 * of decimal digits after the point; the scale is observable (1.0m and 1.00m differ) exactly as in .NET. Arithmetic
 * returns null on overflow. The sign of a zero is not modelled.
 */
export class Decimal{
  constructor(mantissa,scale=0){
    if(typeof mantissa!=='bigint'||!Number.isInteger(scale)||scale<0||scale>MAX_SCALE||abs(mantissa)>MAX96)throw new RangeError('Invalid decimal');
    this.mantissa=mantissa;this.scale=scale;Object.freeze(this);
  }
  /** Parses the digits of a C# decimal literal (no suffix) the way System.Decimal parsing does; null when out of range. */
  static parse(text){
    const m=/^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(text).replaceAll('_',''));if(!m||!(m[2]||m[3]))return null;
    const integer=m[2].replace(/^0+/,''),fraction=m[3]??'';let digits,e;
    if(integer){digits=integer+fraction;e=integer.length;}else{const stripped=fraction.replace(/^0+/,'');digits=stripped;e=stripped.length-fraction.length;}
    e+=Number(m[4]??0);
    if(/^0*$/.test(digits))return new Decimal(0n,Math.min(MAX_SCALE,Math.max(0,digits.length-e)));
    if(e>29)return null;
    const limit=MAX96/10n;let value=0n,i=0;const at=k=>k<digits.length?digits.charCodeAt(k)-48:-1;
    while((e>0||at(i)>=0&&e>-MAX_SCALE)&&(value<limit||value===limit&&at(i)<=5)){value=value*10n+BigInt(Math.max(0,at(i)));if(at(i)>=0)i++;e--;}
    if(at(i)>=5){
      const exactHalf=at(i)===5&&/^0*$/.test(digits.slice(i+1));
      if(!(exactHalf&&(value&1n)===0n)){value++;if(value>MAX96){value=MAX96/10n+1n;e++;}}
    }
    if(e>0)return null;
    if(e<=-29)return new Decimal(0n,MAX_SCALE);
    return new Decimal(m[1]==='-'?-value:value,-e);
  }
  static fromBigInt(value){return abs(value)>MAX96?null:new Decimal(value,0);}
  /** (decimal)double / (decimal)float exactly as System.Decimal converts them (15 resp. 7 significant digits); null on overflow or NaN. */
  static fromDouble(value,single=false){
    if(Number.isNaN(value))return null;
    let exponent;
    if(single){float32[0]=value;exponent=((int32[0]>>>23)&0xff)-126;}else{float64[0]=value;exponent=Number((int64[0]>>52n)&0x7ffn)-1022;}
    if(exponent<-94)return new Decimal(0n,0);
    if(exponent>96)return null;
    const negative=value<0,digits=single?6:14,top=single?1e7:1e15;let dbl=Math.abs(value),power=digits-((exponent*19728)>>16);
    if(power>=0){if(power>MAX_SCALE)power=MAX_SCALE;dbl*=Number('1e'+power);}
    else if(power!==-1||dbl>=top)dbl/=Number('1e'+(-power));
    else power=0;
    if(dbl<top/10&&power<MAX_SCALE){dbl*=10;power++;}
    let mantissa=BigInt(Math.trunc(dbl));const rest=dbl-Math.trunc(dbl);
    if(rest>0.5||rest===0.5&&(mantissa&1n)===1n)mantissa++;
    if(mantissa===0n)return new Decimal(0n,0);
    if(power<0){mantissa*=pow10(-power);if(mantissa>MAX96)return null;power=0;}
    else for(let max=Math.min(power,digits);max>0&&mantissa%10n===0n;max--){mantissa/=10n;power--;}
    return new Decimal(negative?-mantissa:mantissa,power);
  }
  get isZero(){return this.mantissa===0n;}
  get isNegative(){return this.mantissa<0n;}
  negate(){return new Decimal(-this.mantissa,this.scale);}
  abs(){return this.mantissa<0n?this.negate():this;}
  add(other){const scale=Math.max(this.scale,other.scale),sum=this.mantissa*pow10(scale-this.scale)+other.mantissa*pow10(scale-other.scale);return fitDecimal(sum<0n,abs(sum),scale);}
  subtract(other){return this.add(other.negate());}
  multiply(other){const product=this.mantissa*other.mantissa;return fitDecimal(product<0n,abs(product),this.scale+other.scale);}
  /** Quotient with the smallest exact scale not below the operands' scale difference, else rounded to the 96-bit limit. The divisor must be non-zero. */
  divide(other){
    if(other.isZero)throw new RangeError('Division by zero');
    const negative=(this.mantissa<0n)!==(other.mantissa<0n),n=abs(this.mantissa),d=abs(other.mantissa),preferred=this.scale-other.scale,least=Math.max(0,preferred);
    const scaled=scale=>scale>=preferred?[n*pow10(scale-preferred),d]:[n,d*pow10(preferred-scale)];
    for(let scale=least;scale<=MAX_SCALE;scale++){const [x,y]=scaled(scale);if(x%y===0n){if(x/y<=MAX96)return new Decimal(negative?-(x/y):x/y,scale);break;}}
    for(let scale=MAX_SCALE;scale>=0;scale--){
      const [x,y]=scaled(scale);let q=roundDiv(x,y);if(q>MAX96)continue;
      while(scale>0&&q%10n===0n){q/=10n;scale--;}
      return new Decimal(negative?-q:q,scale);
    }
    return null;
  }
  /** Remainder with the sign of the dividend. The divisor must be non-zero. */
  remainder(other){
    if(other.isZero)throw new RangeError('Division by zero');
    if(this.abs().compare(other.abs())<0)return this;
    const scale=Math.max(this.scale,other.scale);
    return new Decimal((this.mantissa*pow10(scale-this.scale))%(other.mantissa*pow10(scale-other.scale)),scale);
  }
  compare(other){const scale=Math.max(this.scale,other.scale),a=this.mantissa*pow10(scale-this.scale),b=other.mantissa*pow10(scale-other.scale);return a<b?-1:a>b?1:0;}
  /** Integral part (truncation towards zero) as a BigInt. */
  truncate(){return this.mantissa/pow10(this.scale);}
  /** (double)decimal as System.Decimal computes it. */
  toDouble(){const m=abs(this.mantissa),value=(Number(m&MASK64)+Number(m>>64n)*18446744073709551616)/Number('1e'+this.scale);return this.mantissa<0n?-value:value;}
  /** The System.Decimal.GetBits words [lo, mid, hi, flags] as signed 32-bit integers. */
  toBits(){const m=abs(this.mantissa),word=shift=>Number(BigInt.asIntN(32,m>>shift));return [word(0n),word(32n),word(64n),(this.scale<<16)|(this.mantissa<0n?-2147483648:0)];}
  /** Invariant text with exactly `scale` fraction digits, as System.Decimal.ToString prints it. */
  toString(){const digits=abs(this.mantissa).toString().padStart(this.scale+1,'0'),cut=digits.length-this.scale;return (this.mantissa<0n?'-':'')+digits.slice(0,cut)+(this.scale?'.'+digits.slice(cut):'');}
}

/** Nearest float to a BigInt (round half to even), without the double rounding of Math.fround(Number(value)). */
export function bigIntToFloat(value){
  const negative=value<0n;let m=abs(value);const bits=m.toString(2).length;
  if(bits>24){const shift=BigInt(bits-24),half=1n<<(shift-1n),rest=m&((1n<<shift)-1n);m>>=shift;if(rest>half||rest===half&&(m&1n)===1n)m++;m<<=shift;}
  const result=Math.fround(Number(m));return negative?-result:result;
}
/** Sign of (decimal literal text) - (finite double x), computed exactly. */
function compareTextToDouble(text,x){
  const m=/^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text),digits=BigInt((m[1]||'')+(m[2]||'')||'0'),e10=Number(m[3]??0)-(m[2]??'').length;
  float64[0]=x;const raw=int64[0],biased=Number((raw>>52n)&0x7ffn),fraction=raw&((1n<<52n)-1n),mantissa=biased?fraction|(1n<<52n):fraction,e2=(biased||1)-1075;
  let a=digits,b=mantissa;if(e10>=0)a*=pow10(e10);else b*=pow10(-e10);if(e2>=0)b<<=BigInt(e2);else a<<=BigInt(-e2);
  return a<b?-1:a>b?1:0;
}
/** Correctly rounded float for the digits of a real literal (Math.fround(Number(text)) alone can round twice). */
function parseFloat32(text){
  const d=Number(text),f=Math.fround(d);if(!Number.isFinite(d)||d===f)return f;
  // g is the float on the other side of d; when d is exactly their midpoint the digits decide, not the tie rule.
  let g;if(f===0)g=d>0?1.401298464324817e-45:-1.401298464324817e-45;else{float32[0]=f;int32[0]+=Math.abs(d)>Math.abs(f)?1:-1;g=float32[0];}
  if(Number.isFinite(g)&&(f+g)/2===d){const side=compareTextToDouble(text,d);if(side!==0)return side>0===(g>f)?g:f;}
  return f;
}

/** Text of a float/double as .NET's shortest round-trip formatting prints it (invariant culture). */
export function formatFloatingPoint(value,single=false){
  if(Number.isNaN(value))return 'NaN';
  if(!Number.isFinite(value))return value<0?'-Infinity':'Infinity';
  if(value===0)return Object.is(value,-0)?'-0':'0';
  let text=Math.abs(value).toExponential();
  if(single)for(let p=0;p<9;p++){text=Math.abs(value).toExponential(p);if(Math.fround(Number(text))===Math.abs(value))break;}
  const [mantissa,exponent]=text.split('e');let digits=mantissa.replace('.','').replace(/0+$/,'')||'0';const scale=Number(exponent)+1,sign=value<0?'-':'';
  if(scale>Math.max(digits.length,single?7:15)||scale<-3){const e=scale-1;return sign+digits[0]+(digits.length>1?'.'+digits.slice(1):'')+'E'+(e<0?'-':'+')+String(Math.abs(e)).padStart(2,'0');}
  if(scale<=0)return sign+'0.'+'0'.repeat(-scale)+digits;
  if(scale>=digits.length)return sign+digits+'0'.repeat(scale-digits.length);
  return sign+digits.slice(0,scale)+'.'+digits.slice(scale);
}

/** The primitive name of an enum type's underlying type. Accepts `{name,underlyingType:'byte'}` records and enum type symbols. */
export function enumUnderlyingType(enumType){
  if(typeof enumType?.underlyingType==='string')return enumType.underlyingType;
  const underlying=enumType?.enumUnderlyingTypeSymbol??enumType?.enumUnderlyingType??null;
  return specialTypeNames[underlying?.specialType]??(isIntegralType(underlying?.name)?underlying.name:'int');
}
/** Display name of an enum type (record name or symbol display string). */
export function enumTypeName(enumType){return typeof enumType==='string'?enumType:typeof enumType?.toDisplayString==='function'?enumType.toDisplayString():String(enumType?.name);}

/** An immutable typed constant. Construct through the static factories; they validate and normalise the value. */
export class ConstantValue{
  /** @param type primitive discriminator (or a reference type name for a typed null) @param value see the module header @param enumType enum type record/symbol or null */
  constructor(type,value,enumType=null){this.type=type;this.value=value;this.enumType=enumType;Object.freeze(this);}
  /** An integral or char constant from a number, BigInt or decimal string; throws RangeError when out of range. */
  static integral(type,value,enumType=null){
    const range=integralRanges[type];if(!range)throw new RangeError(`'${type}' is not an integral type`);
    const big=typeof value==='bigint'?value:BigInt(value);if(big<range[0]||big>range[1])throw new RangeError(`${big} is outside the range of '${type}'`);
    return new ConstantValue(type,type==='long'||type==='ulong'?big:Number(big),enumType);
  }
  static sbyte(v){return ConstantValue.integral('sbyte',v);} static byte(v){return ConstantValue.integral('byte',v);}
  static short(v){return ConstantValue.integral('short',v);} static ushort(v){return ConstantValue.integral('ushort',v);}
  static int(v){return ConstantValue.integral('int',v);} static uint(v){return ConstantValue.integral('uint',v);}
  static long(v){return ConstantValue.integral('long',v);} static ulong(v){return ConstantValue.integral('ulong',v);}
  /** A char constant from a one-unit string or a UTF-16 code unit. */
  static char(v){return ConstantValue.integral('char',typeof v==='string'?v.charCodeAt(0):v);}
  static float(v){return new ConstantValue('float',Math.fround(Number(v)));}
  static double(v){return new ConstantValue('double',Number(v));}
  /** A decimal constant from a `Decimal`, a BigInt/integer, or literal digits; throws RangeError when unrepresentable. */
  static decimal(v){const d=v instanceof Decimal?v:typeof v==='bigint'?Decimal.fromBigInt(v):Decimal.parse(String(v));if(!d)throw new RangeError(`${v} is outside the range of 'decimal'`);return new ConstantValue('decimal',d);}
  static bool(v){return new ConstantValue('bool',!!v);}
  static string(v){return new ConstantValue('string',v===null||v===undefined?null:String(v));}
  /** The untyped `null` literal, or a null reference of the named reference type. */
  static null(type='null'){return new ConstantValue(type,null);}
  /** An enum constant: `value` is in the enum's underlying type. */
  static enum(enumType,value){return ConstantValue.integral(enumUnderlyingType(enumType),value,enumType);}
  /** Generic factory by discriminator. */
  static of(type,value,enumType=null){
    if(enumType)return ConstantValue.integral(type,value,enumType);
    if(isIntegralType(type))return type==='char'?ConstantValue.char(value):ConstantValue.integral(type,value);
    if(value===null||value===undefined)return ConstantValue.null(type);
    if(type==='float'||type==='double'||type==='decimal'||type==='bool'||type==='string')return ConstantValue[type](value);
    throw new RangeError(`'${type}' cannot hold a non-null constant`);
  }
  get isEnum(){return this.enumType!==null;}
  get isNull(){return this.value===null;}
  get isIntegral(){return isIntegralType(this.type);}
  get isFloatingPoint(){return this.type==='float'||this.type==='double';}
  get isNumeric(){return this.isIntegral||this.isFloatingPoint||this.type==='decimal';}
  /** The integral value as a BigInt (integral and char constants only). */
  get bigint(){return typeof this.value==='bigint'?this.value:BigInt(this.value);}
  /** Type name for messages: the enum's name for an enum constant, the discriminator otherwise. */
  get typeName(){return this.enumType?enumTypeName(this.enumType):this.type;}
  /** Value text as Roslyn prints it inside CS0221/CS0031 messages. */
  get displayValue(){
    if(this.value===null)return 'null';
    switch(this.type){
      case 'char':return String.fromCharCode(this.value);
      case 'float':return formatFloatingPoint(this.value,true);
      case 'double':return formatFloatingPoint(this.value,false);
      case 'decimal':return this.value.toString()+'M';
      case 'bool':return this.value?'True':'False';
      default:return String(this.value);
    }
  }
  /** Structural equality: same type, same enum type and identical value (NaN equals NaN, 1.0m differs from 1.00m). */
  equals(other){
    if(!(other instanceof ConstantValue)||other.type!==this.type||(this.enumType===null)!==(other.enumType===null)||this.enumType!==null&&!sameEnumType(this.enumType,other.enumType))return false;
    if(this.type==='decimal'&&this.value&&other.value)return this.value.mantissa===other.value.mantissa&&this.value.scale===other.value.scale;
    return Object.is(this.value,other.value);
  }
  toString(){return `${this.typeName}(${this.value===null?'null':this.type==='string'?JSON.stringify(this.value):this.type==='char'?JSON.stringify(String.fromCharCode(this.value)):this.type==='decimal'?this.value.toString():String(this.value)})`;}
}
/** True when two enum type references denote the same enum (identity, or equal names for plain records). */
export function sameEnumType(a,b){return a===b||!!a&&!!b&&typeof a.toDisplayString!=='function'&&typeof b.toDisplayString!=='function'&&enumTypeName(a)===enumTypeName(b);}

/**
 * Types a C# numeric literal token (`0x7F`, `1_000UL`, `1.5f`, `2m`, ...) per the language rules: an unsuffixed integer
 * is the first of int, uint, long, ulong that holds it, `U` picks uint/ulong, `L` long/ulong, `UL` ulong; a real literal
 * is double unless suffixed f, d or m. Returns null for text that is not a numeric literal.
 * Failures: CS1021 (integral constant too large), CS0594 (floating-point constant outside its type).
 */
export function literalConstant(text){
  const raw=String(text).replaceAll('_','');let m;
  if((m=/^(0[xX][\da-fA-F]+|0[bB][01]+|\d+)([uU][lL]?|[lL][uU]?)?$/.exec(raw))){
    const suffix=(m[2]??'').toLowerCase(),value=BigInt(m[1]);
    if(value>integralRanges.ulong[1])return foldError(DiagnosticId.CS1021);
    const candidates=suffix===''?['int','uint','long','ulong']:suffix==='u'?['uint','ulong']:suffix==='l'?['long','ulong']:['ulong'];
    return ConstantValue.integral(candidates.find(t=>value<=integralRanges[t][1]),value);
  }
  if((m=/^((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([fFdDmM])?$/.exec(raw))){
    const suffix=(m[2]??'d').toLowerCase();
    if(suffix==='m'){const d=Decimal.parse(m[1]);return d?new ConstantValue('decimal',d):foldError(DiagnosticId.CS0594,['decimal']);}
    const value=suffix==='f'?parseFloat32(m[1]):Number(m[1]);
    return Number.isFinite(value)?new ConstantValue(suffix==='f'?'float':'double',value):foldError(DiagnosticId.CS0594,[suffix==='f'?'float':'double']);
  }
  return null;
}
/**
 * The special case of an integer literal that is the direct operand of a unary minus: an unsuffixed literal with value
 * 2147483648 (`-2147483648`, `-0x80000000`) is int.MinValue and a literal with value 9223372036854775808, unsuffixed or
 * suffixed L, is long.MinValue, although the bare literals are uint and ulong. Parentheses defeat the rule.
 * Returns that constant, or null when the rule does not apply and the minus must be folded with `foldUnary`.
 */
export function negatedLiteralConstant(text){
  const m=/^(0[xX][\da-fA-F]+|0[bB][01]+|\d+)([lL])?$/.exec(String(text).replaceAll('_',''));if(!m)return null;
  if(!m[2]&&BigInt(m[1])===2147483648n)return ConstantValue.int(-2147483648n);
  return BigInt(m[1])===1n<<63n?ConstantValue.long(-(1n<<63n)):null;
}
