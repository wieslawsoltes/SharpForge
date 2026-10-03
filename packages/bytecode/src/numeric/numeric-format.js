import {numericTypeName,integerType} from './numeric-types.js';
import {number,isNativeInteger} from './numeric-ops.js';
import {isDecimal,decimalFormat} from './decimal-ops.js';

const failure=(context,message)=>{throw (context?.fault??((name,text)=>Object.assign(new Error(text),{name})))('FormatException',message);};
const powers=[1n];
const power=n=>{for(let i=powers.length;i<=n;i++)powers.push(powers[i-1]*10n);return powers[n];};
const round=(n,d,away=false)=>{const q=n/d,r=n%d;return r*2n>d||r*2n===d&&(away||(q&1n)!==0n)?q+1n:q;};
function rational(value) {
  const view=new DataView(new ArrayBuffer(8));view.setFloat64(0,Math.abs(value),false);
  const bits=view.getBigUint64(0,false),exponent=Number(bits>>52n&2047n),fraction=bits&((1n<<52n)-1n);
  const significand=exponent?fraction+(1n<<52n):fraction,shift=(exponent?exponent-1023:-1022)-52;
  return shift>=0?{n:significand<<BigInt(shift),d:1n}:{n:significand,d:1n<<BigInt(-shift)};
}
function exponentOf(n,d) {
  if(n===0n)return 0;
  let exponent=n.toString().length-d.toString().length;
  const atLeast=e=>e>=0?n>=d*power(e):n*power(-e)>=d;
  while(!atLeast(exponent))exponent--;while(atLeast(exponent+1))exponent++;
  return exponent;
}
const places=(n,d,scale,away=false)=>({coefficient:scale>=0?round(n*power(scale),d,away):round(n,d*power(-scale),away),scale});
const significant=(n,d,digits,away=false)=>places(n,d,digits-1-exponentOf(n,d),away);
function trim(value){let {coefficient,scale}=value;if(coefficient===0n)return {coefficient,scale:0};while(coefficient%10n===0n){coefficient/=10n;scale--;}return {coefficient,scale};}
function fixed({coefficient,scale}) {
  let digits=coefficient.toString();if(scale<=0)return digits+'0'.repeat(-scale);
  digits=digits.padStart(scale+1,'0');return digits.slice(0,-scale)+'.'+digits.slice(-scale);
}
function exponential(value,letter,minimum=2,fractionDigits=null) {
  const text=value.coefficient.toString(),exponent=value.coefficient===0n?0:text.length-value.scale-1;
  let fraction=text.slice(1);if(fractionDigits!==null)fraction=fraction.padEnd(fractionDigits,'0').slice(0,fractionDigits);
  return text[0]+(fraction?'.'+fraction:'')+letter+(exponent<0?'-':'+')+String(Math.abs(exponent)).padStart(minimum,'0');
}
function shortest(value,type,n,d) {
  const maximum=type==='float'?9:17;
  for(let digits=1;digits<=maximum;digits++) {
    const candidate=significant(n,d,digits),parsed=Number(candidate.coefficient.toString()+'e'+(-candidate.scale));
    if((type==='float'?Math.fround(parsed):parsed)===Math.abs(value))return trim(candidate);
  }
  return trim(significant(n,d,maximum));
}
const grouped=text=>{const [whole,fraction]=text.split('.');return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction===undefined?'':'.'+fraction);};

/** Invariant .NET numeric text; binary rounding uses exact rational arithmetic.
 * Standard formats are bounded to the existing browser profile's 99 digits. */
export function numericFormat(value,type,format='G',context={}) {
  if(isNativeInteger(value)&&context.nativeIntBits===undefined)context={...context,nativeIntBits:value.nativeInt};
  type=numericTypeName(type);if(type&&!integerType(type,context)&&!['float','double','decimal'].includes(type))type=undefined;
  type=numericTypeName(type??(isDecimal(value)?'decimal':value?.float==='r4'?'float':value?.float?'double':isNativeInteger(value)?'nint':typeof value==='bigint'?'long':'int'));
  if(type==='decimal'||isDecimal(value))return decimalFormat(value,format||'G',context);
  const raw=number(value);
  if(type==='bool')return raw?'True':'False';
  if(type==='char')return String.fromCharCode(Number(raw)&65535);
  if((type==='float'||type==='double')&&!Number.isFinite(Number(raw)))return String(Number(raw));
  const match=/^([dDxXbBfFnNeEgGpPrR])(\d{0,2})$/.exec(format||'G');if(!match)failure(context,'Unsupported numeric format '+format);
  const code=match[1].toUpperCase(),precision=match[2]===''?null:Number(match[2]),integer=integerType(type,context),floating=type==='float'||type==='double';
  if(!integer&&!floating)failure(context,'Numeric format requires a numeric type');
  let n,d,negative;
  if(integer) {
    const actual=integer.unsigned?BigInt.asUintN(integer.bits,BigInt(raw)):BigInt.asIntN(integer.bits,BigInt(raw));
    negative=actual<0n;n=negative?-actual:actual;d=1n;
    if(code==='D')return (negative?'-':'')+n.toString().padStart(precision??1,'0');
    if(code==='X'||code==='B'){let digits=BigInt.asUintN(integer.bits,actual).toString(code==='X'?16:2).padStart(precision??1,'0');return match[1]===match[1].toUpperCase()?digits.toUpperCase():digits;}
    if(code==='R')failure(context,'Round-trip format requires a floating-point type');
  } else {
    if(['D','X','B'].includes(code))failure(context,'Integer format requires an integer type');
    const actual=type==='float'?Math.fround(Number(raw)):Number(raw);
    if(!Number.isFinite(actual))return String(actual);
    negative=actual<0||Object.is(actual,-0);({n,d}=rational(actual));
  }
  let text;
  if(code==='G'||code==='R') {
    if(integer&&!precision)text=n.toString();
    else {
      const rounded=precision&&code!=='R'?trim(significant(n,d,precision,!!integer)):shortest(type==='float'?Math.fround(Number(raw)):Number(raw),type,n,d);
      const exponent=rounded.coefficient===0n?0:rounded.coefficient.toString().length-rounded.scale-1,limit=precision&&code!=='R'?precision:type==='float'?9:17;
      text=exponent< -4||exponent>=limit?exponential(rounded,match[1]===match[1].toLowerCase()?'e':'E'):fixed(rounded);
    }
  } else if(code==='E')text=exponential(significant(n,d,(precision??6)+1,!!integer),match[1]==='e'?'e':'E',3,precision??6);
  else {
    text=fixed(places(code==='P'?n*100n:n,d,precision??2,!!integer));
    if(code==='N'||code==='P')text=grouped(text);if(code==='P')text+=' %';
  }
  return (negative?'-':'')+text;
}
