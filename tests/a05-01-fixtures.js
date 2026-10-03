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
