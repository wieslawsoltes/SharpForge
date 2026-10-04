import test from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '@sharpforge/compiler';
import {VirtualMachine} from '@sharpforge/runtime';
import {findEntryPoint,entryPointSignature} from '../packages/compiler/src/binder/entry-point.js';
import {formatMessage,diagnosticDescriptor} from '../packages/compiler/src/diagnostics/codes.js';
import {loadFixtures,loadPinned} from '../packages/compiler/test/differential/corpus.js';
import {runFixture} from '../packages/compiler/test/differential/harness.js';
/** Compiles with both pipelines (they must agree) and returns `[success, 'CODE:severity message', ...]`. */
const check=(source,options={})=>{compile(source,{...options,pipeline:'verify'});const r=compile(source,options);return [r.success,...r.diagnostics.map(d=>`${d.code}:${d.severity} ${d.message}`)];};
const output=(source,options)=>{const r=compile(source,options);assert.equal(r.success,true,JSON.stringify(r.diagnostics));return new VirtualMachine(r.image).run().output;};
const method=(name,returnType,parameters=[],extra={})=>({name,qualifiedName:(extra.owner?extra.owner.name+'.':'')+name,returnType,parameters:parameters.map(type=>({type})),isStatic:true,synthetic:false,owner:null,node:{uri:'a.cs',start:extra.start??0,end:(extra.start??0)+1},...extra});
test('A02-T41 entry-point fixtures match Roslyn selection, diagnostics and spans',()=>{
  const pinned=loadPinned(),own=loadFixtures().filter(f=>f.feature==='entry-point');assert(own.length>=10);
  for(const fixture of own){const row=runFixture(fixture,pinned.results.get(fixture.id));assert.equal(row.unsupported,false,fixture.id+': '+JSON.stringify(row.details));assert.equal(row.diagnostics&&row.warnings,true,fixture.id+': '+JSON.stringify(row.details));if(fixture.kind==='output')assert.equal(row.bytecode&&row.cil,true,fixture.id+': '+JSON.stringify(row.details));}
});
test('A02-T41 Main signatures: void or int, no parameters or string[] args, optionally Task-returning',()=>{
  const sig=(returnType,parameters)=>entryPointSignature(method('Main',returnType,parameters));
  assert.deepEqual(sig('void',[]),{valid:true,isAsync:false,returnsInt:false});assert.deepEqual(sig('int',['string[]']),{valid:true,isAsync:false,returnsInt:true});
  assert.deepEqual(sig('System.Threading.Tasks.Task',[]),{valid:true,isAsync:true,returnsInt:false});assert.deepEqual(sig('System.Threading.Tasks.Task`1<int>',['string[]']),{valid:true,isAsync:true,returnsInt:true});
  for(const [returnType,parameters] of [['string',[]],['void',['int']],['void',['string[]','int']],['double',[]],['System.Threading.Tasks.Task`1<string>',[]],['void',['string']]])assert.equal(sig(returnType,parameters).valid,false,returnType+' Main('+parameters+')');
});
test('A02-T41 one suitable Main is selected; several report CS0017 on the first in source order',()=>{
  assert.equal(output('class P{static void Main(){Console.WriteLine("main");}}'),'main\n');assert.equal(output('class P{static int Main(string[] args){Console.WriteLine(args.Length);return 0;}}'),'0\n');
  assert.deepEqual(check('class A{static void Main(){}}class B{static void Main(){}}'),[false,'CS0017:error Program has more than one entry point defined. Compile with /main to specify the type that contains the entry point.']);
  const d=compile('class A{static void Main(){}}class B{static void Main(){}}').diagnostics[0];assert.deepEqual([d.start,d.length],[20,4],'reported on the name of the first Main');
  const two=findEntryPoint({methods:[method('Main','void',[],{start:50}),method('Main','void',[],{start:10})]});assert.equal(two.method.node.start,10);assert.deepEqual(two.diagnostics.map(x=>[x.code,x.node.start]),[['CS0017',10]]);
});
test('A02-T41 a Main with the wrong signature is a CS0028 warning and not an entry point',()=>{
  assert.deepEqual(check('class A{static void Main(int x){}}'),[false,"CS0028:warning 'A.Main(int)' has the wrong signature to be an entry point","CS5001:error Program does not contain a static 'Main' method suitable for an entry point"]);
  assert.deepEqual(check('class A{static void Main(int x){}}class B{static void Main(){Console.WriteLine(1);}}'),[true,"CS0028:warning 'A.Main(int)' has the wrong signature to be an entry point"],'the suitable Main is still used');
  assert.equal(output('class A{static string Main(){return "no";}}class B{static void Main(){Console.WriteLine("B");}}'),'B\n');
  assert.equal(diagnosticDescriptor('CS0028').severity,'warning');assert.equal(diagnosticDescriptor('CS0028').warningLevel,4);
  assert.deepEqual(check('class A{void Main(){}}'),[false,"CS5001:error Program does not contain a static 'Main' method suitable for an entry point"],'an instance Main is not a candidate');
  assert.deepEqual(check('class A {}'),[false,"CS5001:error Program does not contain a static 'Main' method suitable for an entry point"]);
});
test('A02-T41 async Main needs C# 7.1 and loses to a synchronous Main',()=>{
  const asyncMain='using System.Threading.Tasks;class A{static async Task Main(){await Task.Delay(1);Console.WriteLine("async");}}';
  // Async programs need the scheduler to pump; here it is enough that the Task-returning Main is the entry point.
  assert.deepEqual(check(asyncMain),[true]);const image=compile(asyncMain).image,startup=image.methods[image.entryPoint];assert.equal(startup.name,'<startup>');assert.equal(startup.returnType,'void');
  assert.deepEqual(check('using System.Threading.Tasks;class A{static async Task<int> Main(string[] args){await Task.Delay(1);return 3;}}'),[true]);
  assert.deepEqual(check(asyncMain,{langVersion:'7'}),[false,"CS8107:error Feature 'async main' is not available in C# 7.0. Please use language version 7.1 or greater.","CS5001:error Program does not contain a static 'Main' method suitable for an entry point"]);
  assert.equal(check(asyncMain,{langVersion:'8'})[0],true);
  // CS8892 is a level 5 warning (warning wave 5): hidden at the default level 4, as in Roslyn.
  assert.deepEqual(check(asyncMain+'class B{static void Main(){Console.WriteLine("sync");}}',{warningLevel:5}),[true,"CS8892:warning Method 'A.Main()' will not be used as an entry point because a synchronous entry point 'B.Main()' was found."]);assert.deepEqual(check(asyncMain+'class B{static void Main(){Console.WriteLine("sync");}}'),[true]);assert.equal(diagnosticDescriptor('CS8892').warningLevel,5);
  assert.equal(output(asyncMain+'class B{static void Main(){Console.WriteLine("sync");}}'),'sync\n');
  assert.deepEqual(check('class A{static async void Main(){}}'),[false,'CS4009:error A void or int returning entry point cannot be async']);
});
test('A02-T41 top-level statements are the entry point; Main is then ignored with CS7022',()=>{
  assert.equal(output('Console.WriteLine("top");'),'top\n');
  assert.deepEqual(check('Console.WriteLine("top"); class A{static void Main(){Console.WriteLine("main");}}'),[true,"CS7022:warning The entry point of the program is global code; ignoring 'A.Main()' entry point."]);
  assert.equal(output('Console.WriteLine("top"); class A{static void Main(){Console.WriteLine("main");}}'),'top\n');
  assert.deepEqual(check([{uri:'A.cs',text:'Console.WriteLine(1);'},{uri:'B.cs',text:'Console.WriteLine(2);'}]).slice(0,2),[false,'CS8802:error Only one compilation unit can have top-level statements.']);
  const second=compile([{uri:'A.cs',text:'Console.WriteLine(1);'},{uri:'B.cs',text:'Console.WriteLine(2);'}]).diagnostics.find(d=>d.code==='CS8802');assert.equal(second.uri,'B.cs');
  assert.deepEqual(check('Console.WriteLine(1);',{outputKind:'library'}).slice(0,2),[false,'CS8805:error Program using top-level statements must be an executable.']);
  assert.deepEqual(check('public class L{public static void Main(int bad){}}',{outputKind:'library'}),[true],'a library has no entry point and says nothing about Main');
});
test('A02-T41 the main-type option selects among several Mains',()=>{
  const two='class A{static void Main(){Console.WriteLine("A");}}class B{static void Main(){Console.WriteLine("B");}}';
  assert.equal(output(two,{mainTypeName:'B'}),'B\n');assert.equal(output(two,{mainTypeName:'A'}),'A\n');assert.equal(output('namespace N{class A{static void Main(){Console.WriteLine("N.A");}}}class B{static void Main(){}}',{mainTypeName:'N.A'}),'N.A\n');
  assert.deepEqual(check(two,{mainTypeName:'Zed'}),[false,"CS1555:error Could not find 'Zed' specified for Main method"]);assert.deepEqual(check('class A{static void Main(int x){}}class B{static void Main(){}}',{mainTypeName:'A'}),[false,"CS1558:error 'A' does not have a suitable static 'Main' method"]);
});
test('A02-T41 findEntryPoint is a pure function over declaration records',()=>{
  const none=findEntryPoint({methods:[],root:{uri:'a.cs',start:0,end:0}});assert.deepEqual([none.kind,none.method,none.diagnostics.map(d=>d.code)],[null,null,['CS5001']]);assert.equal(none.diagnostics[0].node.uri,'a.cs');
  const helper=method('Helper','void'),main=method('Main','int',['string[]']),found=findEntryPoint({methods:[helper,main]});assert.equal(found.kind,'main');assert.equal(found.method,main);assert.deepEqual(found.diagnostics,[]);
  const top=findEntryPoint({methods:[main],topLevel:[{file:{root:{uri:'t.cs'}},statements:[{}]}]});assert.equal(top.kind,'topLevel');assert.deepEqual(top.diagnostics.map(d=>[d.code,formatMessage(d.code,d.args)]),[['CS7022',"The entry point of the program is global code; ignoring 'Main(string[])' entry point."]]);
  const gated=findEntryPoint({methods:[method('Main','System.Threading.Tasks.Task')],asyncMainAvailable:()=>false});assert.deepEqual([gated.kind,gated.diagnostics.map(d=>d.code)],[null,['CS5001']]);
  assert.deepEqual(findEntryPoint({methods:[method('Main','void',[],{synthetic:true})]}).diagnostics.map(d=>d.code),['CS5001'],'synthesized methods are never entry points');
});
