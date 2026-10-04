import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {compile,compileToIL,Compilation} from '@sharpforge/compiler';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';
import {verifyImage} from '@sharpforge/bytecode';
import {SourceText} from '@sharpforge/text';
import {parse} from '@sharpforge/syntax';
import {MergedNamespaceSymbol} from '../packages/compiler/src/symbols/namespaces.js';
import {profileCodes} from '../packages/compiler/src/diagnostics/codes.js';
const files=sources=>Object.entries(sources).map(([uri,text])=>({uri,text}));
/** Compiles with both pipelines (they must agree), then runs the image on the bytecode VM and the assembly on the CIL VM. */
function run(sources,options={}){
  const input=files(sources);compile(input,{...options,pipeline:'verify'});const result=compile(input,options);assert.equal(result.success,true,JSON.stringify(result.diagnostics.map(d=>d.code+' '+d.message)));assert.deepEqual(verifyImage(result.image),[]);
  const output=new VirtualMachine(result.image).run();assert.equal(output.state,'terminated',output.fault?.stack);const il=compileToIL(input,options);assert.equal(il.success,true,JSON.stringify(il.diagnostics));assert.equal(new CilVirtualMachine(il.assembly).run().output,output.output);return {output:output.output,result};
}
const errors=(sources,options)=>compile(files(sources),options).diagnostics.filter(d=>d.severity==='error').map(d=>`${d.code}: ${d.message}`);
const lib={'A.cs':'namespace A { class Item { public static string Where(){ return "A"; } public int V = 1; } }','B.cs':'namespace B { class Item { public static string Where(){ return "B"; } public int V = 2; } }'};
test('A02-T16 same-named types in different namespaces compile and run',()=>{
  const {output,result}=run({...lib,'P.cs':'Console.WriteLine(A.Item.Where() + B.Item.Where()); A.Item a = new A.Item(); B.Item b = new B.Item(); Console.WriteLine(a.V + b.V);'});assert.equal(output,'AB\n3\n');
  assert.deepEqual(result.image.types.map(t=>t.name),['A.Item','B.Item'],'the image names both types by namespace');assert.deepEqual(result.symbols.filter(s=>s.kind==='class').map(s=>s.name),['Item','Item'],'IDE symbols keep the simple name');
  assert.equal(profileCodes.SF2011.retired,true);assert(!errors({'A.cs':'namespace A; partial class C {}','B.cs':'namespace B; partial class C {}','P.cs':'Console.WriteLine(1);'}).some(e=>e.startsWith('SF2011')));
});
test('A02-T16 a unique type name keeps its simple image name, so existing images do not change',()=>{
  const {result}=run({'A.cs':'namespace Deep.Space { class Only { public int V = 7; } }','P.cs':'Only o = new Only(); Console.WriteLine(o.V);'});assert.deepEqual(result.image.types.map(t=>t.name),['Only']);
  assert.equal(run({'A.cs':'namespace Deep.Space { class Only { public int V = 7; } }','P.cs':'Deep.Space.Only o = new Deep.Space.Only(); Console.WriteLine(o.V);'}).output,'7\n','and can be named by its qualified name');
});
test('A02-T16/T24 a using directive selects between same-named types; two usings are ambiguous (CS0104)',()=>{
  assert.equal(run({...lib,'P.cs':'using A; Item i = new Item(); Console.WriteLine(Item.Where() + i.V);'}).output,'A1\n');assert.equal(run({...lib,'P.cs':'using B; Item i = new Item(); Console.WriteLine(Item.Where() + i.V);'}).output,'B2\n');
  // Roslyn 5.3.0 reports every ambiguous use: the declared type and the created type.
  const ambiguous="CS0104: 'Item' is an ambiguous reference between 'A.Item' and 'B.Item'";
  assert.deepEqual(errors({...lib,'P.cs':'using A; using B; Item i = new Item(); Console.WriteLine(i.V);'}),[ambiguous,ambiguous]);
  assert.deepEqual(compile(files({...lib,'P.cs':'using A; using B; Item i = new Item(); Console.WriteLine(i.V);'})).diagnostics.map(x=>[x.uri,x.start,x.length]),[['P.cs',18,4],['P.cs',31,4]]);
  assert.deepEqual(errors({...lib,'P.cs':'using A; using B; Item i = null; Console.WriteLine(i == null);'}),[ambiguous]);
  assert.deepEqual(errors({...lib,'P.cs':'Item i = null; Console.WriteLine(i == null);'}),["CS0246: The type or namespace name 'Item' could not be found (are you missing a using directive or an assembly reference?)"],
    'without a using neither namespace is searched (Roslyn); the execution profile used to report both candidates as ambiguous');
  const d=compile(files({...lib,'P.cs':'using A; using B; Item i = null;'})).diagnostics.find(x=>x.code==='CS0104');assert.equal(d.uri,'P.cs');assert.deepEqual([d.start,d.length],[18,4],'reported on the type name, as Roslyn does');
});
test('A02-T24 enclosing namespaces win over using directives and outer namespaces',()=>{
  const sources={...lib,'C.cs':'namespace A { class UsesA { public static string Get(){ return Item.Where(); } } } namespace B { class UsesB { public static string Get(){ Item i = new Item(); return Item.Where() + i.V; } } }',
    'N.cs':'namespace A.Inner { class Item { public static string Where(){ return "A.Inner"; } } class Deep { public static string Get(){ return Item.Where(); } } class Outer { public static string Get(){ return A.Item.Where(); } } }','P.cs':'using B; Console.WriteLine(A.UsesA.Get() + " " + B.UsesB.Get() + " " + A.Inner.Deep.Get() + " " + A.Inner.Outer.Get() + " " + Item.Where());'};
  assert.equal(run(sources).output,'A B2 A.Inner A B\n');
});
test('A02-T24 using aliases name types and are scoped to their file',()=>{
  assert.equal(run({...lib,'P.cs':'using First = A.Item; using Second = B.Item; First f = new First(); Second s = new Second(); Console.WriteLine(First.Where() + Second.Where() + (f.V + s.V));'}).output,'AB3\n');
  assert.deepEqual(errors({...lib,'Q.cs':'using First = A.Item; class Q { }','P.cs':'First f = null; Console.WriteLine(f == null);'}),["CS0246: The type or namespace name 'First' could not be found (are you missing a using directive or an assembly reference?)"]);
});
test('A02-T16 a user type hides a framework type with the same simple name',()=>{
  assert.equal(run({'P.cs':'var p = new Shape(3); var b = new Button(); Console.WriteLine(p.Sides + b.Text); class Shape { public int Sides; public Shape(int s){ Sides = s; } } class Button { public string Text = "mine"; }'}).output,'3mine\n');
  assert.equal(compile('using Microsoft.UI.Xaml.Controls; var b = new Button(); b.Content = "x"; Console.WriteLine(1);').success,true,'the framework type is still found when no user type shadows it');
});
test('A02-T16 partial declarations merge per namespace and duplicates report per namespace',()=>{
  assert.equal(run({'A.cs':'namespace N { partial class C { public int X = 1; } }','B.cs':'namespace N { partial class C { public int Y = 2; public int Sum(){ return X + Y; } } }','P.cs':'N.C c = new N.C(); Console.WriteLine(c.Sum());'}).output,'3\n');
  assert.deepEqual(errors({'A.cs':'namespace N { class C { } class C { } }','P.cs':'Console.WriteLine(1);'}),["CS0101: The namespace 'N' already contains a definition for 'C'"]);
  assert.deepEqual(errors({'A.cs':'class C { } class C { }','P.cs':'Console.WriteLine(1);'}),["CS0101: The namespace '<global namespace>' already contains a definition for 'C'"]);
  assert.deepEqual(errors({'A.cs':'namespace N { class C { } }','B.cs':'namespace M { class C { } }','P.cs':'Console.WriteLine(1);'}),[],'the same name in two namespaces is not a duplicate');
  assert.deepEqual(errors({'A.cs':'namespace N { partial class C { } }','B.cs':'namespace N { class C { } }','P.cs':'Console.WriteLine(1);'}).map(e=>e.slice(0,6)),['CS0260']);
});
test('A02-T16 source types are symbols in the merged global namespace',()=>{
  const compilation=new Compilation(files({...lib,'P.cs':'Console.WriteLine(1);'}).map(f=>parse(new SourceText(f.text,f.uri))),{});compilation.build();const global=compilation.semantic.globalNamespace;
  assert(global instanceof MergedNamespaceSymbol);const a=global.lookupType('A.Item'),b=global.lookupType('B.Item');assert(a&&b&&a!==b);assert.equal(a.toDisplayString(),'A.Item');assert.equal(a.containingNamespace.qualifiedName,'A');assert.equal(a.legacy.name,'A.Item');
  assert.deepEqual(a.getMembers().filter(m=>!m.isImplicitlyDeclared).map(m=>m.toDisplayString()).sort(),['A.Item.V','A.Item.Where()']);assert.deepEqual(a.getMembers().filter(m=>m.isImplicitlyDeclared).map(m=>m.name),['<init>'],'the synthesized field initializer is a member too');assert.equal(global.lookupType('System.Text.StringBuilder').toDisplayString(),'System.Text.StringBuilder','framework types share the same tree');
  assert.equal(compilation.findType('Item',null),null,'ambiguous from the global scope');assert.equal(compilation.findType('Item',compilation.types[1]).fullName,'B.Item','resolved from inside namespace B');assert.deepEqual(compilation.lookupType('Item').ambiguous.map(t=>t.fullName),['A.Item','B.Item']);
});
test('A02-T16 no compiler module reports SF2011 any more',()=>{
  const root=fileURLToPath(new URL('../packages/compiler/src/',import.meta.url)),walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):e.name.endsWith('.js')?[join(dir,e.name)]:[]);
  for(const file of walk(root))if(!file.replaceAll('\\','/').endsWith('diagnostics/codes.js'))assert(!readFileSync(file,'utf8').includes('SF2011'),file);
});
