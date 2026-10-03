import test from 'node:test';
import assert from 'node:assert/strict';
import {decimal,decimalZero,decimalMaxCoefficient,decimalBits,decimalFromBits,decimalParse,decimalFormat,decimalBinary,decimalRound,decimalFromFloat,decimalToFloat,decimalToInteger,decimalCompare,decimalNegate} from '../packages/runtime/src/execution/decimal-ops.js';
import {encodeScalar,decodeScalar,scalarConvert} from '../packages/runtime/src/execution/scalar-ops.js';
import {invokeDecimal,decimalConstants} from '../packages/runtime/src/execution/decimal-intrinsics.js';
import {defaults,number,storage} from '../packages/runtime/src/execution/numeric-ops.js';
import {ManagedHeap} from '@sharpforge/runtime';
import {copyExecution} from '../packages/runtime/src/snapshot.js';
import {decimalCases} from './a05-01-fixtures.js';

for(const [operation,left,right,expected] of decimalCases)test(`A05 T01 Decimal ${left} ${operation} ${right}`,()=>{
  const result=decimalBinary(operation,decimalParse(left),decimalParse(right));
  if(expected.startsWith('!'))assert.fail('Exception case must use the fault matrix');
  assert.equal(decimalFormat(result),expected);
});

test('A05 T01 Decimal preserves its 96-bit payload, scale and negative zero',()=>{
  const value=decimalFromBits([-1,-1,-1,0]);assert.equal(value.coefficient,decimalMaxCoefficient);
  assert.deepEqual(decimalBits(value),[-1,-1,-1,0]);
  const zero=decimalFromBits([0,0,0,-2145648640]); // Negative, scale 28.
  assert.equal(zero.scale,28);assert.equal(zero.negative,true);
  assert.equal(decimalCompare(zero,decimalZero),0);
  assert(Object.is(decimalToFloat(zero),-0));
  assert.deepEqual(decimalBits(decodeScalar(JSON.parse(JSON.stringify(encodeScalar(zero,'decimal'))))),decimalBits(zero));
  assert.equal(copyExecution({value}).value,value);assert(Object.isFrozen(value));
  assert.equal(defaults('System.Decimal'),decimalZero);assert.equal(storage(value,'decimal'),value);
});

test('A05 T01 Decimal ties, directed rounding and overflow follow one rounding step',()=>{
  for(const [input,mode,expected] of [['1.245',0,'1.24'],['1.255',0,'1.26'],['-1.245',0,'-1.24'],['1.245',1,'1.25'],['-1.241',2,'-1.24'],['-1.241',3,'-1.25'],['1.241',4,'1.25']])assert.equal(decimalFormat(decimalRound(decimalParse(input),2,mode)),expected);
  const max=decimalConstants.MaxValue;
  assert.equal(decimalFormat(decimalBinary('+',max,decimalParse('0.4'))),decimalMaxCoefficient.toString());
  assert.throws(()=>decimalBinary('+',max,decimalParse('0.5')),{name:'OverflowException'});
  assert.throws(()=>decimalBinary('*',max,decimalParse('10')),{name:'OverflowException'});
  assert.throws(()=>decimalBinary('/',max,decimalZero),{name:'DivideByZeroException'});
  assert.throws(()=>decimalBinary('%',max,decimalZero),{name:'DivideByZeroException'});
  assert.equal(decimalFormat(decimalParse('0.00000000000000000000000000015')),'0.0000000000000000000000000002');
  assert.equal(decimalFormat(decimalParse('0.00000000000000000000000000025')),'0.0000000000000000000000000002');
});

test('A05 T01 Decimal conversions distinguish truncation from rounding and binary precision',()=>{
  assert.equal(decimalToInteger(decimalParse('-7.99'),{bits:32}),-7);
  assert.equal(decimalToInteger(decimalParse('18446744073709551615'),{bits:64,unsigned:true}),18446744073709551615n);
  assert.throws(()=>decimalToInteger(decimalParse('-1'),{bits:64,unsigned:true}),{name:'OverflowException'});
  assert.equal(decimalFormat(decimalFromFloat(0.1)),'0.1');
  assert.equal(decimalFormat(decimalFromFloat(Math.fround(0.1),'r4')),'0.1');
  assert.equal(decimalFormat(decimalFromFloat(1.2345678901234567)),'1.23456789012346');
  assert.equal(decimalFormat(decimalFromFloat(1.23456789,'r4')),'1.234568');
  assert.equal(decimalFromFloat(-0),decimalZero);
  for(const value of [NaN,Infinity,-Infinity,1e29])assert.throws(()=>decimalFromFloat(value),{name:'OverflowException'});
  assert.equal(number(scalarConvert(decimalParse('0.5'),'decimal','float')),0.5);
  assert.equal(decimalFormat(scalarConvert(-1,'uint','decimal')),'4294967295');
  assert.equal(decimalFormat(scalarConvert(-1n,'ulong','decimal')),'18446744073709551615');
});

test('A05 T01 Decimal rejects malformed payloads and formatting without mutating inputs',()=>{
  for(const bits of [[],[1,2,3],[1,2,3,1],[1,2,3,29<<16],[1,2,3,0x01000000]])assert.throws(()=>decimalFromBits(bits),{name:'ArgumentException'});
  for(const text of ['',',1','one','1.2.3'])assert.throws(()=>decimalParse(text,{allowThousands:true}),{name:'FormatException'});
  assert.throws(()=>decimalParse(null),{name:'ArgumentNullException'});
  assert.throws(()=>decimalParse('79228162514264337593543950336'),{name:'OverflowException'});
  assert.throws(()=>decimalRound(decimalZero,29),{name:'ArgumentOutOfRangeException'});
  assert.throws(()=>decimalRound(decimalZero,0,9),{name:'ArgumentException'});
  assert.throws(()=>decimal(-1n),{name:'ArgumentException'});
  const value=decimalParse('1.200');assert.equal(decimalFormat(value,'F2'),'1.20');assert.equal(value.scale,3);
  assert.equal(decimalFormat(decimalParse('12345.6789'),'E2'),'1.23E+004');
  assert.equal(decimalFormat(decimalParse('0.0125'),'P1'),'1.2 %');
  assert.equal(decimalFormat(decimalParse('12345.6789'),'N2'),'12,345.68');
  assert.deepEqual(decimalBits(decimalNegate(decimalZero)),[0,0,0,-2147483648]);
});

test('A05 T01 Decimal intrinsic constructors, byrefs, bit arrays and boxing use one immutable value',()=>{
  const heap=new ManagedHeap(),slot={value:decimalZero},address={byref:true};
  const vm={heap,options:{},value:value=>value,dereference:(_address,write=false,value)=>write?(slot.value=value):slot.value};
  const call=(name,parameters,returnType,args,isStatic=true)=>invokeDecimal(vm,{owner:'System.Decimal',name,signature:{parameters,returnType,isStatic}},args);
  const value=call('.ctor',['int','int','int','bool','byte'],'void',[12345,0,0,false,3],false).value;
  assert.equal(decimalFormat(value),'12.345');
  call('.ctor',['int'],'void',[address,7],false);assert.equal(decimalFormat(slot.value),'7');
  const bits=call('GetBits',['System.Decimal'],'int[]',[value]).value;assert.deepEqual(heap.get(bits).data,[12345,0,0,3<<16]);
  assert.equal(decimalFormat(call('.ctor',['int[]'],'void',[bits],false).value),'12.345');
  const boxed=heap.allocate('box','System.Decimal',[value]);
  const text=call('ToString',[],'string',[boxed],false).value;assert.equal(heap.get(text).data,'12.345');
  const invalid=heap.string('invalid');assert.equal(call('TryParse',['string','System.Decimal&'],'bool',[invalid,address]).value,false);assert.equal(slot.value,decimalZero);
  const rounding=Object.freeze({enumType:'System.MidpointRounding',value:1});
  assert.equal(decimalFormat(call('Round',['System.Decimal','int','System.MidpointRounding'],'System.Decimal',[decimalParse('1.245'),2,rounding]).value),'1.25');
  assert.deepEqual(invokeDecimal(vm,{owner:'Example.Decimal',name:'Add',signature:{parameters:[],returnType:'void',isStatic:true}},[]),{handled:false});
});
