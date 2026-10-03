import {decimalParse,decimalBinary,decimalRound,decimalFromFloat,decimalBits} from '../packages/runtime/src/execution/decimal-ops.js';

export const decimalCases=[
  ['+','0.1','0.2','0.3'],['+','1.20','1.3','2.50'],['-','10000000000000000000000000000','1','9999999999999999999999999999'],
  ['*','1.20','2','2.40'],['*','-2.5','4.0','-10.00'],['/','1','3','0.3333333333333333333333333333'],
  ['/','1','6','0.1666666666666666666666666667'],['/','1','8','0.125'],['/','1.00','2','0.50'],['/','10','4','2.5'],
  ['%','1.00','0.30','0.10'],['%','-7.5','2','-1.5'],['%','7.5','-2','1.5'],
  ['+','79228162514264337593543950335','0.4','79228162514264337593543950335'],
  ['*','0.0000000000000000000000000001','0.1','0.0000000000000000000000000000'],
  ['*','0.0000000000000000000000000001','0.0000000000000000000000000001','0'],
  ['/','79228162514264337593543950335','10','7922816251426433759354395033.5'],
  ['+','-1.00','1','0.00'],['-','1','1.00','0.00'],['/','-0.000','2','0.000'],
];
export const decimalRoundingCases=[['1.245',2,0],['1.255',2,0],['-1.245',2,0],['1.245',2,1],['-1.241',2,2],['-1.241',2,3],['1.241',2,4]];
export const decimalFloatCases=[['r8',0.1],['r4',0.1],['r8',1.2345678901234567],['r4',1.23456789],['r8',-0],['r8',1e-29],['r8',1e28]];

export const sourceScalarCases=[
  {name:'object storage preserves scalar box identity',source:'uint u=4294967295U;ulong wide=18446744073709551615UL;object a=u;object b=wide;object c=12.3000M;object d=0.1F;GC.Collect();Console.WriteLine($"{a}:{b}:{c}:{d}");Console.WriteLine(a.GetType().Name);Console.WriteLine(b.GetType().Name);Console.WriteLine(c.GetType().Name);Console.WriteLine(d.GetType().Name);',output:'4294967295:18446744073709551615:12.3000:0.1\nUInt32\nUInt64\nDecimal\nSingle\n'},
  {name:'typed scalar interpolation',source:'uint u=4294967295U;ulong wide=18446744073709551615UL;nint signed=(nint)(-7);nuint native=(nuint)9;float single=0.1F;decimal money=12.3000M;Console.WriteLine($"{u}:{wide}:{signed}:{native}:{single}:{money}");Console.WriteLine($"{wide:X16}:{money:F2}:{single:G9}:{-0.0:F2}");',output:'4294967295:18446744073709551615:-7:9:0.1:12.3000\nFFFFFFFFFFFFFFFF:12.30:0.100000001:-0.00\n'},
  {name:'composite formatting boxes exact scalar types',source:'uint u=4294967295U;ulong wide=18446744073709551615UL;decimal money=1.245M;float single=0.1F;Console.WriteLine(string.Format("{0}:{1:X16}:{2:F2}:{3}",u,wide,money,single));var values=new System.Collections.Generic.List<object>();values.Add(wide);values.Add(money);values.Add(single);GC.Collect();Console.WriteLine(values[0].GetType().Name);Console.WriteLine(values[0]);Console.WriteLine(values[1]);Console.WriteLine(values[2]);',output:'4294967295:FFFFFFFFFFFFFFFF:1.25:0.1\nUInt64\n18446744073709551615\n1.245\n0.1\n'},
  {name:'numeric text distinguishes integer Decimal and binary ties',source:'Console.WriteLine(string.Format("{0:E0}:{1:F2}:{2:F0}",25,1.245M,2.5));Console.WriteLine(string.Format("{0:G0}:{1:P1}",1.2300M,0.0125M));',output:'3E+001:1.25:2\n1.23:1.3 %\n'},
  {name:'floating general formatting widths and exponents',source:'Console.WriteLine(0.1F);Console.WriteLine(float.Epsilon);Console.WriteLine(1E20);Console.WriteLine(string.Format("{0:E0}:{1:F0}:{2:F2}",2.5,3.5,-0.0));',output:'0.1\n1E-45\n1E+20\n2E+000:4:-0.00\n'},

  {name:'unsigned ToString and string concatenation',source:'uint value=4294967295U;ulong wide=18446744073709551615UL;Console.WriteLine(value.ToString());Console.WriteLine("value="+value);Console.WriteLine(wide+"!");Console.WriteLine(Convert.ToString(wide));',output:'4294967295\nvalue=4294967295\n18446744073709551615!\n18446744073709551615\n'},

  {name:'array integral indexes and lengths',source:'long count=3L;int[] values=new int[count];uint unsigned=1U;ulong wide=2UL;values[unsigned]=7;values[wide]=9;Console.WriteLine(values[(nint)1]);Console.WriteLine(values[2L]);ulong beyond=18446744073709551615UL;try{Console.WriteLine(values[beyond]);}catch(Exception error){Console.WriteLine(error.GetType().Name);}',output:'7\n9\nOverflowException\n'},
  {name:'long switch dispatch and result conversion',source:'long value=9223372036854775807L;switch(value){case 9223372036854775807L:Console.WriteLine("wide");break;default:Console.WriteLine("other");break;}uint number=4294967295U;long result=1 switch {1=>number,_=>0L};Console.WriteLine(result);',output:'wide\n4294967295\n'},

  {name:'uint signed operands widen before arithmetic',source:'uint left=4294967295U;long right=1L;Console.WriteLine(left+right);int negative=-1;Console.WriteLine(left+negative);',output:'4294967296\n4294967294\n'},
  {name:'unsigned constant and small operand promotion',source:'uint value=4294967295U;byte small=1;Console.WriteLine(unchecked(value+small));Console.WriteLine(unchecked(value+1));ulong wide=18446744073709551615UL;Console.WriteLine(unchecked(wide+1));',output:'0\n0\n0\n'},
  {name:'typed contextual and conditional conversions',source:'uint value=4294967295U;long widened=value;bool yes=true;long selected=yes?value:0L;Console.WriteLine(widened);Console.WriteLine(selected);decimal amount=yes?1:0.2M;Console.WriteLine(amount);',output:'4294967295\n4294967295\n1\n'},
  {name:'checked narrow compound and increment',source:'byte value=255;try{checked{value++;}}catch(Exception error){Console.WriteLine(error.GetType().Name);}Console.WriteLine(value);unchecked{value+=1;}Console.WriteLine(value);',output:'OverflowException\n255\n0\n'},
  {name:'Decimal constructors methods constants and out',source:'decimal value=new decimal(12345,0,0,false,2);Console.WriteLine(value.ToString());Console.WriteLine(decimal.MaxValue);decimal parsed;Console.WriteLine(decimal.TryParse("12.30",out parsed));Console.WriteLine(parsed);int[] bits=decimal.GetBits(parsed);Console.WriteLine(bits[3]);',output:'123.45\n79228162514264337593543950335\nTrue\n12.30\n131072\n'},
  {name:'Decimal native integer conversions',source:'nint signed=(nint)(-7);nuint unsigned=(nuint)9;Console.WriteLine((decimal)signed);Console.WriteLine((decimal)unsigned);Console.WriteLine((long)(nint)12.99M);Console.WriteLine((ulong)(nuint)12.99M);',output:'-7\n9\n12\n12\n'},
  {name:'typed scalar GetType and character formatting',source:'uint unsigned=1U;float single=1F;decimal amount=1M;char letter=\'A\';Console.WriteLine(unsigned.GetType().Name);Console.WriteLine(single.GetType().Name);Console.WriteLine(amount.GetType().Name);Console.WriteLine(letter);',output:'UInt32\nSingle\nDecimal\nA\n'},
  {name:'Math narrow Abs overflow',source:'sbyte small=-128;short bigger=-32768;try{Console.WriteLine(Math.Abs(small));}catch(Exception error){Console.WriteLine(error.GetType().Name);}try{Console.WriteLine(Math.Abs(bigger));}catch(Exception error){Console.WriteLine(error.GetType().Name);}',output:'OverflowException\nOverflowException\n'},
  {name:'Math unsigned Min Max',source:'uint small=1U;uint large=4294967295U;ulong wide=18446744073709551615UL;Console.WriteLine(Math.Min(small,large));Console.WriteLine(Math.Max(small,large));Console.WriteLine(Math.Min(1UL,wide));Console.WriteLine(Math.Max(1UL,wide));',output:'1\n4294967295\n1\n18446744073709551615\n'},
  {name:'Math rounding modes and signed zero',source:'Console.WriteLine(Math.Round(1.25,1,MidpointRounding.ToEven));Console.WriteLine(Math.Round(1.25,1,MidpointRounding.AwayFromZero));Console.WriteLine(Math.Round(-1.25,1,MidpointRounding.ToZero));Console.WriteLine(Math.Round(-1.25,1,MidpointRounding.ToNegativeInfinity));Console.WriteLine(Math.Round(-1.25,1,MidpointRounding.ToPositiveInfinity));Console.WriteLine(BitConverter.DoubleToInt64Bits(Math.Round(-0.1)));',output:'1.2\n1.3\n-1.2\n-1.3\n-1.2\n-9223372036854775808\n'},
  {name:'Math Sign NaN and invalid logarithm base',source:'try{Console.WriteLine(Math.Sign(double.NaN));}catch(Exception error){Console.WriteLine(error.GetType().Name);}Console.WriteLine(Math.Log(2.0,1.0));',output:'ArithmeticException\nNaN\n'},

  {name:'uint widening',source:'uint value=4294967295U;Console.WriteLine((ulong)value);',output:'4294967295\n'},
  {name:'long wrap',source:'long value=9223372036854775807L;Console.WriteLine(unchecked(value+1L));',output:'-9223372036854775808\n'},
  {name:'ulong division',source:'ulong value=18446744073709551615UL;Console.WriteLine(value/3UL);',output:'6148914691236517205\n'},
  {name:'small integer storage',source:'int value=-1;byte a=unchecked((byte)value);short b=unchecked((short)65535);Console.WriteLine(a);Console.WriteLine(b);',output:'255\n-1\n'},
  {name:'single arithmetic',source:'float value=16777216F;Console.WriteLine((value+1F)-value);',output:'0\n'},
  {name:'double arithmetic',source:'double value=16777216D;Console.WriteLine((value+1D)-value);',output:'1\n'},
  {name:'signed zero',source:'double zero=-0.0;Console.WriteLine(1.0/zero);float single=-0.0F;Console.WriteLine(1.0F/single);',output:'-Infinity\n-Infinity\n'},
  {name:'NaN ordering',source:'double zero=0.0;double value=zero/zero;Console.WriteLine(value==value);Console.WriteLine(value!=value);Console.WriteLine(value<=1.0);',output:'False\nTrue\nFalse\n'},
  {name:'decimal addition',source:'decimal a=0.1M;decimal b=0.2M;Console.WriteLine(a+b);',output:'0.3\n'},
  {name:'decimal scale',source:'decimal a=1.20M;decimal b=1.3M;Console.WriteLine(a+b);Console.WriteLine(a*2M);',output:'2.50\n2.40\n'},
  {name:'decimal division',source:'decimal a=1M;decimal b=3M;Console.WriteLine(a/b);',output:'0.3333333333333333333333333333\n'},
  {name:'checked unsigned overflow',source:'uint value=4294967295U;try{Console.WriteLine(checked(value+1U));}catch(Exception error){Console.WriteLine(error.GetType().Name);}',output:'OverflowException\n'},
  {name:'decimal overflow remains checked',source:'decimal value=79228162514264337593543950335M;try{Console.WriteLine(unchecked(value*2M));}catch(Exception error){Console.WriteLine(error.GetType().Name);}',output:'OverflowException\n'},
  {name:'integer division overflow',source:'long value=-9223372036854775808L;try{Console.WriteLine(value/-1L);}catch(Exception error){Console.WriteLine(error.GetType().Name);}',output:'OverflowException\n'},
];

const nativeOps={'+':'Add','-':'Subtract','*':'Multiply','/':'Divide','%':'Remainder'};
const nativeLines=[
  ...decimalCases.map(([op,a,b])=>'Print(decimal.'+nativeOps[op]+'('+a+'m,'+b+'m));'),
  ...decimalRoundingCases.map(([value,digits,mode])=>'Print(decimal.Round('+value+'m,'+digits+', (MidpointRounding)'+mode+'));'),
  ...decimalFloatCases.map(([kind,value])=>'Print(new decimal('+ (Object.is(value,-0)?'-0.0':String(value)) +(kind==='r4'?'f':'d')+'));'),
];
export const nativeScalarSource=`using System;
class ScalarReference {
 static void Print(decimal value) { int[] bits=decimal.GetBits(value); Console.WriteLine(bits[0]); Console.WriteLine(bits[1]); Console.WriteLine(bits[2]); Console.WriteLine(bits[3]); }
 static void Main() {
 ${nativeLines.join('\n ')}
 Console.WriteLine(BitConverter.SingleToInt32Bits(-0.0f));
 Console.WriteLine(BitConverter.DoubleToInt64Bits(-0.0d));
 nint native=(nint)1; Console.WriteLine((long)(native<<40));
 }
}
`;
export function scalarOracleOutput(nativeIntBits=64) {
  const values=[
    ...decimalCases.map(([op,a,b])=>decimalBinary(op,decimalParse(a),decimalParse(b))),
    ...decimalRoundingCases.map(([value,digits,mode])=>decimalRound(decimalParse(value),digits,mode)),
    ...decimalFloatCases.map(([kind,value])=>decimalFromFloat(value,kind))
  ];
  return values.flatMap(value=>decimalBits(value)).join('\n')+'\n-2147483648\n-9223372036854775808\n'+(nativeIntBits===64?'1099511627776':'256')+'\n';
}
