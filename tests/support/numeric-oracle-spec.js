/** Independent input corpus. Expected results are produced only by the native CLR generator. */
export const numericPairCount = 100_000;
export const numericSeed = 88172645463325252n;
export const int64Operations = Object.freeze([
  ['add', 'unchecked(a+b)'], ['sub', 'unchecked(a-b)'], ['mul', 'unchecked(a*b)'],
  ['div', 'a/b'], ['rem', 'a%b'], ['shl', 'a<<count'], ['shr', 'a>>count'],
  ['and', 'a&b'], ['or', 'a|b'], ['xor', 'a^b'],
  ['div.un', 'unchecked((long)(ua/ub))'], ['rem.un', 'unchecked((long)(ua%ub))'],
  ['shr.un', 'unchecked((long)(ua>>count))'],
  ['add.ovf', 'checked(a+b)'], ['sub.ovf', 'checked(a-b)'], ['mul.ovf', 'checked(a*b)'],
  ['add.ovf.un', 'unchecked((long)checked(ua+ub))'],
  ['sub.ovf.un', 'unchecked((long)checked(ua-ub))'],
  ['mul.ovf.un', 'unchecked((long)checked(ua*ub))'],
  ['eq', 'a==b?1L:0L'], ['ne', 'a!=b?1L:0L'], ['lt', 'a<b?1L:0L'],
  ['le', 'a<=b?1L:0L'], ['gt', 'a>b?1L:0L'], ['ge', 'a>=b?1L:0L'],
  ['lt.un', 'ua<ub?1L:0L'], ['le.un', 'ua<=ub?1L:0L'],
  ['gt.un', 'ua>ub?1L:0L'], ['ge.un', 'ua>=ub?1L:0L'],
].map(([opcode, expression]) => Object.freeze({opcode, expression})));

const boundaryPairs = Object.freeze([
  [0n, 0n], [1n, 0n], [-1n, 0n], [-(1n << 63n), -1n], [(1n << 63n) - 1n, 1n],
  [-1n, -1n], [1n, 64n], [-1n, 65n], [1n, -1n], [0n, 1n], [1n << 32n, 1n << 32n],
]);

function nextRandom(state) {
  state = BigInt.asUintN(64, state ^ state << 13n);
  state = BigInt.asUintN(64, state ^ state >> 7n);
  return BigInt.asUintN(64, state ^ state << 17n);
}

/** 100k repeatable operand pairs, with division/overflow/large-shift boundaries first. */
export function* int64Pairs(count = numericPairCount) {
  let state = numericSeed;
  for (let index = 0; index < count; index++) {
    state = nextRandom(state);
    const left = BigInt.asIntN(64, state);
    state = nextRandom(state);
    const right = BigInt.asIntN(64, state);
    yield boundaryPairs[index] ?? [left, right];
  }
}

function longLiteral(value) {
  return value === -(1n << 63n) ? 'long.MinValue' : String(value) + 'L';
}

/** This exact source is compiled independently by Roslyn and SharpForge. */
export function int64OracleSource(count = numericPairCount) {
  const cases = int64Operations.map(({expression}, index) => `case ${index}:return ${expression};`).join('\n');
  const boundaries = boundaryPairs.map(([left, right], index) =>
    `case ${index}:a=${longLiteral(left)};b=${longLiteral(right)};break;`).join('\n');
  return `class Program {
    static ulong state=${numericSeed}UL;
    static ulong Next(){state^=state<<13;state^=state>>7;state^=state<<17;return state;}
    static long Evaluate(int operation,long a,long b){
      ulong ua=unchecked((ulong)a);ulong ub=unchecked((ulong)b);int count=unchecked((int)b);
      switch(operation){${cases}default:return 0L;}
    }
    static void Main(){
      for(int i=0;i<${count};i++){
        long a=unchecked((long)Next());long b=unchecked((long)Next());
        switch(i){${boundaries}}
        for(int operation=0;operation<${int64Operations.length};operation++){
          try{Console.WriteLine(Evaluate(operation,a,b));}
          catch(Exception error){Console.WriteLine("!"+error.GetType().Name);}
        }
      }
    }
  }`;
}

export const numericFamilies = Object.freeze([
  {name: 'uint32', source: 'uint a=4294967295U;uint b=2147483648U;' +
    'Console.WriteLine(unchecked(a+b));Console.WriteLine(unchecked(a-b));Console.WriteLine(unchecked(a*b));' +
    'Console.WriteLine(a/b);Console.WriteLine(a%b);Console.WriteLine(a>>33);' +
    'Console.WriteLine(a>b);Console.WriteLine(b<a);Console.WriteLine(a>=b);Console.WriteLine(b<=a);' +
    'try{Console.WriteLine(checked(a+1U));}catch(Exception error){Console.WriteLine(error.GetType().Name);}'},
  {name: 'native', source: 'Console.WriteLine(System.IntPtr.Size);Console.WriteLine(System.UIntPtr.Size);' +
    'nint a=(nint)(-1);int b=2;Console.WriteLine((long)(a+b));Console.WriteLine((long)(a<<40));' +
    'nuint high=unchecked((nuint)18446744073709551615UL);Console.WriteLine((ulong)high);' +
    'try{Console.WriteLine((ulong)checked(high+(nuint)1));}catch(Exception error){Console.WriteLine(error.GetType().Name);}'},
  {name: 'float', source: 'double nan=double.NaN;double zero=-0.0;float single=16777216F;' +
    'Console.WriteLine(nan==nan);Console.WriteLine(nan!=nan);Console.WriteLine(nan<1D);' +
    'Console.WriteLine(nan<=1D);Console.WriteLine(nan>1D);Console.WriteLine(nan>=1D);' +
    'Console.WriteLine(BitConverter.SingleToInt32Bits(single+1F));' +
    'Console.WriteLine(BitConverter.DoubleToInt64Bits(zero));Console.WriteLine(1D/zero);' +
    'Console.WriteLine(3D%2D);Console.WriteLine(Math.IEEERemainder(3D,2D));' +
    'Console.WriteLine(BitConverter.DoubleToInt64Bits(-4D%2D));' +
    'Console.WriteLine(BitConverter.SingleToInt32Bits(-4F%2F));' +
    'Console.WriteLine(BitConverter.DoubleToInt64Bits(3D%2D));' +
    'float maximum=float.MaxValue;Console.WriteLine(BitConverter.SingleToInt32Bits(maximum*2F));' +
    'double invalid=double.PositiveInfinity%2D;Console.WriteLine(invalid!=invalid);'},
  {name: 'decimal', source: 'decimal a=0.1M;decimal b=0.2M;Console.WriteLine(a+b);Console.WriteLine(1M/3M);' +
    'decimal c=1.10M;object boxed=c;c=2M;Console.WriteLine(boxed);Console.WriteLine(decimal.Round(1.245M,2));' +
    'Console.WriteLine(decimal.Round(-1.245M,2,MidpointRounding.AwayFromZero));' +
    'decimal maximum=decimal.MaxValue;try{Console.WriteLine(maximum+1M);}' +
    'catch(Exception error){Console.WriteLine(error.GetType().Name);}'},
  {name: 'checked-shift', languageVersion: '11.0', source: 'int a=-1;long b=-1L;nint c=(nint)(-1);' +
    'Console.WriteLine(a>>>1);Console.WriteLine(b>>>65);Console.WriteLine((long)(c>>>1));' +
    'a>>>=1;Console.WriteLine(a);int amount=300;' +
    'try{Console.WriteLine(checked((byte)amount));}catch(Exception error){Console.WriteLine(error.GetType().Name);}' +
    'long maximum=long.MaxValue;try{Console.WriteLine(checked(maximum+1L));}' +
    'catch(Exception error){Console.WriteLine(error.GetType().Name);}'},
].map(family => Object.freeze(family)));

/** All 25 pairs of UInt32 sign-boundary patterns exercise the same 29 opcodes. */
export function uint32OracleSource() {
  const cases = int64Operations.map(({expression}, index) => {
    const body = expression.replaceAll('(long)', '(int)').replaceAll('1L', '1').replaceAll('0L', '0');
    return `case ${index}:return ${body};`;
  }).join('\n');
  return `class Program {
    static int Value(int index){switch(index){case 0:return 0;case 1:return 1;
      case 2:return int.MaxValue;case 3:return int.MinValue;default:return -1;}}
    static int Evaluate(int operation,int a,int b){
      uint ua=unchecked((uint)a);uint ub=unchecked((uint)b);int count=b;
      switch(operation){${cases}default:return 0;}
    }
    static void Main(){for(int left=0;left<5;left++){for(int right=0;right<5;right++){
      int a=Value(left);int b=Value(right);
      for(int operation=0;operation<${int64Operations.length};operation++){
        try{Console.WriteLine(Evaluate(operation,a,b));}
        catch(Exception error){Console.WriteLine("!"+error.GetType().Name);}
      }
    }}}
  }`;
}

/** Source small storage includes value arguments, fields, statics, arrays and ref calls. */
export function smallStorageOracleSource() {
  const types = ['sbyte', 'byte', 'short', 'ushort', 'char', 'bool'];
  const fields = types.map((type, index) => `public ${type} Field${index};public static ${type} Static${index};`).join('\n');
  const methods = types.map((type, index) => {
    const value = type === 'bool' ? 'input!=0' : `unchecked((${type})input)`;
    return `static ${type} Argument${index}(${type} value){return value;}` +
      `static void Store${index}(ref ${type} value,int input){value=${value};}`;
  }).join('\n');
  const cases = types.map((type, index) => {
    const cast = type === 'bool' ? 'input!=0' : `unchecked((${type})input)`;
    const print = value => type === 'char' ? `(int)${value}` : value;
    return `{${type} value=${cast};Console.WriteLine(${print('value')});` +
      `Console.WriteLine(${print(`Argument${index}(value)`)});` +
      `holder.Field${index}=${cast};Console.WriteLine(${print(`holder.Field${index}`)});` +
      `Holder.Static${index}=${cast};Console.WriteLine(${print(`Holder.Static${index}`)});` +
      `${type}[] items=new ${type}[1];items[0]=${cast};Console.WriteLine(${print('items[0]')});` +
      `Store${index}(ref value,input);Console.WriteLine(${print('value')});}`;
  }).join('\n');
  return `class Holder{${fields}}class Program{${methods}static void Main(){` +
    `int input=131071;Holder holder=new Holder();${cases}}}`;
}
