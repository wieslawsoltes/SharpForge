import {cases,diagnosticCases} from './fixtures/language/release05.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,compileToIL} from '@sharpforge/compiler';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';
import {loadAssembly,AssemblyInspector,formatILDocument,assembleILDocument} from '@sharpforge/cil';

for (const [name,source,expected] of cases) for (const path of ['IR','canonical CIL','direct CIL','edited CIL']) test(`0.5 language: ${name} / ${path}`,()=>{
 const r=compileToIL(source);assert(r.success,JSON.stringify(r.diagnostics));
 const vm=path==='IR'?new VirtualMachine(r.image):path==='canonical CIL'?new VirtualMachine(loadAssembly(r.assembly)):new CilVirtualMachine(path==='edited CIL'?assembleILDocument(formatILDocument(r.assembly)).bytes:r.assembly);
 const result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,expected);
});
for(const [name,source,code] of diagnosticCases)test('0.5 diagnostic: '+name,()=>{const r=compile(source);assert.equal(r.success,false);assert(r.diagnostics.some(d=>d.code===code),JSON.stringify(r.diagnostics));});
test('0.5 metadata: property maps and method semantics survive canonical loading',()=>{
 const r=compileToIL('Console.WriteLine(C.Count); class C {public int X{get;private set;} public static int Count{get;set;}=3;}');assert(r.success);
 const i=new AssemblyInspector(r.assembly);assert.equal(i.metadata.rows[23].length,2);assert.equal(i.metadata.rows[24].length,4);
 const loaded=loadAssembly(r.assembly),c=loaded.types.find(t=>t.name==='C');assert.equal(c.properties.length,2);assert(c.fields.some(f=>f.backing));
});
