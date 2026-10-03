import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';
import {DebugSession,CilDebugSession} from '@sharpforge/debugger';
import {loadAssembly,formatILDocument,assembleILDocument} from '@sharpforge/cil';
import {ProjectSystem} from '@sharpforge/project-system';
import {samples} from '../apps/studio/samples.js';
const manifest=JSON.parse(readFileSync(new URL('../examples/features-0.9/manifest.json',import.meta.url),'utf8'));
for(const sample of manifest){
 for(const route of ['IR','canonical','direct','reassembled'])test(`0.9 shipped example ${sample.id}: ${route}`,()=>{
  assert.deepEqual(samples.find(s=>s.id===sample.id),sample);for(const file of sample.files)assert.equal(readFileSync(new URL(`../examples/features-0.9/${sample.id}/${file.uri}`,import.meta.url),'utf8'),file.text);
  const r=compileToIL(sample.files);assert(r.success,JSON.stringify(r.diagnostics));const vm=route==='IR'?new VirtualMachine(r.image):route==='canonical'?new VirtualMachine(loadAssembly(r.assembly)):new CilVirtualMachine(route==='reassembled'?assembleILDocument(formatILDocument(r.assembly)).bytes:r.assembly);
  const out=vm.run();assert.equal(out.state,'terminated',JSON.stringify(out.fault));assert.equal(out.output,sample.expectedOutput);
 });
 for(const Session of [DebugSession,CilDebugSession])test(`0.9 shipped debug setup ${sample.id}: ${Session.name}`,()=>{
  const r=compileToIL(sample.files),d=new Session(r.assembly);for(const [uri,bps]of Object.entries(sample.debug.breakpoints??{}))assert(d.setBreakpoints(uri,bps).every(b=>b.verified));assert(d.setFunctionBreakpoints(sample.debug.functionBreakpoints??[]).every(b=>b.verified));d.start(false);const s=d.runUntilStop();assert.equal(s.state,'paused');assert(['breakpoint','function breakpoint'].includes(s.reason.reason));assert(sample.files.some(f=>f.uri===s.point.uri));
 });
}
test('0.9 DebuggerWorkshop csproj/slnx compiles and maps caller and callee files',()=>{
 const root=new URL('../examples/projects/DebuggerWorkshop/',import.meta.url),files=readdirSync(root).map(path=>({path,text:readFileSync(new URL(path,root),'utf8')}));const p=new ProjectSystem(files),s=p.load('DebuggerWorkshop.slnx');assert.equal(s.diagnostics.length,0,JSON.stringify(s.diagnostics));const r=compileToIL(p.compilationFiles('DebuggerWorkshop.csproj'),p.compilationOptions('DebuggerWorkshop.csproj'));assert(r.success);assert.equal(new CilVirtualMachine(r.assembly).run().output,'42\n');const d=new DebugSession(r.assembly);d.setBreakpoints('Program.cs',[{line:6}]);d.start(false);assert.equal(d.runUntilStop().point.line,6);d.resume('stepIn');assert.equal(d.runUntilStop().point.uri,'Answers.cs');assert.equal(d.state().frames[1].line,6);
});
