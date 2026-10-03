import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,compileToIL,evaluateConstant} from '@sharpforge/compiler';
import {parseExpression} from '@sharpforge/syntax';
import {AssemblyInspector,loadAssembly} from '@sharpforge/cil';
import {Op,Builtins,verifyImage} from '@sharpforge/bytecode';

for(const [name,source] of [
  ['Decimal with binary floating point','decimal a=1M;double b=2D;Console.WriteLine(a+b);'],
  ['unsigned and signed wide operands','ulong a=1UL;long b=2L;Console.WriteLine(a+b);'],
  ['unsigned native negation','nuint value=(nuint)1;Console.WriteLine(-value);'],
  ['narrow constant outside storage range','byte value=256;'],
  ['implicit integer to character','char value=65;'],
  ['fractional array index','int[] values=new int[2];Console.WriteLine(values[0.5]);'],
  ['fractional array length','int[] values=new int[0.5];'],
  ['wrong Decimal out width','long value;decimal.TryParse("1",out value);'],
  ['Decimal ref instead of out','decimal value=0M;decimal.TryParse("1",ref value);']
])test(`A05 T01 source rejects ${name}`,()=>{
  const result=compile(source);assert.equal(result.success,false);assert(result.diagnostics.some(d=>d.severity==='error'));
});

test('A05 T01 constant evaluation never freezes a native-width cast to the browser ABI',()=>{
  for(const source of ['unchecked((nint)4294967296L)','unchecked((nuint)18446744073709551615UL)','((nint)1)<<40']) {
    const parsed=parseExpression(source);assert.deepEqual(parsed.diagnostics,[]);assert.equal(evaluateConstant(parsed.expression),null);
  }
});

test('A05 T01 emitted primitive MemberRefs retain actual CLI signatures',()=>{
  const compiled=compileToIL('byte small=1;uint unsigned=4294967295U;decimal amount=new decimal(1,0,0,false,2);Console.WriteLine(small);Console.WriteLine(unsigned);Console.WriteLine(amount);Console.WriteLine(BitConverter.DoubleToInt64Bits(-0.0));');
  assert(compiled.success,JSON.stringify(compiled.diagnostics));const inspector=new AssemblyInspector(compiled.assembly),refs=(inspector.metadata.rows[10]??[]).map((_,index)=>inspector.resolveToken(0x0a000001+index));
  const console=refs.filter(d=>d.owner==='System.Console').map(d=>d.signature.parameters[0]);
  assert(console.includes('int'));assert(console.includes('uint'));assert(console.includes('decimal'));assert(console.includes('long'));assert(!console.includes('byte'));
  const bits=refs.find(d=>d.owner==='System.BitConverter');assert.deepEqual(bits.signature.parameters,['double']);assert.equal(bits.signature.returnType,'long');
  assert.deepEqual(verifyImage(loadAssembly(compiled.assembly)),[]);
});

test('A05 T01 scalar source calls use the shared descriptor profile',()=>{
  const result=compile('decimal parsed;decimal.TryParse("1.20",out parsed);Console.WriteLine(decimal.Round(parsed,1));uint value=4294967295U;Console.WriteLine(value.ToString());');assert(result.success,JSON.stringify(result.diagnostics));
  const descriptors=[];for(const method of result.image.methods)for(let pc=0;pc<method.code.length;pc+=3)if(method.code[pc]===Op.BUILTIN){const descriptor=Builtins[method.code[pc+1]].numeric;if(descriptor)descriptors.push(descriptor);}
  assert(descriptors.some(d=>d.owner==='System.Decimal'&&d.name==='TryParse'&&d.parameters[1]==='System.Decimal&'));
  assert(descriptors.some(d=>d.owner==='System.Convert'&&d.parameters[0]==='uint'));
});


test('A05 T01 formatting helpers emit CLR boxing and genuine String.Format signatures',()=>{
  const compiled=compileToIL('uint value=4294967295U;Console.WriteLine($"{value:X8}");Console.WriteLine(string.Format("{0}:{1}:{2}:{3}",value,1UL,2M,0.1F));');
  assert(compiled.success,JSON.stringify(compiled.diagnostics));
  const inspector=new AssemblyInspector(compiled.assembly),refs=(inspector.metadata.rows[10]??[]).map((_,index)=>inspector.resolveToken(0x0a000001+index));
  assert(!refs.some(d=>d.owner==='SharpForge.Runtime.Formatting'));
  const formats=refs.filter(d=>d.owner==='System.String'&&d.name==='Format');
  assert(formats.some(d=>d.signature.parameters.join(',')==='string,object[]'));
  assert(!formats.some(d=>d.signature.parameters.length===5));
  assert.deepEqual(verifyImage(loadAssembly(compiled.assembly)),[]);
});
