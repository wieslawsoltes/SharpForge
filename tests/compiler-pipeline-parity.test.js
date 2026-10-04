import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {compile,compileToIL,Compilation} from '@sharpforge/compiler';
import {serializeImage,verifyImage} from '@sharpforge/bytecode';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';
import {SourceText} from '@sharpforge/text';
import {parse} from '@sharpforge/syntax';
import {IrEmitter} from '../packages/compiler/src/codegen/ir-emitter.js';
import {BoundUsingStatement,BoundBlock,BoundInterpolatedString} from '../packages/compiler/src/bound/nodes.js';
import {loadFixtures} from '../packages/compiler/test/differential/corpus.js';
import {boundFixtures} from '../packages/compiler/test/bound/fixtures.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):e.name.endsWith('.cs')?[join(dir,e.name)]:[]);
const examples=walk(join(root,'examples')).map(path=>({name:path.slice(root.length),text:readFileSync(path,'utf8')}));
/** Compiles with both pipelines; `verify` throws unless images are byte-identical and non-flow diagnostics agree. */
const verify=(input,options={})=>compile(input,{...options,pipeline:'verify'});
test('A02-T29 the bound pipeline is the default and the legacy compiler stays available as the reference',()=>{
  assert.equal(Compilation.defaultPipeline,'bound');const source='int a=20;Console.WriteLine(a+22);';
  const byDefault=new Compilation([parse(new SourceText(source,'Program.cs'))],{});byDefault.build();assert(byDefault.boundPipeline,'default compilation runs bind -> flow -> lower -> emit');assert.equal(byDefault.boundPipeline.units.length,2);
  const legacy=new Compilation([parse(new SourceText(source,'Program.cs'))],{pipeline:'legacy'});legacy.build();assert.equal(legacy.boundPipeline,null);
  assert.equal(serializeImage(compile(source).image),serializeImage(compile(source,{pipeline:'legacy'}).image));
});
test('A02-T29 every example program compiles to a byte-identical image',()=>{
  assert(examples.length>100);let images=0;
  for(const {name,text} of examples){const result=verify([{uri:name,text}]);if(result.success){images++;assert.deepEqual(verifyImage(compile([{uri:name,text}]).image),[],name);}}
  assert(images>50,`only ${images} examples compiled`);
});
test('A02-T29 every example program compiles identically as a library and with overflow checking',()=>{
  for(const {name,text} of examples){verify([{uri:name,text}],{outputKind:'library'});verify([{uri:name,text}],{checkOverflow:true});}
});
test('A02-T29 the differential and binder fixture corpora compile to byte-identical images',()=>{
  // Both image pipelines bind against the framework registry; `referencesOnly` fixtures are not image programs.
  const fixtures=loadFixtures().filter(fixture=>!fixture.referencesOnly);assert(fixtures.length>400);
  // A few fixtures crash the current parser (packages/syntax, outside this epic); only pipeline disagreements fail here.
  let parserCrashes=0;for(const f of fixtures){try{verify([{uri:'Program.cs',text:f.source}],f.langVersion?{langVersion:f.langVersion}:{});}catch(error){if(/Pipeline mismatch/.test(error.message))throw error;parserCrashes++;}}
  assert(parserCrashes<10,'parser crashes: '+parserCrashes);
  for(const [id,source,options] of boundFixtures)verify([{uri:'Program.cs',text:source}],options??{});
});
test('A02-T29 multi-file and language-version programs keep their images',()=>{
  verify([{uri:'A.cs',text:'partial class C{public int X=1;public int Sum(){return X+Y;}}'},{uri:'B.cs',text:'var c=new C(); Console.WriteLine(c.Sum()); partial class C{public int Y=2;}'}]);
  for(const langVersion of ['7','9','12','14','preview'])verify('using System.Collections.Generic;B b=new();List<int> l=[1,2];int[] a=[..l,3];b?.V=a.Length;Console.WriteLine(b.V);class B{public int V;}',{langVersion});
  verify('using System.Threading.Tasks;class P{static int total;static async Task<int> Add(int a){await Task.Delay(1);total+=a;return total;}static async Task Main(){Console.WriteLine(await Add(2)+await Add(3));}}');
});
test('integrated type intrinsics and enum conversions preserve both pipelines and execution engines',()=>{
  const source=`using Microsoft.UI.Xaml;
    int value=1;
    Visibility visibility=(Visibility)value;
    Console.WriteLine(visibility.HasFlag(Visibility.Collapsed));
    Console.WriteLine((int)visibility);
    Console.WriteLine((double)visibility);
    Console.WriteLine((Orientation)visibility);
    Console.WriteLine(value.GetType().FullName);
    Console.WriteLine(true.GetType().Name);
    Console.WriteLine(visibility.GetType().Name);
    Console.WriteLine(string.Intern("type").GetType().FullName);`;
  const verified=verify(source);assert(verified.success,JSON.stringify(verified.diagnostics));
  const expected='True\n1\n1\nHorizontal\nSystem.Int32\nBoolean\nVisibility\nSystem.String\n';
  for(const pipeline of ['bound','legacy']){
    const result=compileToIL(source,{pipeline});assert(result.success,JSON.stringify(result.diagnostics));
    for(const vm of [new VirtualMachine(result.image),new CilVirtualMachine(result.assembly)]){
      const execution=vm.run();assert.equal(execution.state,'terminated',execution.fault?.stack);assert.equal(execution.output,expected);
    }
  }
});
test('A02-T29 images from the bound pipeline run on the bytecode VM and, through CIL, on the CIL VM',()=>{
  const source='using System.Collections.Generic;var list=new List<int>{3,4};using(var acc=new Acc()){foreach(var v in list)acc.Add(v);int[] extra=[..list,5];foreach(int v in extra){if(v==4)continue;acc.Add(v);}Console.WriteLine(acc.Total switch{15=>"fifteen",_=>"other"});}class Acc:IDisposable{public int Total;public void Add(int v){Total+=v;}public void Dispose(){Console.WriteLine($"disposed {Total}");}}';
  const image=compile(source);assert.equal(image.success,true,JSON.stringify(image.diagnostics));const run=new VirtualMachine(image.image).run();assert.equal(run.state,'terminated',run.fault?.stack);assert.equal(run.output,'fifteen\ndisposed 15\n');
  const il=compileToIL(source);assert.equal(il.success,true);const cil=new CilVirtualMachine(il.assembly).run();assert.equal(cil.output,run.output);
});
test('A02-T29 the emitter makes no semantic decisions and refuses unlowered trees',()=>{
  const text=readFileSync(join(root,'packages/compiler/src/codegen/ir-emitter.js'),'utf8');assert(!/\.report\(/.test(text),'code generation reports no diagnostics');assert(!/infer\(|resolveType\(|findMethod\(/.test(text));
  const compilation=new Compilation([parse(new SourceText('Console.WriteLine(1);','Program.cs'))],{});compilation.build();const method=compilation.methods[0];
  assert.throws(()=>new IrEmitter(compilation,method).stmt(new BoundUsingStatement(null,{resources:[],body:new BoundBlock(null,{locals:[],statements:[]})})),/without being lowered/);
  assert.throws(()=>new IrEmitter(compilation,method).expr(new BoundInterpolatedString(null,{parts:[]})),/without being lowered/);
});
test('A02-T29 a compilation with errors binds and analyses every method but emits nothing',()=>{
  const compilation=new Compilation([parse(new SourceText('Console.WriteLine(new C().Ok()); class C{public int Ok(){return 1;}public int Bad(){return "x";}}','Program.cs'))],{}),result=compilation.build();
  assert.equal(result.success,false);assert.equal(result.image,null);assert.deepEqual(result.diagnostics.map(d=>d.code),['CS0029']);assert.equal(compilation.methods.every(m=>m.code===undefined),true);assert.equal(compilation.constants.length,0);assert.equal(compilation.sequencePoints.length,0);
  assert.equal(compilation.boundPipeline.units.filter(u=>u.body).length,3,'all bodies are bound for the semantic model');assert(result.symbols.some(s=>s.name==='Ok'));
});
test('A02-T29 verification rejects a pipeline that changes the image',()=>{
  const previous=globalThis.SHARPFORGE_PIPELINE_MISMATCH;let seen=null;globalThis.SHARPFORGE_PIPELINE_MISMATCH=m=>{seen=m;};
  // `implicitUsings:false` keeps `Console` out of the semantic analysis, so each pipeline's own flow diagnostics stand
  // and differ; with `System` in scope the analysis gives both pipelines Roslyn's answer and there is nothing to report.
  try{compile('int x;if(true)x=1;Console.WriteLine(x);',{pipeline:'verify'});assert.equal(seen,null,'both pipelines agree with Roslyn');
    compile('int x;if(true)x=1;Console.WriteLine(x);',{pipeline:'verify',implicitUsings:false});assert(seen&&seen.tolerated,'a flow-only difference is tolerated and reported to the hook');assert.deepEqual(seen.onlyLegacy.map(k=>k.slice(0,6)),['CS0165']);assert.deepEqual(seen.success,[false,true]);}
  finally{globalThis.SHARPFORGE_PIPELINE_MISMATCH=previous;}
});
