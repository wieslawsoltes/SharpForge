import {sampleSources} from './sample-sources.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {compile,compileToIL} from '@sharpforge/compiler';
import {VirtualMachine,CilVirtualMachine,ManagedHeap} from '@sharpforge/runtime';
import {AssemblyInspector,loadAssembly,formatILDocument,assembleILDocument,verifyCilAssembly} from '@sharpforge/cil';
import {Workspace} from '@sharpforge/workspace';
import {LanguageService} from '@sharpforge/language';
import {LanguageServer} from '@sharpforge/protocol';
import {RefactoringEngine} from '@sharpforge/refactoring';
import {findTextMatches} from '@sharpforge/text';
import {ProjectSystem,DiskWorkspace} from '@sharpforge/project-system';
import {ExtensionDriver,JsonSchemaGenerator} from '@sharpforge/extensions';
import {samples} from '../apps/studio/samples.js';
const ok=r=>{assert(r.success,JSON.stringify(r.diagnostics));return r;};
const ws=text=>{const w=new Workspace();w.update('Program.cs',text,1);return w;};
async function executeBoth(source,expected,options){const r=ok(compileToIL(source,options));for(const vm of [new VirtualMachine(r.image,{virtualTime:true}),new VirtualMachine(r.assembly,{virtualTime:true}),new CilVirtualMachine(r.assembly,{virtualTime:true})]){const e=await vm.runAsync();assert.equal(e.fault,null);assert.equal(e.output,expected);}}
for(const sample of samples.filter(s=>s.expectedOutput))test('0.4 example exact output on IR / loader / direct CIL: '+sample.id,()=>executeBoth(sampleSources(sample),sample.expectedOutput,sample.compilationOptions));
for(const [name,source,expected]of [
 ['unassigned name','int unassigned;Console.WriteLine(nameof(unassigned));','unassigned\n'],
 ['method group','Console.WriteLine(nameof(C.M)); class C { public static int M(){return 1;} public static int M(int x){return x;} }','M\n'],
 ['instance name no dereference','C c=null; Console.WriteLine(nameof(c.Value)); class C {public int Value;}','Value\n'],
 ['shadowed contextual method','string nameof(int value){return "method";} Console.WriteLine(nameof(42));','method\n'],
 ['nameof in switch','string s="x";int x=0; switch(s){case nameof(x):Console.WriteLine(42);break;}','42\n'],
 ['file namespace partial',[{uri:'A.cs',text:'namespace Demo; public partial class C { public static int Add(){return Value;} }'},{uri:'B.cs',text:'namespace Demo; public partial class C { public static int Value=42; } class Program { static void Main(){Console.WriteLine(C.Add());} }'}],'42\n'],
])test('0.4 C# '+name,()=>executeBoth(source,expected));
for(const [name,source,code] of [
 ['unknown nameof','Console.WriteLine(nameof(Unknown));','CS0103'],
 ['invalid nameof expression','Console.WriteLine(nameof(1+2));','CS8081'],
 ['partial missing marker',[{uri:'A.cs',text:'partial class C {}'},{uri:'B.cs',text:'class C {}'}],'CS0260'],
 ['partial access conflict',[{uri:'A.cs',text:'public partial class C {}'},{uri:'B.cs',text:'internal partial class C {}'}],'CS0262'],
 ['distinct namespaces not conflated',[{uri:'A.cs',text:'namespace A; partial class C {}'},{uri:'B.cs',text:'namespace B; partial class C {}'}],'CS5001'],
 ['partial methods rejected','partial class C { partial void M(); }','SF2010'],
])test('0.4 C# explicit diagnostic '+name,()=>{const r=compile(source);assert(!r.success);assert(r.diagnostics.some(d=>d.code===code),JSON.stringify(r.diagnostics));});
test('0.4 partial cached syntax is not mutated by repeated compilation',()=>{const w=ws('Console.WriteLine(C.M());partial class C {public static int M(){return 42;}}');w.update('C.cs','partial class C {public int Value;}',1);const before=JSON.stringify(w.syntax('Program.cs').root);for(let i=0;i<4;i++){ok(w.compile({name:'Build'+i}));assert.equal(JSON.stringify(w.syntax('Program.cs').root),before);}});
const librarySource='public class MathLib { public static int Bias=40; public static int Add(int a,int b){return Bias+a+b;} }';
for(const debug of [true,false])test('0.4 library no Main, real cctor, roundtrip and invocation debug='+debug,()=>{const r=ok(compileToIL(librarySource,{outputKind:'library',includeDebug:debug})),inspector=new AssemblyInspector(r.assembly);assert.equal(inspector.pe.entryPoint,0);const vm=new CilVirtualMachine(r.assembly,{methodToken:'MathLib::Add',arguments:[1,1]});const e=vm.run();assert.equal(e.fault,null);assert.equal(e.returnValue,42);const rebuilt=assembleILDocument(formatILDocument(r.assembly));assert.equal(new CilVirtualMachine(rebuilt.bytes,{methodToken:'MathLib::Add',arguments:[2,3]}).run().returnValue,45);if(debug)assert.equal(loadAssembly(r.assembly).entryPoint,null);});
test('0.4 library permits empty class',()=>ok(compileToIL('public class Empty {}',{outputKind:'library'})));
test('0.4 library rejects top-level executable statements',()=>{const r=compile('Console.WriteLine(1);',{outputKind:'library'});assert(r.diagnostics.some(d=>d.code==='CS8805'));});
test('0.4 library treats Main as ordinary method',()=>{const r=ok(compileToIL('class A {public static int Main(){return 1;}}class B {public static int Main(){return 2;}}',{outputKind:'library'}));assert.equal(new CilVirtualMachine(r.assembly,{methodToken:'B::Main'}).run().returnValue,2);});
test('0.4 library workspace keeps compiler options during refactor validation',()=>{const w=new Workspace({compilationOptions:{outputKind:'library'}});w.update('Library.cs','class C { public static int M(){var count=42;return count;} }',1);const r=new RefactoringEngine(w);ok(w.compile());const a=r.actions('Library.cs',40);assert(a.length);r.apply(a[0]);ok(w.compile());});
const search=(text,query,options={})=>findTextMatches([{uri:'Text.cs',text,version:7}],query,options);
for(const [name,text,query,options,starts]of [
 ['literal punctuation','a.b a+b a.b','a.b',{},[0,8]],
 ['unicode case offset','İ a A a','a',{},[2,4,6]],
 ['surrogate UTF16','😀 Foo foo','foo',{},[3,7]],
 ['whole word unicode','x αx xα x_ x','x',{wholeWord:true},[0,11]],
 ['case sensitive','a A a','a',{matchCase:true},[0,4]],
 ['empty query','abc','',{},[]],
])test('0.4 bounded literal search '+name,()=>assert.deepEqual(search(text,query,options).matches.map(x=>x.start),starts));
test('0.4 search correct line positions after skipped whole-word matches',()=>{const r=search('fooX\nfoo\nfoo','foo',{wholeWord:true});assert.deepEqual(r.matches.map(m=>[m.line,m.character,m.version]),[[1,0,7],[2,0,7]]);});
test('0.4 search bounds distinguish exact count from truncated result',()=>{assert.equal(search('a a','a',{maxMatches:2}).truncated,false);assert.equal(search('a a a','a',{maxMatches:2}).truncated,true);});
test('0.4 search cancellation and limits',()=>{const c=new AbortController();c.abort();assert.throws(()=>search('a','a',{signal:c.signal}),/cancelled/);assert.throws(()=>search('a','a',{maxMatches:0}));assert.throws(()=>search('a','x'.repeat(1025)));});
test('0.4 versioned replace-all across two files',()=>{const w=ws('class Program {static void Main(){Console.WriteLine(Value.Get());}}');w.update('Value.cs','class Value {public static int Get(){return 42;}}',3);const r=new RefactoringEngine(w);const action=r.replaceAll('Value','Number',{wholeWord:true});assert.equal(action.edits.length,2);r.apply(action);ok(w.compile());assert.match(w.documents.get('Value.cs').source.text,/class Number/);});
test('0.4 replace-all will not partially apply a truncated search',()=>{const w=ws('// '+'match '.repeat(10001));assert.throws(()=>new RefactoringEngine(w).replaceAll('match','x'),/limit|truncat|too many/i);});
const callsSource='class C { static int Add(int a,int b){return a+b;} static int Twice(int x){return Add(x,x);} static void Main(){Console.WriteLine(Twice(21));Console.WriteLine(nameof(Add));} }';
test('0.4 call hierarchy excludes nameof from execution edges',()=>{const w=ws(callsSource),l=new LanguageService(w),[add]=l.callHierarchy('Program.cs',callsSource.indexOf('Add'));assert.equal(l.calls(add,'incoming').length,1);assert.equal(l.calls(add,'incoming')[0].item.name,'Twice');assert.equal(l.calls(add,'outgoing').length,0);assert.equal(l.referenceLenses('Program.cs').find(x=>x.start===callsSource.indexOf('Add')).count,2);});
test('0.4 call hierarchy rejects stale symbols',()=>{const w=ws(callsSource),l=new LanguageService(w),[add]=l.callHierarchy('Program.cs',callsSource.indexOf('Add'));w.update('Program.cs',callsSource+' ',2);assert.throws(()=>l.calls(add),/stale/);});
test('0.4 LSP call-hierarchy and reference lenses wire shapes',async()=>{const server=new LanguageServer({workspace:ws(callsSource)}),request=(method,params)=>server.handle({jsonrpc:'2.0',id:1,method,params}),init=await request('initialize',{});assert(init.result.capabilities.callHierarchyProvider);const prepared=await request('textDocument/prepareCallHierarchy',{textDocument:{uri:'Program.cs'},position:{line:0,character:callsSource.indexOf('Twice')}});assert(!prepared.error,JSON.stringify(prepared));assert.equal(prepared.result[0].name,'Twice');const incoming=await request('callHierarchy/incomingCalls',{item:prepared.result[0]});assert.equal(incoming.result[0].from.name,'Main');const outgoing=await request('callHierarchy/outgoingCalls',{item:prepared.result[0]});assert.equal(outgoing.result[0].to.name,'Add');const lenses=await request('textDocument/codeLens',{textDocument:{uri:'Program.cs'}});assert(lenses.result.some(x=>x.command.title==='2 references'));});
test('0.4 heap census sums sizes and type counts',()=>{const h=new ManagedHeap(),a=h.object('A',[1]),b=h.object('A',[2]),c=h.string('hello');const census=h.census();assert.equal(census.objects,3);assert.equal(census.types.find(x=>x.type==='A').objects,2);assert.equal(census.types.reduce((n,x)=>n+x.bytes,0),h.stats.liveBytes);assert.equal(h.stats.allocatedBytes,h.stats.liveBytes);});
test('0.4 heap paging sorted and complete without duplicate handles',()=>{const h=new ManagedHeap();for(let i=0;i<513;i++)h.string(String(i));const items=[];let page=h.inspectPage({limit:100});for(;;){items.push(...page.items);if(page.next===null)break;page=h.inspectPage({limit:100,afterHandle:page.next,stamp:page.stamp});}assert.equal(items.length,513);assert.equal(new Set(items.map(x=>x.handle)).size,513);assert.equal(h.inspectPage({kind:'object'}).items.length,0);});
test('0.4 heap stale pages invalidated by allocation, collection and restore',()=>{const h=new ManagedHeap();h.string('one');const snapshot=h.snapshot();let stamp=h.stamp();h.string('two');assert.throws(()=>h.inspectPage({stamp}),/changed/);stamp=h.stamp();h.collect();assert.throws(()=>h.inspectPage({stamp}),/changed/);stamp=h.stamp();h.restore(snapshot);assert.throws(()=>h.inspectPage({stamp}),/changed/);});
test('0.4 heap generations do not alias abandoned debugger future',()=>{const h=new ManagedHeap(),snapshot=h.snapshot(),future=h.string('future');h.restore(snapshot);const present=h.string('present');assert.equal(present.h,future.h);assert.notEqual(present.g,future.g);assert.throws(()=>h.get(future),/Stale/);});
test('0.4 heap retention path traces strong roots and fields, not weak handles',()=>{const h=new ManagedHeap(),leaf=h.string('leaf'),root=h.object('Root',[leaf]);const strong=h.createHandle(root),weak=h.createHandle(leaf,{weak:true});const p=h.retentionPath(leaf);assert(p.reachable);assert.equal(p.path.length,2);h.releaseHandle(strong);assert.equal(h.retentionPath(leaf).reachable,false);h.collect();assert.equal(h.getHandle(weak),null);assert.equal(h.stats.hostStrongHandles,0);assert.equal(h.stats.hostWeakHandles,1);});
test('0.4 heap retention diagnostics are bounded for cycles',()=>{const h=new ManagedHeap(),a=h.object('A',[null]),b=h.object('B',[a]),target=h.string('target');h.get(a).data[0]=b;h.rootProvider=()=>[a];assert.equal(h.retentionPath(target,{maxObjects:1}).truncated,true);assert.equal(h.retentionPath(target).reachable,false);});
test('0.4 heap validates page and traversal budgets',()=>{const h=new ManagedHeap(),r=h.string('x');assert.throws(()=>h.inspectPage({limit:1001}),RangeError);assert.throws(()=>h.retentionPath(r,{maxObjects:0}),RangeError);assert.throws(()=>new ManagedHeap({maxBytes:-1}),RangeError);});
test('0.4 write permissions resolved before any streams open',async()=>{let writes=0;const h={getFile:async()=>({text:async()=>''}),queryPermission:async()=> 'prompt',requestPermission:async()=> 'denied',createWritable:async()=>{writes++;}};const disk=new DiskWorkspace([{path:'A.cs',text:''}],new Map([['A.cs',h]]));await assert.rejects(disk.save([{path:'A.cs',text:'changed'}]),/permission denied/);assert.equal(writes,0);});
test('0.4 disk conflict rechecked after permission prompt',async()=>{let text='',writes=0;const h={getFile:async()=>({text:async()=>text}),queryPermission:async()=> 'prompt',requestPermission:async()=>{text='other';return 'granted';},createWritable:async()=>{writes++;}};const disk=new DiskWorkspace([{path:'A.cs',text:''}],new Map([['A.cs',h]]));await assert.rejects(disk.save([{path:'A.cs',text:'changed'}]),/Disk conflict/);assert.equal(writes,0);});
const manifest=JSON.parse(await readFile(new URL('../examples/coverage.json',import.meta.url),'utf8')),records=[];
async function collect(base,prefix=''){for(const f of await readdir(base,{withFileTypes:true})){if(f.isDirectory())await collect(new URL(f.name+'/',base),prefix+f.name+'/');else records.push({path:prefix+f.name,text:await readFile(new URL(f.name,base),'utf8')});}}
await collect(new URL('../examples/projects/',import.meta.url));
for(const fixture of manifest.projects)test('0.4 disk project example '+fixture.entry+' '+(fixture.configuration??''),()=>{const system=new ProjectSystem(records,{configuration:fixture.configuration??'Debug'}),snapshot=system.load(fixture.entry),startup=fixture.startup??snapshot.solution.projectPaths[0];if(fixture.diagnostic){assert(snapshot.diagnostics.some(d=>d.code===fixture.diagnostic));return;}assert(!snapshot.diagnostics.some(d=>d.severity==='error'),JSON.stringify(snapshot.diagnostics));const files=system.compilationFiles(startup);let r;if(fixture.generator){const w=new Workspace({extensions:new ExtensionDriver().registerGenerator(JsonSchemaGenerator),additionalFiles:system.projects.get(startup).additionalFiles.map(path=>({uri:path,text:system.files.get(path).text}))});for(const f of files)w.update(f.uri,f.text,1);r=ok(w.compile());assert.equal(new VirtualMachine(r.image).run().output,fixture.output);return;}r=ok(compileToIL(files,{outputKind:fixture.outputKind??'exe'}));const e=new CilVirtualMachine(r.assembly,{methodToken:fixture.method,arguments:fixture.arguments}).run();assert.equal(e.fault,null);if(fixture.method)assert.equal(e.returnValue,fixture.returnValue);else assert.equal(e.output,fixture.output);});
for(const [name,args,expected,status]of [
 ['solution run',['run','examples/projects/Workshop/Workshop.slnx'],'42\n',0],
 ['linked sources',['run','examples/projects/Linked/Linked.csproj'],'42\n',0],
 ['release configuration',['run','examples/projects/Configurations/Configurations.csproj','--configuration','Release'],'Release\n',0],
 ['library invocation',['run','examples/projects/Library/Library.csproj','--method','Arithmetic::Add','--args','[1,1]'],'Return: 42',0],
 ['unsupported package blocks build',['check','examples/projects/Unsupported/Unsupported.csproj'],'SFP1102',1],
 ['project information',['project-info','examples/projects/Workshop/Workshop.slnx'],'buildOrder',0],
])test('0.4 CLI '+name,()=>{const p=spawnSync(process.execPath,['apps/cli/main.js',...args],{encoding:'utf8'});assert.equal(p.status,status,p.stderr);assert((p.stdout+p.stderr).includes(expected),p.stdout+p.stderr);});
