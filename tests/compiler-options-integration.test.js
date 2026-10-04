import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,compileToIL,Compilation} from '@sharpforge/compiler';
import {SourceText} from '@sharpforge/text';
import {parse} from '@sharpforge/syntax';
import {CompilationOptions} from '../packages/compiler/src/options.js';
const source='int unused=1;try{}catch(Exception e){}Console.WriteLine(1);';
const run=(options,text=source)=>{const r=compile(text,options);return [r.success,...r.diagnostics.map(d=>d.code+':'+d.severity)];};
test('A02-T38 the compilation validates its options once and reports the Roslyn codes',()=>{
  assert.deepEqual(run({langVersion:'bogus'},'Console.WriteLine(1);'),[false,'CS1617:error']);assert.deepEqual(run({outputKind:'zzz'},'Console.WriteLine(1);'),[false,'CS2019:error']);
  assert.equal(compile('Console.WriteLine(1);',{langVersion:'bogus'}).diagnostics[0].message,"Invalid option 'bogus' for /langversion. Use '/langversion:?' to list supported values.");
  assert.deepEqual(run({checkOverflow:'yes'},'Console.WriteLine(1);'),[false,'SF2009:error'],'an API typing error keeps the SharpForge code');assert.deepEqual(run({outputKind:'winexe'},'Console.WriteLine(1);'),[false,'SF2008:error'],'a Roslyn-valid target this profile cannot produce');
  assert.deepEqual(run({langVersion:'bogus'},'C c=new(); Console.WriteLine(c); class C{}'),[false,'CS1617:error'],'the invalid version is reported once, not at every gated feature');
  for(const options of [{},{langVersion:'latest'},{langVersion:'12.0'},{outputKind:'library',name:'Lib'},{checkOverflow:true,langVersionByUri:{'Program.cs':'preview'}}])assert.equal(compile(options.outputKind?'public class L{}':'Console.WriteLine(1);',options).success,true,JSON.stringify(options));
  const compilation=new Compilation([parse(new SourceText('Console.WriteLine(1);'))],{checkOverflow:true,noWarn:'CS0168;219',name:'App'});compilation.build();
  assert(compilation.typedOptions instanceof CompilationOptions);assert.equal(compilation.typedOptions.checkOverflow,true);assert.equal(compilation.typedOptions.outputKind,'exe');assert.equal(compilation.options.name,'App','the raw options stay available to existing callers');
});
test('A02-T37 nowarn, warnaserror, warning level and TreatWarningsAsErrors shape the final diagnostic list',()=>{
  assert.deepEqual(run({}),[true,'CS0219:warning','CS0168:warning']);assert.deepEqual(run({noWarn:['CS0168']}),[true,'CS0219:warning']);assert.deepEqual(run({noWarn:'219;CS0168'}),[true]);
  assert.deepEqual(run({warnAsError:true}),[false,'CS0219:error','CS0168:error']);assert.deepEqual(run({warnAsError:['CS0219']}),[false,'CS0219:error','CS0168:warning']);assert.deepEqual(run({treatWarningsAsErrors:true}),[false,'CS0219:error','CS0168:error']);
  assert.deepEqual(run({treatWarningsAsErrors:true,noWarn:['CS0219','CS0168']}),[true],'suppressed warnings are not promoted');assert.deepEqual(run({warningLevel:2}),[true],'CS0168 and CS0219 are level 3 warnings');assert.deepEqual(run({warningLevel:3}),[true,'CS0219:warning','CS0168:warning']);
  assert.deepEqual(run({warningLevel:0},'return;Console.WriteLine(1);'),[true]);assert.deepEqual(run({warningLevel:2},'return;Console.WriteLine(1);'),[true,'CS0162:warning'],'unreachable code is a level 2 warning');
  assert.deepEqual(run({noWarn:['CS0029']},'int x="a";Console.WriteLine(x);'),[false,'CS0029:error'],'errors cannot be suppressed');
});
test('A02-T37 a warning promoted to an error fails the build on both back ends',()=>{
  const promoted=compile(source,{warnAsError:true});assert.equal(promoted.success,false);assert.equal(promoted.image,null);assert.equal(promoted.metrics.errors,2);
  const il=compileToIL(source,{warnAsError:true});assert.equal(il.success,false);assert.equal(il.assembly,null);assert.equal(compileToIL(source,{noWarn:['CS0168','CS0219']}).diagnostics.length,0);
});
