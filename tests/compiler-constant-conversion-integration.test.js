import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compile,compileToIL} from '@sharpforge/compiler';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';
const fixture=new URL('./fixtures/compiler-constant-conversion/',import.meta.url);
const source=readFileSync(new URL('Program.cs',fixture),'utf8');
const oracle=JSON.parse(readFileSync(new URL('oracle.json',fixture),'utf8'));

test('floating conversion evidence binds the actual source to two pinned native runs',()=>{
  assert.equal(createHash('sha256').update(source).digest('hex'),oracle.sourceSHA256);
  assert.equal(oracle.toolchain.sdk,'10.0.201');assert.equal(oracle.toolchain.runtime,'10.0.5');
  assert.equal(oracle.toolchain.roslyn.version,'5.3.0-2.26153.122 (4d3023de605a78ba3e59e50c657eed70f125c68a)');
  assert.equal(oracle.compileRuns,2);assert.equal(oracle.executionRuns,2);
  assert.equal(oracle.compiled.exitCode,0);assert.deepEqual(oracle.compiled.diagnostics,[]);
  assert.equal(oracle.executed.exitCode,0);assert.equal(oracle.executed.stderr,'');
  assert.match(oracle.compiled.assemblySHA256,/^[a-f0-9]{64}$/);
});

for(const pipeline of ['bound','legacy'])test(`floating constants and runtime casts retain distinct native results: ${pipeline}`,()=>{
  const compiled=compileToIL(source,{pipeline});assert(compiled.success,JSON.stringify(compiled.diagnostics));
  for(const vm of [new VirtualMachine(compiled.image),new CilVirtualMachine(compiled.assembly)]){
    try{const result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,oracle.executed.stdout);}
    finally{vm.stop();}
  }
});

test('constant conversion integration emits identical images through both compiler pipelines',()=>{
  const result=compile(source,{pipeline:'verify'});assert(result.success,JSON.stringify(result.diagnostics));
});

for(const pipeline of ['bound','legacy'])test(`constant folding retains invalid conversion and checked overflow diagnostics: ${pipeline}`,()=>{
  for(const [text,code] of [['Console.WriteLine((int)true);','CS0030'],['Console.WriteLine((int)"bad");','CS0030'],['Console.WriteLine(checked((int)2147483648.0));','CS0220'],['Console.WriteLine(checked((int)(0.0/0.0)));','CS0221']]){
    const result=compile(text,{pipeline});assert.equal(result.success,false,text);assert(result.diagnostics.some(d=>d.code===code),JSON.stringify(result.diagnostics));
  }
});
