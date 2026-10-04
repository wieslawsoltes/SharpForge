import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import * as api from '@sharpforge/compiler';
import {MethodCompiler} from '../packages/compiler/src/method-compiler.js';
import {Compilation} from '../packages/compiler/src/compilation.js';
import * as utils from '../packages/compiler/src/type-utils.js';
const root=fileURLToPath(new URL('../packages/compiler/src/',import.meta.url));
const sources=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?sources(join(dir,e.name)):e.name.endsWith('.js')?[join(dir,e.name)]:[]);
test('A02-T13 index.js only re-exports the public API',()=>{
  const lines=readFileSync(join(root,'index.js'),'utf8').split('\n').filter(l=>l.trim());
  for(const line of lines)assert.match(line,/^export \{[^}]+\} from '\.\/[\w./-]+';$/,line);
  for(const name of ['compile','compileToIL','Compilation','assignable','evaluateConstant','ConstantError','languageVersion'])assert.equal(typeof api[name],'function',name);
});
test('A02-T13 no compiler module patches a prototype',()=>{
  for(const file of sources(root)){const text=readFileSync(file,'utf8');assert(!/\.prototype\b/.test(text),file+' touches a prototype');assert(!/Object\.assign\(\s*\w+\.prototype/.test(text),file);}
});
test('A02-T13 method compiler is composed from explicit class layers',()=>{
  const chain=[];for(let p=MethodCompiler;p&&p!==Function.prototype;p=Object.getPrototypeOf(p))chain.push(p.name);
  assert.deepEqual(chain,['MethodCompiler','CallScopedInference','ModernCompiler','FrameworkCompiler','CoreMethodCompiler']);
  for(const name of ['expr','stmt','infer','typedExpr','frameworkCall','collectionExpression','findMethod'])assert.equal(typeof MethodCompiler.prototype[name],'function',name);
  assert.equal(api.Compilation,Compilation);
});
test('A02-T13 type-utils owns the string-typed helpers',()=>{
  for(const name of ['supported','aliases','normalize','assignable','defaultValue','numeric','isReference'])assert(name in utils,name);
  assert.equal(utils.normalize('System.Int32'),'int');assert.equal(utils.assignable('double','int'),true);assert.equal(utils.assignable('int','double'),false);
  assert.equal(utils.defaultValue('int'),0);assert.equal(utils.defaultValue('bool'),false);assert.equal(utils.defaultValue('string'),null);assert.equal(api.assignable,utils.assignable);
});
test('A02-T13 split compiler still compiles and runs through the public API',()=>{
  const r=api.compile('class P{static int Twice(int x){return x*2;} static void Main(){Console.WriteLine(Twice(21));}}');
  assert.equal(r.success,true,JSON.stringify(r.diagnostics));assert.equal(r.image.methods.some(m=>m.qualifiedName==='P.Twice'),true);
  const il=api.compileToIL('Console.WriteLine(1);');assert.equal(il.success,true);assert(il.assembly.length>0);
});
test('A02-B02 an out-of-range integer literal reports one diagnostic',()=>{
  for(const [source,code] of [['int x=0xFFFFFFFF;','CS0266'],['int x=4000000000;','CS0266'],['int x=2147483648;','CS0266']]){const d=api.compile(source).diagnostics.filter(x=>x.severity==='error');assert.deepEqual(d.map(x=>x.code),[code],source);}
  assert.equal(api.compile('int x=-2147483648;Console.WriteLine(x);').success,true);
});
