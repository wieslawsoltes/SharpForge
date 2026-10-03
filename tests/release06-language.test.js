import {cases,resource,diagnosticCases} from './fixtures/language/release06.js';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {sampleSources} from './sample-sources.js';
import assert from 'node:assert/strict';
import {compile,compileToIL,evaluateConstant} from '@sharpforge/compiler';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';
import {loadAssembly,formatILDocument,assembleILDocument,AssemblyInspector} from '@sharpforge/cil';
import {parseExpression} from '@sharpforge/syntax';
for(const [name,source,output] of cases)for(const route of ['IR','canonical','direct','edited'])test(`0.6 language: ${name} / ${route}`,()=>{
 const r=compileToIL(source);assert(r.success,JSON.stringify(r.diagnostics));
 const vm=route==='IR'?new VirtualMachine(r.image):route==='canonical'?new VirtualMachine(loadAssembly(r.assembly)):new CilVirtualMachine(route==='edited'?assembleILDocument(formatILDocument(r.assembly)).bytes:r.assembly);
 const result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,output);
});
for(const [name,source,code] of diagnosticCases)test(`0.6 language diagnostic: ${name}`,()=>{const r=compile(source);assert(!r.success);assert(r.diagnostics.some(d=>d.code===code),JSON.stringify(r.diagnostics));});
test('0.6 real IDisposable metadata survives canonical reload',()=>{const r=compileToIL('using var r=new R(1);'+resource);assert(r.success);const inspect=new AssemblyInspector(r.assembly),type=inspect.types.find(t=>t.name==='R');assert.equal(inspect.metadata.typeName(type.interfaces[0]),'System.IDisposable');const dispose=type.methods.find(m=>m.name==='Dispose');assert.equal(dispose.flags&0x1e6,0x1e6);assert.deepEqual(loadAssembly(r.assembly).types.find(t=>t.name==='R').interfaces,['System.IDisposable']);});
test('0.6 constant evaluator has an explicit budget',()=>{const ast=parseExpression('1+2*3').expression;assert.deepEqual(evaluateConstant(ast),{type:'int',value:7});assert.equal(evaluateConstant(ast,{maxNodes:1}),null);});

// Execute the actual delivered examples, including real generated source, after IL export/reassembly.
const releaseExamples = JSON.parse(readFileSync(new URL('../examples/features-0.6/manifest.json', import.meta.url), 'utf8'));
for (const sample of releaseExamples) test(`0.6 delivered example: ${sample.id} / rebuilt IL without #SF`, () => {
  const result = compileToIL(sampleSources(sample), {includeDebug: false});
  assert(result.success, JSON.stringify(result.diagnostics));
  assert(!new AssemblyInspector(result.assembly).metadata.streams.has('#SF'));
  const rebuilt = assembleILDocument(formatILDocument(result.assembly)).bytes;
  const actual = new CilVirtualMachine(rebuilt).run();
  assert.equal(actual.state, 'terminated', actual.fault?.stack);
  assert.equal(actual.output, sample.expectedOutput);
});
