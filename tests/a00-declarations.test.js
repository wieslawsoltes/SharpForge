import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,compileToIL,Compilation,assignable} from '@sharpforge/compiler';
import {compile as compileEntry,compileToIL as compileToILEntry} from '../packages/compiler/src/compile.js';
import {Compilation as CompilationEntry} from '../packages/compiler/src/compilation.js';
import * as conversions from '../packages/compiler/src/conversions.js';
import * as legacyHelpers from '../packages/compiler/src/type-utils.js';
import {SourceText} from '@sharpforge/text';
import {parse} from '@sharpforge/syntax';
import {collectDeclarations} from '../packages/compiler/src/declarations.js';

test('A00-T15 conversion seam preserves public entry points and legacy helper identities',()=>{
  assert.equal(compile,compileEntry);
  assert.equal(compileToIL,compileToILEntry);
  assert.equal(Compilation,CompilationEntry);
  assert.equal(assignable,conversions.assignable);
  for(const name of ['supported','aliases','normalize','numeric','isReference','assignable','defaultValue'])
    assert.equal(legacyHelpers[name],conversions[name],name);
});

test('A00-T15 conversion seam retains widening, reference and recovery assignments',()=>{
  for(const [target,from] of [['double','int'],['object','bool'],['string','null'],['Widget','null'],['int[]','null'],['int','error'],['error','bool']])
    assert.equal(assignable(target,from),true,`${from} -> ${target}`);
  for(const [target,from] of [['int','double'],['bool','int'],['int','null'],['void','null'],['object','void']])
    assert.equal(assignable(target,from),false,`${from} -> ${target}`);
});

test('A00-T15 default values retain numeric zero, false and null boundaries',()=>{
  for(const type of ['int','double'])assert.equal(conversions.defaultValue(type),0,type);
  assert.equal(conversions.defaultValue('bool'),false);
  for(const type of ['string','object','Widget','int[]','void','error'])
    assert.equal(conversions.defaultValue(type),null,type);
  assert.equal(conversions.normalize('System.Int32'),'int');
  assert.equal(conversions.normalize('System.String'),'string');
});

const parsedFiles=sources=>Object.entries(sources).map(([uri,text])=>parse(new SourceText(text,uri)));

test('A00-T15 declaration seam collects namespace and partial types before their members',()=>{
  const compilation=new Compilation(parsedFiles({
    'A.cs':'namespace N { public partial class Box { public Other Next; public int Value { get; set; } } }',
    'B.cs':'namespace N { partial class Box { public static int Count; public int Read() { return Value; } } class Other { } } namespace M { class Other { } }',
    'Program.cs':'Console.WriteLine(1); int Twice(int n) { return n + n; }'
  }));
  const tops=collectDeclarations(compilation),box=compilation.fullNames.get('N.Box');
  assert.deepEqual(compilation.diagnostics,[]);
  assert.deepEqual(compilation.types.map(t=>t.name),['Box','N.Other','M.Other']);
  assert.equal(box.declarations.length,2);
  assert.equal(box.fields.find(f=>f.name==='Next').type,'N.Other');
  assert.equal(box.fields.find(f=>f.name==='Next').index,0);
  const property=box.properties[0];
  assert.equal(property.backing.name,'<Value>k__BackingField');
  assert.equal(property.backing.index,1);
  assert.equal(property.backing.symbol,null);
  assert.equal(property.get.owner,box);
  assert.equal(property.set.parameters[0].type,'int');
  assert.equal(compilation.statics[0].name,'Count');
  assert.equal(compilation.statics[0].index,0);
  assert.equal(compilation.references.filter(r=>r.declaration&&r.symbolId===box.symbol.id).length,2);
  assert.equal(compilation.semantic.globalNamespace.lookupType('N.Box').legacy,box);
  assert.deepEqual(tops.map(t=>t.file.source.uri),['Program.cs']);
  const topMethod=compilation.methods.find(m=>m.name==='Twice');
  assert.equal(topMethod.owner,null);
  assert.equal(topMethod.isStatic,true);
});

test('A00-T15 declaration seam preserves subclass hooks including synthetic accessors',()=>{
  class ObservedCompilation extends Compilation {
    events=[];
    declareField(owner,node){this.events.push(['field',node.name]);return super.declareField(owner,node);}
    declareProperty(owner,node){this.events.push(['property',node.name]);return super.declareProperty(owner,node);}
    declareMethod(owner,node,synthetic=false){this.events.push(['method',node.name,synthetic]);return super.declareMethod(owner,node,synthetic);}
  }
  const compilation=new ObservedCompilation(parsedFiles({'C.cs':'class C { public int X; public int Value { get; set; } public void M() { } }'}));
  collectDeclarations(compilation);
  assert.deepEqual(compilation.events,[['field','X'],['property','Value'],['field','<Value>k__BackingField'],['method','get_Value',true],['method','set_Value',true],['method','M',false]]);
  for(const name of ['declareField','declareProperty','declareMethod'])
    assert.equal(Object.getOwnPropertyDescriptor(Compilation.prototype,name).enumerable,false,name);
});

test('A00-T15 declaration diagnostics retain duplicate and unresolved-type spans',()=>{
  const source='class Broken { Missing Value; void M(int x) {} void M(int x) {} } class Broken {}';
  const compilation=new Compilation(parsedFiles({'Broken.cs':source}));
  collectDeclarations(compilation);
  assert.deepEqual(compilation.diagnostics.map(d=>d.code),['CS0101','CS0246','CS0111']);
  const missing=compilation.diagnostics.find(d=>d.code==='CS0246');
  assert.equal(missing.uri,'Broken.cs');
  assert.equal(source.slice(missing.start,missing.start+missing.length),'Missing');
  assert.equal(compilation.types.length,1);
  assert.equal(compilation.methods.filter(m=>m.name==='M').length,2,'duplicate members remain available for recovery');
});

test('A00-T15 declaration seam preserves empty and local-function-only program boundaries',()=>{
  const empty=new Compilation([]);
  assert.deepEqual(collectDeclarations(empty),[]);
  assert.deepEqual(empty.types,[]);
  assert.deepEqual(empty.methods,[]);
  const localOnly=new Compilation(parsedFiles({'Helpers.cs':'int Twice(int n) { return n + n; }'}));
  const tops=collectDeclarations(localOnly);
  assert.equal(tops.length,1);
  assert.equal(tops[0].file.source.uri,'Helpers.cs');
  assert.deepEqual(tops[0].statements,[]);
  assert.equal(localOnly.methods[0].qualifiedName,'Twice');
  assert.equal(localOnly.methods[0].isStatic,true);
});
