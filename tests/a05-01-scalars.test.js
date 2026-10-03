import test from 'node:test';
import assert from 'node:assert/strict';
import {binary,compare,convert,defaults,float,number,nativeInteger,storage} from '../packages/runtime/src/execution/numeric-ops.js';
import {NumericType,numericMode,decodeNumericMode,integerType,nativeIntegerBits} from '../packages/runtime/src/execution/numeric-types.js';
import {scalarBinary,scalarUnary,scalarConvert,scalarFormat,encodeScalar,decodeScalar} from '../packages/runtime/src/execution/scalar-ops.js';
import {singleToInt32Bits,doubleToInt64Bits,int32BitsToSingle,int64BitsToDouble} from '../packages/runtime/src/execution/numeric-intrinsics.js';
import {binary as sourceBinary,convert as sourceConvert,unary as sourceUnary} from '../packages/runtime/src/execution/source-ops.js';
import {copyExecution} from '../packages/runtime/src/snapshot.js';
import {decimalParse} from '../packages/runtime/src/execution/decimal-ops.js';

test('A05 T01 signed and unsigned scalar widths preserve exact storage and checked boundaries',()=>{
  for(const [type,min,max] of [['sbyte',-128n,127n],['byte',0n,255n],['short',-32768n,32767n],['ushort',0n,65535n],['char',0n,65535n],['int',-2147483648n,2147483647n],['uint',0n,4294967295n],['long',-(1n<<63n),(1n<<63n)-1n],['ulong',0n,(1n<<64n)-1n]]) {
    for(const bound of [min,max])assert.equal(scalarFormat(scalarConvert(bound,'long',type,false),type),type==='char'?String.fromCharCode(Number(bound)):String(bound),type);
    assert.throws(()=>scalarConvert(decimalParse(String(min-1n)),'decimal',type,true),{name:'OverflowException'},type+' min');
    assert.throws(()=>scalarConvert(decimalParse(String(max+1n)),'decimal',type,true),{name:'OverflowException'},type+' max');
  }
  assert.equal(scalarConvert(-1,'int','ulong'),-1n);
  assert.equal(scalarConvert(-1,'uint','long'),4294967295n);
  assert.equal(convert('conv.u8',-1),4294967295n); // CIL opcode retains its separate extension rule.
  assert.equal(scalarConvert(255,'int','sbyte'),-1);
  assert.equal(scalarConvert(65535,'int','short'),-1);
  assert.throws(()=>scalarConvert(-1,'int','uint',true),{name:'OverflowException'});
});

for(const bits of [32,64])test(`A05 T01 native integer ABI${bits} has native overflow and shift widths`,()=>{
  const context={nativeIntBits:bits},max=(1n<<BigInt(bits-1))-1n,min=-(1n<<BigInt(bits-1));
  const a=nativeInteger(max,bits),one=nativeInteger(1,bits);
  assert.equal(number(binary('add',a,one,context)),bits===64?min:Number(min));
  assert.throws(()=>binary('add.ovf',a,one,context),{name:'OverflowException'});
  assert.equal(number(binary('shl',one,bits,context)),bits===64?1n:1);
  assert.equal(number(scalarBinary('<<',one,40,'nint',false,context)),bits===64?1099511627776n:256);
  assert.equal(defaults('nint',context).nativeInt,bits);
  assert.equal(storage(7,'nuint',context).nativeInt,bits);
  assert.equal(convert('conv.i',-1,context).value,bits===64?-1n:-1);
  assert.equal(convert('conv.u',-1,context).value,bits===64?4294967295n:-1);
  assert.equal(compare(one,1,'eq'),true);
  assert.throws(()=>binary('add',one,1n,context),{name:'InvalidProgramException'});
  assert.throws(()=>binary('div',nativeInteger(min,bits),nativeInteger(-1,bits),context),{name:'OverflowException'});
  assert.equal(copyExecution({a}).a,a);
});

test('A05 T01 integer arithmetic and comparisons use signedness rather than JS magnitude',()=>{
  assert.equal(scalarBinary('/',-1,3,'uint'),1431655765);
  assert.equal(scalarBinary('>',-1,1,'uint'),true);
  assert.equal(scalarBinary('>',-1,1,'int'),false);
  assert.equal(scalarBinary('>>',-1,1,'uint'),2147483647);
  assert.equal(scalarBinary('>>',-1n,1,'ulong'),9223372036854775807n);
  assert.equal(scalarBinary('*',0x7fffffff,0x7fffffff,'int'),1);
  assert.equal(scalarBinary('+',-1n,1n,'ulong'),0n);
  assert.throws(()=>scalarBinary('+',-1n,1n,'ulong',true),{name:'OverflowException'});
  assert.throws(()=>scalarBinary('/',-(1n<<63n),-1n,'long'),{name:'OverflowException'});
  assert.throws(()=>scalarBinary('/',1,0,'int'),{name:'DivideByZeroException',message:'Attempted to divide by zero'});
  assert.throws(()=>scalarBinary('%',-(1n<<63n),-1n,'long'),{name:'OverflowException'});
});

test('A05 T01 r4 operations round to single precision and retain IEEE exceptional values',()=>{
  const single=scalarBinary('+',float(16777216,'r4'),float(1,'r4'),'float');
  assert.equal(single.float,'r4');assert.equal(number(single),16777216);
  assert.equal(number(scalarBinary('+',16777216,1,'double')),16777217);
  assert.equal(number(scalarBinary('*',float(3.4028234663852886e38,'r4'),float(2,'r4'),'float')),Infinity);
  for(const type of ['float','double']) {
    assert(Object.is(number(scalarBinary('*',-0,1,type)),-0));
    assert(Object.is(number(scalarUnary('-',0,type)),-0));
    assert.equal(number(scalarBinary('/',1,-0,type)),-Infinity);
    const nan=scalarBinary('/',0,0,type);assert(Number.isNaN(number(nan)));
    for(const op of ['==','<','<=','>','>='])assert.equal(scalarBinary(op,nan,1,type),false);
    assert.equal(scalarBinary('!=',nan,nan,type),true);
    assert.equal(number(scalarConvert(nan,type,'int')),0);
    assert.throws(()=>scalarConvert(nan,type,'int',true),{name:'OverflowException'});
  }
  assert.equal(compare(float(NaN),float(1),'gt',true),true);
});

test('A05 T01 bit adapters and JSON constants preserve zero signs and exact UInt64 values',()=>{
  assert.equal(singleToInt32Bits(float(-0,'r4')),-2147483648);
  assert.equal(doubleToInt64Bits(float(-0)),-9223372036854775808n);
  assert(Object.is(number(int32BitsToSingle(-2147483648)),-0));
  assert(Object.is(number(int64BitsToDouble(-9223372036854775808n)),-0));
  assert(Number.isNaN(number(int32BitsToSingle(0x7fc00000))));
  for(const [value,type] of [[float(-0),'double'],[float(NaN),'double'],[float(Infinity,'r4'),'float'],[-1n,'ulong'],[-9223372036854775808n,'long']]) {
    const restored=decodeScalar(JSON.parse(JSON.stringify(encodeScalar(value,type))));
    assert(Object.is(number(restored),number(value)),type);
  }
});

test('A05 T01 typed source adapters use the same numeric operations as direct CIL',()=>{
  const vm={options:{nativeIntBits:64},value:number};
  assert.equal(sourceBinary(vm,'/',-1,3,numericMode('uint')),scalarBinary('/',-1,3,'uint'));
  assert.equal(sourceConvert(-1,NumericType.long,numericMode('uint')),4294967295n);
  assert.equal(sourceUnary('~',0n,numericMode('ulong')),-1n);
  assert.equal(sourceBinary(vm,'<<',nativeInteger(1,64),40,numericMode('nint')).value,1099511627776n);
  assert.equal(sourceConvert(7.9,0),7);assert.equal(sourceConvert(-7.9,0),-7);
});

test('A05 T01 malformed modes, constants and mixed stack categories fail explicitly',()=>{
  assert.equal(nativeIntegerBits(),32);assert.equal(integerType('System.UIntPtr',{nativeIntBits:64}).bits,64);
  assert.deepEqual(decodeNumericMode(numericMode('long',true)),{type:'long',checked:true});
  assert.throws(()=>nativeIntegerBits({nativeIntBits:16}),TypeError);
  assert.throws(()=>decodeNumericMode(15),TypeError);
  assert.throws(()=>decodeScalar({scalar:'ulong',value:'18446744073709551616'}),{name:'OverflowException'});
  assert.throws(()=>decodeScalar({scalar:'int',value:'1.25'}),{name:'InvalidProgramException'});
  assert.throws(()=>decodeScalar({scalar:'double',value:'123garbage'}),{name:'InvalidProgramException'});
  assert.throws(()=>scalarBinary('&',1,2,'float'),{name:'InvalidProgramException'});
  assert.throws(()=>binary('add',nativeInteger(1,32),nativeInteger(1,64)),{name:'InvalidProgramException'});
  assert.throws(()=>compare(nativeInteger(1,32),nativeInteger(1,64),'eq'),{name:'InvalidProgramException'});
  assert.throws(()=>compare(1n,1,'eq'),{name:'InvalidProgramException'});
  assert.throws(()=>storage({decimal:true,coefficient:1n,scale:99,negative:false},'decimal'),{name:'InvalidProgramException'});
});
