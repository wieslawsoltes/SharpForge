/** Immutable System.Decimal values. Arithmetic never passes through binary64. */
export const decimalMaxCoefficient=(1n<<96n)-1n;
const powers=Array.from({length:113},(_,i)=>10n**BigInt(i));
const power=n=>powers[n]??10n**BigInt(n);
const fault=(type,message)=>Object.assign(new Error(message),{name:type});
const fail=(context,type,message)=>{throw (context?.fault??fault)(type,message);};
export const isDecimal=value=>value?.decimal===true&&typeof value.coefficient==='bigint'&&value.coefficient>=0n&&value.coefficient<=decimalMaxCoefficient&&Number.isInteger(value.scale)&&value.scale>=0&&value.scale<=28&&typeof value.negative==='boolean';
export function decimal(coefficient=0n,scale=0,negative=false,context) {
  if(typeof coefficient!=='bigint'||coefficient<0n||coefficient>decimalMaxCoefficient||!Number.isInteger(scale)||scale<0||scale>28||typeof negative!=='boolean')fail(context,'ArgumentException','Invalid Decimal coefficient, scale or sign');
  return Object.freeze({decimal:true,coefficient,scale,negative});
}
export const decimalZero=decimal();
function requireDecimal(value,context) {
  if(!isDecimal(value)||value.coefficient<0n||value.coefficient>decimalMaxCoefficient||!Number.isInteger(value.scale)||value.scale<0||value.scale>28||typeof value.negative!=='boolean')fail(context,'InvalidProgramException','Decimal value required');
  return value;
}
function roundedDivision(n,d,mode=0,negative=false) {
  let q=n/d;const remainder=n%d;
  if(remainder===0n)return q;
  if(mode===0?remainder*2n>d||remainder*2n===d&&(q&1n)!==0n:mode===1?remainder*2n>=d:mode===3?negative:mode===4?!negative:false)q++;
  return q;
}
function fit(coefficient,scale,negative,context) {
  if(scale<0){coefficient*=power(-scale);scale=0;}
  for(let drop=Math.max(0,scale-28);drop<=scale;drop++) {
    const result=roundedDivision(coefficient,power(drop));
    if(result<=decimalMaxCoefficient)return decimal(result,scale-drop,negative,context);
  }
  fail(context,'OverflowException','Decimal arithmetic overflow');
}
export function decimalFromBits(bits,context) {
  if(!Array.isArray(bits)||bits.length!==4||bits.some(value=>!Number.isInteger(value)||value< -2147483648||value>4294967295))fail(context,'ArgumentException','Decimal bits require four Int32 words');
  const [lo,mid,hi,rawFlags]=bits,flags=rawFlags>>>0,scale=(flags>>>16)&255;
  if((flags&0x7f00ffff)!==0||scale>28)fail(context,'ArgumentException','Invalid Decimal flags');
  return decimal(BigInt(lo>>>0)|(BigInt(mid>>>0)<<32n)|(BigInt(hi>>>0)<<64n),scale,!!(flags&0x80000000),context);
}
export function decimalBits(value,context) {
  requireDecimal(value,context);const n=value.coefficient;
  return [Number(BigInt.asIntN(32,n)),Number(BigInt.asIntN(32,n>>32n)),Number(BigInt.asIntN(32,n>>64n)),(value.scale<<16)|(value.negative?0x80000000:0)];
}
export function decimalParse(input,context={}) {
  if(typeof input!=='string')fail(context,input===null?'ArgumentNullException':'FormatException','Decimal text is required');
  if(input.length>4096)fail(context,'FormatException','Decimal text is too long');
  let text=input.trim();
  if(context.allowTrailingSign&&/[+-]$/.test(text))text=text.at(-1)+text.slice(0,-1).trimEnd();
  if(context.allowThousands){if(/^[+-]?,/.test(text))fail(context,'FormatException','Invalid Decimal grouping');text=text.replace(/^([+-]?)(\d[\d,]*)(?=\.|$|[eE])/,(whole,sign,integer)=>sign+integer.replaceAll(',',''));}
  const match=/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
  if(!match||context.allowExponent===false&&match[5]!==undefined)fail(context,'FormatException','Invalid Decimal text');
  const fraction=match[3]??match[4]??'',digits=(match[2]??'0')+fraction,exponent=Number(match[5]??0);
  if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>4096)fail(context,'OverflowException','Decimal exponent is out of range');
  const coefficient=BigInt(digits),scale=fraction.length-exponent;
  if(coefficient===0n)return decimal(0n,Math.max(0,Math.min(28,scale)),match[1]==='-',context);
  if(scale>digits.length+28)return decimal(0n,28,match[1]==='-',context);
  if(scale< -29)fail(context,'OverflowException','Decimal text overflows');
  return fit(coefficient,scale,match[1]==='-',context);
}
export function decimalFromInteger(input,unsigned=false,bits=64,context) {
  let value=BigInt(input);if(unsigned)value=BigInt.asUintN(bits,value);
  return fit(value<0n?-value:value,0,value<0n,context);
}
/** .NET 10 floating constructors round R4/R8 inputs to 7/15 significant digits. */
export function decimalFromFloat(input,kind='r8',context) {
  let value=kind==='r4'?Math.fround(input):Number(input);
  if(!Number.isFinite(value))fail(context,'OverflowException','Non-finite Decimal conversion');
  if(value===0)return decimalZero;
  const negative=value<0;value=Math.abs(value);
  const bits=new DataView(new ArrayBuffer(8));bits.setFloat64(0,value,false);
  const exponent=((bits.getUint32(0,false)>>>20)&2047)-1022;
  if(exponent< -94)return decimalZero;
  if(exponent>96)fail(context,'OverflowException','Decimal conversion overflow');
  const digits=kind==='r4'?7:15;
  let scale=(digits-1)-((exponent*19728)>>16),scaled=value;
  if(scale>=0){scale=Math.min(scale,28);scaled*=10**scale;}
  else if(scale!==-1||scaled>=10**digits)scaled/=10**(-scale);else scale=0;
  if(scaled<10**(digits-1)&&scale<28){scaled*=10;scale++;}
  const floor=Math.floor(scaled),fraction=scaled-floor;
  let coefficient=BigInt(floor+(fraction>0.5||fraction===0.5&&floor%2!==0?1:0));
  if(coefficient===0n)return decimalZero;
  if(scale<0){coefficient*=power(-scale);scale=0;}
  while(scale>0&&coefficient%10n===0n){coefficient/=10n;scale--;}
  return fit(coefficient,scale,negative,context);
}
export function decimalToInteger(value,{bits=64,unsigned=false,...context}={}) {
  requireDecimal(value,context);let n=value.coefficient/power(value.scale);if(value.negative)n=-n;
  const min=unsigned?0n:-(1n<<BigInt(bits-1)),max=(1n<<BigInt(unsigned?bits:bits-1))-1n;
  if(n<min||n>max)fail(context,'OverflowException','Decimal integer conversion overflow');
  return bits<=32?Number(n):n;
}
export function decimalToFloat(value,kind='r8',context) {
  requireDecimal(value,context);
  // Match .NET's two-limb Decimal -> Double conversion and its signed zero.
  const n=value.coefficient,number=(Number(BigInt.asUintN(64,n))+Number(n>>64n)*2**64)/(10**value.scale);
  const signed=value.negative?-number:number;
  return kind==='r4'?Math.fround(signed):signed;
}
export function decimalCompare(left,right,context) {
  requireDecimal(left,context);requireDecimal(right,context);
  const scale=Math.max(left.scale,right.scale);
  let a=left.coefficient*power(scale-left.scale),b=right.coefficient*power(scale-right.scale);
  if(left.negative)a=-a;if(right.negative)b=-b;
  return a<b?-1:a>b?1:0;
}
export function decimalNegate(value,context) {requireDecimal(value,context);return decimal(value.coefficient,value.scale,!value.negative,context);}
export function decimalAbs(value,context) {requireDecimal(value,context);return value.negative?decimal(value.coefficient,value.scale,false,context):value;}
export function decimalAdd(left,right,subtract=false,context) {
  requireDecimal(left,context);requireDecimal(right,context);
  const scale=Math.max(left.scale,right.scale),rightNegative=right.negative!==subtract;
  let a=left.coefficient*power(scale-left.scale),b=right.coefficient*power(scale-right.scale);
  if(left.negative)a=-a;if(rightNegative)b=-b;
  const sum=a+b;
  const zeroNegative=left.scale<=right.scale?left.negative:rightNegative;
  return fit(sum<0n?-sum:sum,scale,sum<0n||sum===0n&&zeroNegative,context);
}
export function decimalMultiply(left,right,context) {
  requireDecimal(left,context);requireDecimal(right,context);
  if(left.coefficient<=0xffffffffn&&right.coefficient<=0xffffffffn&&left.scale+right.scale>47)return decimalZero;
  if((left.coefficient===0n||right.coefficient===0n)&&(left.coefficient>0xffffffffn||right.coefficient>0xffffffffn))return decimalZero;
  return fit(left.coefficient*right.coefficient,left.scale+right.scale,left.negative!==right.negative,context);
}
export function decimalDivide(left,right,context) {
  requireDecimal(left,context);requireDecimal(right,context);
  if(right.coefficient===0n)fail(context,'DivideByZeroException','Attempted to divide by zero');
  const negative=left.negative!==right.negative,n=left.coefficient*power(right.scale),d=right.coefficient*power(left.scale),start=Math.max(0,left.scale-right.scale);
  let scale=start,q=0n,remainder=0n,unscale=left.coefficient%right.coefficient!==0n;
  for(;scale<=28;scale++) {
    const scaled=n*power(scale),next=scaled/d,rem=scaled%d;
    if(next>decimalMaxCoefficient){scale--;break;}
    q=next;remainder=rem;
    if(rem===0n||scale===28)break;
  }
  if(scale<start)fail(context,'OverflowException','Decimal division overflow');
  if(remainder!==0n)q=roundedDivision(n*power(scale),d);
  if(q>decimalMaxCoefficient) {
    if(scale===0)fail(context,'OverflowException','Decimal division overflow');
    q=roundedDivision(n*power(--scale),d);
  }
  if(unscale)while(scale>0&&q%10n===0n){q/=10n;scale--;}
  return decimal(q,scale,negative,context);
}
export function decimalRemainder(left,right,context) {
  requireDecimal(left,context);requireDecimal(right,context);
  if(right.coefficient===0n)fail(context,'DivideByZeroException','Attempted to divide by zero');
  if(left.coefficient===0n)return left;
  if(decimalCompare(decimalAbs(left),decimalAbs(right))<0)return left;
  const scale=Math.max(left.scale,right.scale),a=left.coefficient*power(scale-left.scale),b=right.coefficient*power(scale-right.scale);
  return fit(a%b,scale,left.negative,context);
}
/** MidpointRounding: ToEven=0, AwayFromZero=1, ToZero=2, -Infinity=3, +Infinity=4. */
export function decimalRound(value,digits=0,mode=0,context) {
  requireDecimal(value,context);
  if(!Number.isInteger(digits)||digits<0||digits>28)fail(context,'ArgumentOutOfRangeException','Decimal digits must be between zero and 28');
  if(!Number.isInteger(mode)||mode<0||mode>4)fail(context,'ArgumentException','Invalid midpoint rounding mode');
  if(digits>=value.scale)return value;
  return decimal(roundedDivision(value.coefficient,power(value.scale-digits),mode,value.negative),digits,value.negative,context);
}
export function decimalFormat(value,format='G',context) {
  requireDecimal(value,context);format=format??'G';
  const match=/^([gGfFnNeEpP])(\d{0,2})$/.exec(format||'G');
  if(!match)fail(context,'FormatException','Unsupported Decimal format');
  const code=match[1].toUpperCase(),digits=match[2]===''?null:Number(match[2]),generalDigits=digits===0?Math.max(1,value.coefficient.toString().length):digits;
  let coefficient=value.coefficient,scale=value.scale;
  // CoreLib numeric text rounds Decimal midpoint digits away from zero;
  // Decimal arithmetic and Decimal.Round retain their independent rounding modes.
  const roundTo=places=>{if(scale>places){coefficient=roundedDivision(coefficient,power(scale-places),1);scale=places;}if(scale<0){coefficient*=power(-scale);scale=0;}};
  const trim=()=>{while(scale>0&&coefficient%10n===0n){coefficient/=10n;scale--;}};
  const exponent=()=>coefficient===0n?0:coefficient.toString().length-scale-1;
  const scientific=(precision,exponentDigits,trimZeros)=>{
    roundTo(precision-exponent());
    const exp=exponent();let text=coefficient.toString().padEnd(precision+1,'0').slice(0,precision+1);
    let fraction=text.slice(1);if(trimZeros)fraction=fraction.replace(/0+$/,'');
    return text[0]+(fraction?'.'+fraction:'')+(match[1]===match[1].toLowerCase()?'e':'E')+(exp<0?'-':'+')+String(Math.abs(exp)).padStart(exponentDigits,'0');
  };
  let text;
  if(code==='E')text=scientific(digits??6,3,false);
  else {
    if(code==='P'){scale-=2;if(scale<0){coefficient*=power(-scale);scale=0;}}
    if(code==='G'&&generalDigits){roundTo(generalDigits-1-exponent());trim();}
    if(code==='G'&&generalDigits&&(exponent()< -4||exponent()>=generalDigits))text=scientific(generalDigits-1,2,true);
    else {
      const places=code==='G'?scale:digits??2;roundTo(places);
      text=coefficient.toString()+'0'.repeat(Math.max(0,places-scale));
      if(places>0){text=text.padStart(places+1,'0');text=text.slice(0,-places)+'.'+text.slice(-places);}
      if(code==='N'||code==='P'){const [whole,fraction]=text.split('.');text=whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction===undefined?'':'.'+fraction);}
      if(code==='P')text+=' %';
    }
  }
  return (value.negative&&coefficient!==0n?'-':'')+text;
}
export function decimalBinary(operator,left,right,context) {
  if(['==','!=','<','<=','>','>='].includes(operator)){const order=decimalCompare(left,right,context);return operator==='=='?order===0:operator==='!='?order!==0:operator==='<'?order<0:operator==='<='?order<=0:operator==='>'?order>0:order>=0;}
  switch(operator){case '+':case 'add':return decimalAdd(left,right,false,context);case '-':case 'sub':return decimalAdd(left,right,true,context);case '*':case 'mul':return decimalMultiply(left,right,context);case '/':case 'div':return decimalDivide(left,right,context);case '%':case 'rem':return decimalRemainder(left,right,context);default:fail(context,'InvalidProgramException','Invalid Decimal operation');}
}
