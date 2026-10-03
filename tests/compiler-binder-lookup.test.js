import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceText} from '@sharpforge/text';
import {parse} from '@sharpforge/syntax';
import {NamedTypeSymbol,ArrayTypeSymbol,TypeParameterSymbol,SymbolKind,SymbolDisplayFormat as F} from '../packages/compiler/src/symbols/types.js';
import {MethodSymbol,FieldSymbol,ParameterSymbol,LocalSymbol,LabelSymbol,DeclarationModifiers} from '../packages/compiler/src/symbols/members.js';
import {NamespaceSymbol,mergeGlobalNamespaces} from '../packages/compiler/src/symbols/namespaces.js';
import {frameworkBridge} from '../packages/compiler/src/symbols/registry-bridge.js';
import {Binder,BinderFlags,BuckStopsHereBinder,InContainerBinder,WithUsingsBinder,InMethodBinder,LocalScopeBinder,LookupOptions,LookupResultKind} from '../packages/compiler/src/binder/binder.js';
import {parseTypeName,bindType,bindNamespaceOrType,lookupSimpleName} from '../packages/compiler/src/binder/lookup.js';
import {collectUsingDirectives,bindUsings,noUsings,resolveQualifiedName} from '../packages/compiler/src/binder/usings.js';
import {formatMessage} from '../packages/compiler/src/diagnostics/codes.js';
const same=(a,b,message)=>assert(a===b,message??`expected the same symbol, got ${a} and ${b}`);
const bridge=frameworkBridge(),int=bridge.typeFromName('int'),string=bridge.typeFromName('string');
// namespace App { class Outer { int X; static void M(){}  class Inner { int X; void Work(int X){ int X; } } } }  plus App.Helper, Lib.Helper, Lib.Tools.Wrench
function universe(){
  const source=new NamespaceSymbol(),app=source.ensureNamespace('App'),lib=source.ensureNamespace('Lib'),tools=source.ensureNamespace('Lib.Tools');
  const outer=app.addType(new NamedTypeSymbol({name:'Outer'})),inner=outer.addMember(new NamedTypeSymbol({name:'Inner'}));
  const outerX=outer.addMember(new FieldSymbol({name:'X',type:int})),outerOnly=outer.addMember(new FieldSymbol({name:'OuterOnly',type:int})),m=outer.addMember(new MethodSymbol({name:'M',returnType:bridge.typeFromName('void'),modifiers:DeclarationModifiers.Static})),m2=outer.addMember(new MethodSymbol({name:'M',returnType:bridge.typeFromName('void'),parameters:[new ParameterSymbol({name:'a',type:int})]}));
  const innerX=inner.addMember(new FieldSymbol({name:'X',type:int})),work=inner.addMember(new MethodSymbol({name:'Work',returnType:bridge.typeFromName('void'),parameters:[new ParameterSymbol({name:'X',type:int}),new ParameterSymbol({name:'p',type:int})],typeParameters:[new TypeParameterSymbol({name:'TWork'})]}));
  const appHelper=app.addType(new NamedTypeSymbol({name:'Helper'})),libHelper=lib.addType(new NamedTypeSymbol({name:'Helper'})),wrench=tools.addType(new NamedTypeSymbol({name:'Wrench'})),box=lib.addType(new NamedTypeSymbol({name:'Box',arity:1})),xNamespace=source.ensureNamespace('X');
  const global=mergeGlobalNamespaces(source,bridge.globalNamespace);
  return {source,global,app:global.getNamespace('App'),lib:global.getNamespace('Lib'),outer,inner,outerX,outerOnly,m,m2,innerX,work,appHelper,libHelper,wrench,box,xNamespace:global.getNamespace('X')};
}
function chain(u,usings=noUsings()){
  const root=new BuckStopsHereBinder({globalNamespace:u.global}),fileUsings=new WithUsingsBinder(usings,root),globalBinder=new InContainerBinder(u.global,fileUsings),appBinder=new InContainerBinder(u.app,globalBinder);
  const outerBinder=new InContainerBinder(u.outer,appBinder),innerBinder=new InContainerBinder(u.inner,outerBinder),method=new InMethodBinder(u.work,innerBinder),block=new LocalScopeBinder(method),nested=new LocalScopeBinder(block);
  return {root,fileUsings,globalBinder,appBinder,outerBinder,innerBinder,method,block,nested};
}
test('A02-T23 lookup shadows in order: locals, parameters, type members, enclosing types, namespaces, usings',()=>{
  const u=universe(),usings=bindUsings([{kind:'namespace',name:'Lib'},{kind:'namespace',name:'Lib.Tools'}],{globalNamespace:u.global}),b=chain(u,usings);
  const local=b.nested.declare(new LocalSymbol({name:'X',type:int})),outerLocal=b.block.declare(new LocalSymbol({name:'y',type:int}));
  same(b.nested.lookup('X').symbol,local,'the innermost local wins');same(b.nested.lookup('y').symbol,outerLocal,'an enclosing block local is visible');
  same(b.block.lookup('X').symbol,u.work.parameters[0],'without the local the parameter wins over the fields');same(b.method.lookup('p').symbol,u.work.parameters[1]);
  same(b.innerBinder.lookup('X').symbol,u.innerX,'the type member wins over the enclosing type member');same(b.outerBinder.lookup('X').symbol,u.outerX);
  same(b.nested.lookup('OuterOnly').symbol,u.outerOnly,'members of enclosing types are visible');same(b.appBinder.lookup('X').symbol,u.xNamespace,'outside the types X is the namespace');
  same(b.nested.lookup('Helper').symbol,u.appHelper,'the enclosing namespace wins over a using directive');same(b.nested.lookup('Wrench').symbol,u.wrench,'a type from a using directive is found last');
  same(b.globalBinder.lookup('Helper').symbol,u.libHelper,'in the global namespace only the using provides Helper');
  same(b.nested.lookup('TWork').symbol,u.work.typeParameters[0]);same(b.nested.lookup('Inner').symbol,u.inner);same(b.nested.lookup('Outer').symbol,u.outer);same(b.nested.lookup('App').symbol,u.app);
  assert.deepEqual(b.nested.lookup('M').symbols.map(String),['App.Outer.M()','App.Outer.M(int)'],'overloads form one method group');assert.equal(b.nested.lookup('M').isViable,true);
  assert.equal(b.nested.lookup('Nope').kind,LookupResultKind.Empty);same(b.nested.lookup('X').binder,b.nested);same(b.nested.lookup('Wrench').binder,b.fileUsings);
  // Type-name lookups skip locals, parameters and fields.
  same(b.nested.lookup('X',0,LookupOptions.NamespacesAndTypesOnly).symbol,u.xNamespace);
  same(b.nested.findLocalInEnclosingScopes('X'),local);same(b.block.findLocalInEnclosingScopes('X'),u.work.parameters[0]);same(b.block.findLocalInEnclosingScopes('zzz'),null);
  const label=b.block.declareLabel(new LabelSymbol({name:'again'}));same(b.nested.lookup('again',0,LookupOptions.LabelsOnly).symbol,label);assert.equal(b.nested.lookup('again').isEmpty,true);
  assert.deepEqual(b.nested.lookupSymbols().filter(s=>['X','y','p','OuterOnly'].includes(s.name)).map(s=>s.kind+':'+s.name),['Local:X','Local:y','Parameter:p','Field:OuterOnly'],'completion lists the visible symbol per name');
  same(b.nested.containingMember,u.work);same(b.nested.containingType,u.inner);same(b.outerBinder.containingType,u.outer);same(b.nested.containingNamespace.name,'App');same(b.nested.compilation.globalNamespace,u.global);same(b.nested.enclosing(InMethodBinder),b.method);
});
test('A02-T23 inherited members are visible and hidden by derived declarations',()=>{
  const g=new NamespaceSymbol(),baseType=g.addType(new NamedTypeSymbol({name:'Base'})),derived=g.addType(new NamedTypeSymbol({name:'Derived',baseType}));
  const baseF=baseType.addMember(new FieldSymbol({name:'F',type:int})),baseG=baseType.addMember(new FieldSymbol({name:'G',type:int})),derivedG=derived.addMember(new FieldSymbol({name:'G',type:string}));
  baseType.addMember(new MethodSymbol({name:'Run',returnType:int}));derived.addMember(new MethodSymbol({name:'Run',returnType:int,parameters:[new ParameterSymbol({name:'a',type:int})]}));
  const binder=new InContainerBinder(derived,new InContainerBinder(g,new BuckStopsHereBinder()));
  same(binder.lookup('F').symbol,baseF);same(binder.lookup('G').symbol,derivedG,'the derived member hides the base member');assert.equal(binder.lookup('Run').symbols.length,2,'methods accumulate across the hierarchy');assert(!binder.lookup('G').symbols.includes(baseG));
});
test('A02-T23 context flags propagate down the chain and can be overridden',()=>{
  const root=new BuckStopsHereBinder(null,BinderFlags.CheckedContext|BinderFlags.NullableAnnotations),scope=new LocalScopeBinder(new InContainerBinder(new NamespaceSymbol(),root));
  assert.equal(scope.checkedContext,true);assert.deepEqual(scope.nullableContext,{annotations:true,warnings:false});assert.equal(scope.isUnsafe,false);
  const unchecked=scope.withCheckedContext(false),inner=new LocalScopeBinder(unchecked);assert.equal(inner.checkedContext,false);assert.equal(inner.has(BinderFlags.CheckedContext),false);assert.equal(inner.withCheckedContext(true).checkedContext,true);assert.equal(scope.checkedContext,true,'the outer binder is unchanged');
  assert.equal(new BuckStopsHereBinder().checkedContext,null);const unsafe=inner.withFlags(BinderFlags.UnsafeRegion);assert.equal(unsafe.isUnsafe,true);assert.equal(unsafe.checkedContext,false,'unrelated flags are inherited');assert.equal(new LocalScopeBinder(unsafe).isUnsafe,true);
  assert.deepEqual(inner.withNullableContext(true,true).nullableContext,{annotations:true,warnings:true});assert.deepEqual(inner.withNullableContext(false,false).nullableContext,{annotations:false,warnings:false});
  const local=scope.declare(new LocalSymbol({name:'v',type:int}));same(new LocalScopeBinder(unsafe).lookup('v').symbol,local,'flag binders are transparent to lookup');
  assert.equal(unsafe.withFlags(0,BinderFlags.UnsafeRegion).isUnsafe,false);assert(unsafe instanceof Binder);
});
test('A02-T24 type name syntax parses simple, qualified, generic, array and alias-qualified names',()=>{
  assert.deepEqual(parseTypeName('int'),{alias:null,segments:[{name:'int',typeArguments:[]}],ranks:[],nullable:false});
  assert.deepEqual(parseTypeName('System.Collections.Generic.Dictionary<string, List<int>>[]').segments.map(s=>s.name),['System','Collections','Generic','Dictionary']);
  const d=parseTypeName('Dictionary<string, List<int[]>>');assert.equal(d.segments[0].typeArguments.length,2);assert.deepEqual(d.segments[0].typeArguments[1].segments[0].typeArguments[0].ranks,[1]);
  assert.deepEqual(parseTypeName('int[][,]').ranks,[1,2]);assert.equal(parseTypeName('global::System.Int32').alias,'global');assert.equal(parseTypeName('int?').nullable,true);assert.equal(parseTypeName("System.Collections.Generic.List`1<int>").segments.at(-1).name,'List');
  assert.equal(parseTypeName('1abc'),null);assert.equal(parseTypeName('A..B'),null);assert.equal(parseTypeName('A<'),null);
});
test('A02-T24 simple, qualified and alias-qualified lookup with Roslyn diagnostics',()=>{
  const u=universe(),reports=[],report=(node,code,args)=>reports.push(`${code}: ${formatMessage(code,args)}`);
  const usings=bindUsings([{kind:'namespace',name:'Lib'},{kind:'namespace',name:'System.Collections.Generic'},{kind:'alias',alias:'Wr',name:'Lib.Tools.Wrench'},{kind:'alias',alias:'T',name:'Lib.Tools'},{kind:'static',name:'System.Math'}],{globalNamespace:u.global,report});
  assert.deepEqual(reports,[]);const b=chain(u,usings),context={types:bridge.typeProvider,globalNamespace:u.global,report},type=(text,binder=b.nested)=>bindType(binder,text,context);
  same(type('int'),int);same(type('Helper'),u.appHelper);same(type('Lib.Helper'),u.libHelper);same(type('Lib.Tools.Wrench'),u.wrench);same(type('Wr'),u.wrench,'using alias to a type');same(type('T.Wrench'),u.wrench,'using alias to a namespace');same(type('T::Wrench'),u.wrench,'alias-qualified');
  same(type('global::Lib.Helper'),u.libHelper);same(type('global::System.Text.StringBuilder'),bridge.typeFromName('System.Text.StringBuilder'));same(type('Outer.Inner'),u.inner);same(type('App.Outer.Inner'),u.inner);
  same(type('List<int>'),bridge.typeFromName('List<int>'),'a generic name constructs the registry instantiation');same(type('System.Collections.Generic.Dictionary<string, int>'),bridge.typeFromName('Dictionary<string, int>'));
  assert.equal(type('Box<Helper>').toDisplayString(),'Lib.Box<App.Helper>');const array=type('Helper[][,]');assert(array instanceof ArrayTypeSymbol);assert.equal(array.toDisplayString(),'App.Helper[][,]');assert.equal(array.rank,1);assert.equal(array.elementType.rank,2);
  same(bindNamespaceOrType(b.nested,'Lib.Tools',context).symbol.name,'Tools');assert.deepEqual(reports,[]);
  const failing=[
    ['Missing',"CS0246: The type or namespace name 'Missing' could not be found (are you missing a using directive or an assembly reference?)"],
    ['Lib.Missing',"CS0234: The type or namespace name 'Missing' does not exist in the namespace 'Lib' (are you missing an assembly reference?)"],
    ['Lib.Tools.Wrench.Handle',"CS0426: The type name 'Handle' does not exist in the type 'Lib.Tools.Wrench'"],
    ['Lib.Tools',"CS0118: 'Lib.Tools' is a namespace but is used like a type"],
    ['Box',"CS0305: Using the generic type 'Lib.Box<T>' requires 1 type arguments"],
    ['Lib.Tools.Wrench<int>',"CS0308: The non-generic type 'Lib.Tools.Wrench' cannot be used with type arguments"],
    ['Nope::Wrench',"CS0432: Alias 'Nope' not found"],['Wr::Thing',"CS0431: Cannot use alias 'Wr' with '::' since the alias references a type. Use '.' instead."],
    ['global::Missing',"CS0400: The type or namespace name 'Missing' could not be found in the global namespace (are you missing an assembly reference?)"]];
  for(const [text,expected] of failing){reports.length=0;const result=type(text);assert.equal(result.isErrorType(),true,text);assert.deepEqual(reports,[expected],text);assert.equal(result.reason.code,expected.slice(0,6));}
  // Ambiguity: in the global namespace Helper comes only from usings; add a second namespace that also declares it.
  const other=u.source.ensureNamespace('Other').addType(new NamedTypeSymbol({name:'Helper'})),both=bindUsings([{kind:'namespace',name:'Lib'},{kind:'namespace',name:'Other'}],{globalNamespace:u.global}),ambiguous=new InContainerBinder(u.global,new WithUsingsBinder(both,new BuckStopsHereBinder()));
  reports.length=0;const result=bindType(ambiguous,'Helper',context);assert.equal(result.isErrorType(),true);assert.deepEqual(reports,["CS0104: 'Helper' is an ambiguous reference between 'Lib.Helper' and 'Other.Helper'"]);assert.deepEqual(result.candidates,[u.libHelper,other]);
  assert.deepEqual(lookupSimpleName(ambiguous,'Helper').error.code,'CS0104');same(bindType(new InContainerBinder(u.app,ambiguous),'Helper',context),u.appHelper,'a declaration in an enclosing namespace is not ambiguous');
  same(usings.staticTypes[0],bridge.typeFromName('System.Math'));assert.equal(b.nested.lookup('Sqrt').symbols[0].toDisplayString(),'System.Math.Sqrt(double)','using static exposes static members');
});
test('A02-T24 using directives are collected from source and bound with diagnostics',()=>{
  const text=`global using System;
using System.Collections.Generic;
using static System.Math;
using Txt = System.Text;
using Ints = System.Collections.Generic.List<int>;
namespace App { using Lib.Tools; class C { void M(){ using (var d = Make()) { } } } }
using var x = Make();`,file=parse(new SourceText(text,'a.cs')),directives=collectUsingDirectives(file);
  assert.deepEqual(directives.map(d=>[d.kind,d.name,d.alias,d.isGlobal,d.namespace]),[['namespace','System',null,true,''],['namespace','System.Collections.Generic',null,false,''],['static','System.Math',null,false,''],['alias','System.Text','Txt',false,''],['alias','System.Collections.Generic.List<int>','Ints',false,''],['namespace','Lib.Tools',null,false,'App']]);
  assert.equal(text.slice(directives[0].start,directives[0].end),'global using System;');assert.equal(text.slice(directives[3].nameStart,directives[3].nameEnd),'System.Text');assert.equal(directives[1].uri,'a.cs');
  const u=universe(),reports=[],report=(node,code,args)=>reports.push([code,text.slice(node.start,node.end),formatMessage(code,args)]);
  const bound=bindUsings(directives,{globalNamespace:u.global,report,bindType:name=>bindType(new InContainerBinder(u.global,new BuckStopsHereBinder()),name,{types:bridge.typeProvider})});
  assert.deepEqual(reports,[]);assert.deepEqual(bound.namespaces.map(n=>n.qualifiedName),['System','System.Collections.Generic','Lib.Tools']);same(bound.aliases.get('Txt').target.qualifiedName,'System.Text');same(bound.aliases.get('Ints').target,bridge.typeFromName('List<int>'));assert.equal(bound.aliases.get('Txt').kind,SymbolKind.Alias);
  const bad=collectUsingDirectives(parse(new SourceText('using Nope;\nusing System.Nope;\nusing System.Console;\nusing static System;\nusing System;\nusing System;\nusing A = System;\nusing A = System.Text;\nusing System.Text.StringBuilder.Nested;','b.cs')));
  const source=bad.length?'using Nope;\nusing System.Nope;\nusing System.Console;\nusing static System;\nusing System;\nusing System;\nusing A = System;\nusing A = System.Text;\nusing System.Text.StringBuilder.Nested;':'';
  bindUsings(bad,{globalNamespace:u.global,report:(node,code,args)=>reports.push([code,source.slice(node.start,node.end),formatMessage(code,args)])});
  assert.deepEqual(reports,[
    ['CS0246','Nope',"The type or namespace name 'Nope' could not be found (are you missing a using directive or an assembly reference?)"],
    ['CS0234','System.Nope',"The type or namespace name 'Nope' does not exist in the namespace 'System' (are you missing an assembly reference?)"],
    ['CS0138','System.Console',"A 'using namespace' directive can only be applied to namespaces; 'System.Console' is a type not a namespace. Consider a 'using static' directive instead"],
    ['CS7007','System',"A 'using static' directive can only be applied to types; 'System' is a namespace not a type. Consider a 'using namespace' directive instead"],
    ['CS0105','System',"The using directive for 'System' appeared previously in this namespace"],
    ['CS1537','System.Text',"The using alias 'A' appeared previously in this namespace"],
    ['CS0426','System.Text.StringBuilder.Nested',"The type name 'Nested' does not exist in the type 'System.Text.StringBuilder'"]]);
  reports.length=0;const lenient=bindUsings(bad,{globalNamespace:u.global,report:(n,code)=>reports.push(code),reportMissing:false});assert.deepEqual(reports,['CS0138','CS7007','CS0105','CS1537'],'the closed profile tolerates unknown namespaces');assert.equal(lenient.namespaces.length,1);
  assert.equal(resolveQualifiedName(u.global,'Lib.Tools.Wrench').symbol,u.wrench);assert.deepEqual(resolveQualifiedName(u.global,'Lib.Zip').error,{code:'CS0234',args:['Zip','Lib']});
  assert.deepEqual(collectUsingDirectives({root:{usings:[{name:'System',start:0,end:13}]},source:{uri:'x.cs'}}).map(d=>[d.kind,d.name,d.uri]),[['namespace','System','x.cs']],'a syntax tree that keeps using directives is used directly');
});
