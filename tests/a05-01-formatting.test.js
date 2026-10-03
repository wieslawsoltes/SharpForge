import test from 'node:test';
import assert from 'node:assert/strict';
import {numericFormat,float,nativeInteger,decimalParse,decimalBits} from '@sharpforge/bytecode';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';
import {findContracts} from '@sharpforge/framework';
import {formatBclValue} from '../packages/runtime/src/bcl.js';

for(const [name,value,type,format,expected] of [
  ['unsigned 32-bit',-1,'uint','G','4294967295'],
  ['unsigned 64-bit',-1n,'ulong','G','18446744073709551615'],
  ['signed 64-bit decimal padding',-123n,'long','D6','-000123'],
  ['unsigned 64-bit fixed',-1n,'ulong','F2','18446744073709551615.00'],
  ['unsigned 64-bit scientific',-1n,'ulong','E3','1.845E+019'],
  ['signed short hexadecimal',-1,'short','X','FFFF'],
  ['unsigned 64-bit hexadecimal',-1n,'ulong','x','ffffffffffffffff'],
  ['integer scientific midpoint away',25,'int','E0','3E+001'],
  ['integer general midpoint away',25,'int','G1','3E+01'],
  ['nonfinite ignores invalid formats',float(NaN),'double','invalid','NaN'],
  ['single shortest',float(0.1,'r4'),'float','G','0.1'],
  ['single specified precision',float(0.1,'r4'),'float','G9','0.100000001'],
  ['double exponent casing',float(1e20),'double','G','1E+20'],
  ['single smallest subnormal',float(2**-149,'r4'),'float','G','1E-45'],
  ['double midpoint even',float(2.5),'double','F0','2'],
  ['double midpoint odd',float(3.5),'double','F0','4'],
  ['double scientific midpoint even',float(2.5),'double','E0','2E+000'],
  ['negative zero fixed',float(-0),'double','F2','-0.00'],
  ['negative zero general',float(-0),'double','G','-0'],
  ['Decimal scale',decimalParse('12.3000'),'decimal','G','12.3000'],
  ['Decimal rounding',decimalParse('1.245'),'decimal','F2','1.25'],
  ['Decimal explicit general trims scale',decimalParse('1.2300'),'decimal','G0','1.23'],
  ['Decimal negative midpoint',decimalParse('-1.245'),'decimal','F2','-1.25'],
  ['Decimal grouping',decimalParse('1234567.8900'),'decimal','N2','1,234,567.89'],
  ['character ignores numeric formatting',65,'char','X','A'],
  ['Boolean ignores numeric formatting',true,'bool','D3','True'],
])test(`A05 T01 exact invariant format: ${name}`,()=>assert.equal(numericFormat(value,type,format),expected));

for(const [value,type,format] of [[float(1.5),'double','D'],[1,'int','R'],[1,'int','F100'],[decimalParse('1'),'decimal','X'],[1,'int','invalid']])test(`A05 T01 rejects malformed or incompatible format ${type}:${format}`,()=>assert.throws(()=>numericFormat(value,type,format),{name:'FormatException'}));

for(const engine of ['source','cil'])for(const nativeIntBits of [32,64])test(`A05 T01 ${engine} scalar boxing retains exact headers and payloads at ABI${nativeIntBits}`,()=>{
  const compiled=compileToIL('int ignored=0;');assert(compiled.success,JSON.stringify(compiled.diagnostics));
  const vm=engine==='source'?new VirtualMachine(compiled.image,{nativeIntBits}):new CilVirtualMachine(compiled.assembly,{nativeIntBits});
  const contract=findContracts('SharpForge.Runtime.Formatting','BoxValue',true)[0];
  for(const [type,value,expected] of [['uint',-1,'4294967295'],['ulong',-1n,'18446744073709551615'],['nuint',nativeInteger(-1,nativeIntBits),nativeIntBits===32?'4294967295':'18446744073709551615'],['float',float(-0,'r4'),'-0'],['decimal',decimalParse('12.3000'),'12.3000']]) {
    const name=vm.heap.string(type),boxed=vm.platform.invoke(contract,[value,name]),record=vm.heap.get(boxed);
    assert.equal(record.methodTable,vm.heap.methodTables.get(type));assert.equal(record.kind,'box');assert.equal(vm.format(boxed),expected);
    if(type==='decimal')assert.deepEqual(decimalBits(record.data[0]),decimalBits(value));
    if(type==='float')assert(Object.is(record.data[0].value,-0));
    assert.equal(formatBclValue(vm.platform,boxed,'',0,'object'),expected);
    vm.heap.withRoots([boxed],()=>{vm.heap.collect();assert.equal(formatBclValue(vm.platform,boxed,'',expected.length+2),'  '+expected);});
  }
  const boxed=vm.platform.invoke(contract,[-1,vm.heap.string('uint')]);
  assert.throws(()=>vm.platform.invoke(contract,[boxed,vm.heap.string('double')]),{name:'InvalidCastException'});
  assert.throws(()=>formatBclValue(vm.platform,1,'G',100001,'int'),{name:'ArgumentOutOfRangeException'});
});
