import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SourceText} from '@sharpforge/text';
import {parse} from '@sharpforge/syntax';
import {DeclarationTable,SourceNamedTypeSymbol,buildDeclarationTable,declarationKind,splitTypeText} from '../packages/compiler/src/symbols/source/declaration-table.js';
import {NamedTypeSymbol,ArrayTypeSymbol,ErrorTypeSymbol,TypeKind,SymbolKind,Accessibility,RefKind,SymbolDisplayFormat as F} from '../packages/compiler/src/symbols/types.js';
import {NamespaceSymbol,NamespaceExtent,mergeGlobalNamespaces} from '../packages/compiler/src/symbols/namespaces.js';
import {MethodKind,DeclarationModifiers} from '../packages/compiler/src/symbols/members.js';
import {formatMessage} from '../packages/compiler/src/diagnostics/codes.js';
// A hand-built framework: the special types plus List<T>, and a resolver that looks source types up from the context namespace outwards.
const framework=new NamespaceSymbol('',null,NamespaceExtent.Metadata,{name:'corlib'}),system=framework.ensureNamespace('System');
const special=(name,id,typeKind=TypeKind.Struct)=>system.addType(new NamedTypeSymbol({name,specialType:id,typeKind}));
const object=special('Object','System_Object',TypeKind.Class),int=special('Int32','System_Int32'),string=special('String','System_String',TypeKind.Class),voidType=special('Void','System_Void'),bool=special('Boolean','System_Boolean'),double=special('Double','System_Double');
const list=framework.ensureNamespace('System.Collections.Generic').addType(new NamedTypeSymbol({name:'List',arity:1,baseType:object}));
const disposable=system.addType(new NamedTypeSymbol({name:'IDisposable',typeKind:TypeKind.Interface}));
const keywords={object,int,string,void:voidType,bool,double};
function makeResolver(calls=[]){
  const resolve=(text,context)=>{
    calls.push(text);if(keywords[text])return keywords[text];
    const {name,typeArguments}=splitTypeText(text),argument=a=>context.typeParameters.get(a)??(a.endsWith('[]')?new ArrayTypeSymbol(argument(a.slice(0,-2))):resolve(a,context))??new ErrorTypeSymbol(a);
    if(name==='List'&&typeArguments.length===1)return list.construct(argument(typeArguments[0]));
    if(typeArguments.length)return null;
    for(let t=context.containingType;t;t=t.containingType){const nested=t.getTypeMembers(name,0)[0];if(nested)return nested;}
    const merged=mergeGlobalNamespaces(context.table.globalNamespace,framework);
    for(let ns=context.containingNamespace;ns;ns=ns.containingNamespace){const found=merged.lookupNamespace(ns.qualifiedName)?.lookupType(name,0);if(found)return found;}
    return merged.lookupType(name,0);
  };
  return resolve;
}
const parseFiles=texts=>texts.map((text,i)=>parse(new SourceText(text,`file${i}.cs`)));
function build(texts,calls){const diagnostics=[],files=parseFiles(texts),table=new DeclarationTable(files,{resolveType:makeResolver(calls),report:(node,code,args)=>diagnostics.push({node,code,args})});return {table,files,diagnostics};}
const names=members=>members.map(m=>m.name);
const classNode=(file,name,n=0)=>file.root.members.filter(m=>m.kind==='Class'&&m.name===name)[n];

test('A02-T17 namespace tree and source type symbols',()=>{
  const {table,files,diagnostics}=build(['class Top { }\nnamespace App.Core { public class Engine { } static class Util { } }\nnamespace App { namespace Core { sealed class Other { } } class Shell { } }\n']);
  const g=table.globalNamespace;assert.equal(g.isGlobalNamespace,true);assert.equal(g.extent,NamespaceExtent.Source);assert.deepEqual(names(g.getNamespaceMembers()),['App']);
  const core=g.lookupNamespace('App.Core');assert.equal(core.qualifiedName,'App.Core');assert.deepEqual(names(core.getTypeMembers()),['Engine','Util','Other']);assert.deepEqual(names(g.getNamespace('App').getTypeMembers()),['Shell']);
  assert.deepEqual(names(table.types),['Top','Engine','Util','Other','Shell']);assert.equal(diagnostics.length,0);
  const top=g.lookupType('Top'),engine=g.lookupType('App.Core.Engine'),util=core.getTypeMembers('Util')[0],other=g.lookupType('App.Core.Other');
  assert(top instanceof SourceNamedTypeSymbol);assert.equal(top.kind,SymbolKind.NamedType);assert.equal(top.typeKind,TypeKind.Class);assert.equal(top.isSourceSymbol,true);
  assert.equal(top.declaredAccessibility,Accessibility.Internal);assert.equal(engine.declaredAccessibility,Accessibility.Public);assert.equal(util.isStatic,true);assert.equal(other.isSealed,true);assert.equal(top.isStatic,false);
  assert.equal(engine.toDisplayString(),'App.Core.Engine');assert.equal(engine.metadataFullName,'App.Core.Engine');assert.equal(engine.containingNamespace,core);assert.equal(engine.baseType,object);
  const node=classNode(files[0],'Engine');assert.equal(table.typeFor(node),engine);assert.equal(table.memberFor(node),engine);assert.equal(engine.syntax,node);assert.deepEqual(table.declarationsOf(engine),[node]);assert.deepEqual(table.declarationsOf(int),[]);
  assert.deepEqual(engine.locations,[{uri:'file0.cs',start:node.nameSpan.start,end:node.nameSpan.end}]);assert.equal(files[0].source.text.slice(engine.locations[0].start,engine.locations[0].end),'Engine');
  assert.equal(table.typeFor({kind:'Class'}),null);assert(buildDeclarationTable([]) instanceof DeclarationTable);assert.equal(buildDeclarationTable([]).types.length,0);
});
test('A02-T17 partial declarations merge across files and members are created lazily',()=>{
  const calls=[],{table,files,diagnostics}=build(['namespace App { public partial class Widget { int a; public void First() { } } }\n','namespace App { partial class Widget : System.IDisposable { string b; public void Dispose() { } } }\nnamespace Other { partial class Widget { } }\n'],calls);
  const widget=table.globalNamespace.lookupType('App.Widget');assert.equal(table.globalNamespace.lookupNamespace('App').getTypeMembers('Widget').length,1);assert.equal(table.types.length,2);
  assert.equal(widget.isPartial,true);assert.equal(widget.declaredAccessibility,Accessibility.Public);assert.equal(widget.declarations.length,2);assert.deepEqual(widget.locations.map(l=>l.uri),['file0.cs','file1.cs']);
  assert.equal(table.typeFor(classNode(files[0],'Widget')),widget);assert.equal(table.typeFor(classNode(files[1],'Widget')),widget);assert.notEqual(table.typeFor(classNode(files[1],'Widget',1)),widget);
  assert.deepEqual(calls,[],'no member type is resolved before the members are asked for');
  assert.deepEqual(names(widget.getMembers()),['a','First','b','Dispose','.ctor']);assert(calls.includes('string'));const count=calls.length;widget.getMembers();widget.getMembers('a');assert.equal(calls.length,count,'members are built once');
  assert.equal(widget.getMembers('b')[0].type,string);assert.equal(widget.getMembers('b')[0].syntax.uri,'file1.cs');assert.deepEqual(widget.interfaces,[disposable]);assert.equal(diagnostics.length,0);
});
test('A02-T17 fields, methods and constructors carry kind, modifiers, accessibility and signature',()=>{
  const {table,files,diagnostics}=build(['namespace App {\nclass Account {\n  int count;\n  public static readonly string Name = "x";\n  const int Max = 3;\n  protected internal double[] rates;\n  private protected Missing.Thing broken;\n  System.Collections.Generic.List<int> items;\n  List<Account[]> nested;\n  public Account(int start) { }\n  static Account() { }\n  internal static async void Run(string[] args, int n) { }\n  public Account Clone() { return this; }\n  bool Check(Account other) => true;\n}\nclass Plain { }\nstatic class Tools { public static int Twice(int x) { return x; } }\n}\n']);
  const account=table.globalNamespace.lookupType('App.Account'),member=name=>account.getMembers(name)[0];
  const count=member('count');assert.equal(count.kind,SymbolKind.Field);assert.equal(count.type,int);assert.equal(count.declaredAccessibility,Accessibility.Private);assert.equal(count.modifiers,DeclarationModifiers.None);assert.equal(count.isStatic,false);assert.equal(count.containingType,account);assert.equal(count.toDisplayString(),'App.Account.count');assert.equal(count.toDisplayString(F.Test),'System.Int32 App.Account.count');
  const name=member('Name');assert.equal(name.declaredAccessibility,Accessibility.Public);assert.equal(name.isStatic,true);assert.equal(name.isReadOnly,true);assert.equal(name.modifiers,DeclarationModifiers.Static|DeclarationModifiers.ReadOnly);assert.equal(name.syntax.initializer.kind,'Literal');
  const max=member('Max');assert.equal(max.isConst,true);assert.equal(max.isStatic,true);
  const rates=member('rates');assert(rates.type instanceof ArrayTypeSymbol);assert.equal(rates.type.elementType,double);assert.equal(rates.declaredAccessibility,Accessibility.ProtectedOrInternal);
  const broken=member('broken');assert(broken.type instanceof ErrorTypeSymbol);assert.equal(broken.type.name,'Missing.Thing');assert.equal(broken.declaredAccessibility,Accessibility.ProtectedAndInternal);assert.equal(broken.type.toDisplayString(F.Test),'Missing.Thing[missing]');
  assert(member('items').type.typeKind===TypeKind.Error&&member('items').type.arity===1&&member('items').type.typeArguments[0].type===int,'an unresolved generic keeps its resolved arguments');
  assert.equal(member('nested').type.toDisplayString(),'System.Collections.Generic.List<App.Account[]>');
  const [ctor]=account.getMembers('.ctor'),[cctor]=account.getMembers('.cctor');
  assert.equal(ctor.methodKind,MethodKind.Constructor);assert.equal(ctor.isConstructor,true);assert.equal(ctor.isImplicitlyDeclared,false);assert.equal(ctor.declaredAccessibility,Accessibility.Public);assert.equal(ctor.toDisplayString(),'App.Account.Account(int)');assert.equal(ctor.returnsVoid,true);assert.equal(ctor.metadataName,'.ctor');assert.equal(account.getMembers('.ctor').length,1);
  assert.equal(cctor.methodKind,MethodKind.StaticConstructor);assert.equal(cctor.isStatic,true);assert.equal(cctor.declaredAccessibility,Accessibility.Private);
  const run=member('Run');assert.equal(run.kind,SymbolKind.Method);assert.equal(run.methodKind,MethodKind.Ordinary);assert.equal(run.isStatic,true);assert.equal(run.isAsync,true);assert.equal(run.declaredAccessibility,Accessibility.Internal);assert.equal(run.returnsVoid,true);
  assert.deepEqual(run.parameters.map(p=>[p.name,p.ordinal,p.type.toDisplayString(),p.refKind,p.containingSymbol===run]),[['args',0,'string[]',RefKind.None,true],['n',1,'int',RefKind.None,true]]);
  assert.equal(run.toDisplayString(),'App.Account.Run(string[], int)');assert.equal(member('Check').toDisplayString(F.Test),'System.Boolean App.Account.Check(App.Account other)');assert.equal(run.signatureKey,'Run`0(System.String[],System.Int32)');
  assert.equal(member('Clone').returnType,account);assert.equal(member('Check').returnType,bool);assert.equal(member('Check').parameters[0].type,account);assert.equal(member('Check').declaredAccessibility,Accessibility.Private);
  // AST node -> symbol, including parameters; the lookup builds the owner's members on demand.
  const node=classNode(files[0],'Account'),runNode=node.members.find(m=>m.name==='Run');assert.equal(table.memberFor(runNode),run);assert.equal(table.memberFor(runNode.parameters[1]),run.parameters[1]);assert.equal(table.memberFor(node.members[0]),count);assert.equal(run.syntax,runNode);assert.equal(table.memberFor({kind:'Method'}),null);
  const lazy=build(['class L { int f; void M(int p) { } }\n']),lazyNode=classNode(lazy.files[0],'L');assert.equal(lazy.table.memberFor(lazyNode.members[1].parameters[0]).name,'p');assert.equal(lazy.table.memberFor(lazyNode.members[0]).name,'f');
  assert.deepEqual(run.locations,[{uri:'file0.cs',start:runNode.nameSpan.start,end:runNode.nameSpan.end}]);
  // Implicit constructors: a class without constructors gets a public parameterless one; a static class gets none.
  const [implicit]=table.globalNamespace.lookupType('App.Plain').getMembers();assert.equal(implicit.methodKind,MethodKind.Constructor);assert.equal(implicit.isImplicitlyDeclared,true);assert.equal(implicit.declaredAccessibility,Accessibility.Public);assert.equal(implicit.parameters.length,0);assert.equal(implicit.syntax,null);assert.equal(implicit.toDisplayString(),'App.Plain.Plain()');
  assert.deepEqual(names(table.globalNamespace.lookupType('App.Tools').getMembers()),['Twice']);assert.equal(diagnostics.length,0);
});
test('A02-T17 properties expose accessors and auto-property backing fields',()=>{
  const {table,files,diagnostics}=build(['class Box {\n  public int Size { get; set; }\n  public static string Label { get; private set; }\n  public int Area { get; }\n  int Twice => Size * 2;\n  public int Manual { get { return 1; } set { } }\n  public int Seeded { get; set; } = 4;\n}\n']);
  const box=table.globalNamespace.lookupType('Box'),member=name=>box.getMembers(name)[0];
  assert.deepEqual(names(box.getMembers()),['Size','get_Size','set_Size','<Size>k__BackingField','Label','get_Label','set_Label','<Label>k__BackingField','Area','get_Area','<Area>k__BackingField','Twice','get_Twice','Manual','get_Manual','set_Manual','Seeded','get_Seeded','set_Seeded','<Seeded>k__BackingField','.ctor']);
  const size=member('Size');assert.equal(size.kind,SymbolKind.Property);assert.equal(size.type,int);assert.equal(size.declaredAccessibility,Accessibility.Public);assert.equal(size.isIndexer,false);assert.equal(size.isReadOnly,false);assert.equal(size.toDisplayString(),'Box.Size');assert.equal(size.toDisplayString(F.Test),'System.Int32 Box.Size { get; set; }');
  assert.equal(size.getMethod,member('get_Size'));assert.equal(size.setMethod,member('set_Size'));assert.equal(size.getMethod.methodKind,MethodKind.PropertyGet);assert.equal(size.setMethod.methodKind,MethodKind.PropertySet);assert.equal(size.getMethod.associatedSymbol,size);assert.equal(size.getMethod.isAccessor,true);
  assert.equal(size.getMethod.returnType,int);assert.equal(size.getMethod.parameters.length,0);assert.equal(size.setMethod.returnsVoid,true);assert.deepEqual(size.setMethod.parameters.map(p=>[p.name,p.type]),[['value',int]]);assert.equal(size.getMethod.toDisplayString(),'Box.Size.get');assert.equal(size.setMethod.toDisplayString(),'Box.Size.set');
  const backing=member('<Size>k__BackingField');assert.equal(size.backingField,backing);assert.equal(backing.kind,SymbolKind.Field);assert.equal(backing.isImplicitlyDeclared,true);assert.equal(backing.associatedSymbol,size);assert.equal(backing.declaredAccessibility,Accessibility.Private);assert.equal(backing.type,int);assert.equal(backing.isStatic,false);assert.equal(backing.isReadOnly,false);
  const label=member('Label');assert.equal(label.isStatic,true);assert.equal(label.getMethod.isStatic,true);assert.equal(label.getMethod.declaredAccessibility,Accessibility.Public);assert.equal(label.setMethod.declaredAccessibility,Accessibility.Private);assert.equal(label.backingField.isStatic,true);assert.equal(label.type,string);
  const area=member('Area');assert.equal(area.isReadOnly,true);assert.equal(area.setMethod,null);assert.equal(area.backingField.isReadOnly,true);assert.equal(area.toDisplayString(F.Test),'System.Int32 Box.Area { get; }');
  const twice=member('Twice');assert.equal(twice.backingField,null);assert.equal(twice.declaredAccessibility,Accessibility.Private);assert.equal(twice.getMethod.declaredAccessibility,Accessibility.Private);assert.equal(member('Manual').backingField,null);assert.equal(member('Seeded').syntax.initializer.kind,'Literal');
  const node=classNode(files[0],'Box').members[1];assert.equal(table.memberFor(node),label);assert.equal(table.memberFor(node.accessors[1]),label.setMethod);assert.equal(label.setMethod.syntax,node.accessors[1]);assert.equal(diagnostics.length,0);
});
test('A02-T17 top-level methods and statements are exposed without a container type',()=>{
  const {table,files}=build(['int Add(int a, int b) { return a + b; }\nvar x = Add(1, 2);\nclass C { }\n','static void Helper() { }\n']);
  assert.deepEqual(names(table.topLevelMethods),['Add','Helper']);const add=table.topLevelMethods[0];assert.equal(add.methodKind,MethodKind.Ordinary);assert.equal(add.containingType,null);assert.equal(add.containingSymbol,table.globalNamespace);assert.equal(add.isStatic,false);assert.equal(table.topLevelMethods[1].isStatic,true);
  assert.equal(add.toDisplayString(),'Add(int, int)');assert.equal(add.returnType,int);assert.equal(table.memberFor(files[0].root.members[0]),add);assert.equal(table.topLevelMethods,table.topLevelMethods);
  assert.equal(table.topLevelStatements.length,1);assert.equal(table.topLevelStatements[0].file,files[0]);assert.equal(table.topLevelStatements[0].statements,files[0].root.statements);assert.deepEqual(names(table.types),['C']);
});
const pinned=JSON.parse(readFileSync(new URL('../packages/compiler/test/accessibility/roslyn-declarations.json',import.meta.url),'utf8'));
for(const fixture of pinned.fixtures)test(`A02-T17 duplicate declarations match Roslyn: ${fixture.name}`,()=>{
  const {table,files,diagnostics}=build(fixture.files);assert.deepEqual(files.flatMap(f=>f.diagnostics),[],'the fixture parses');table.complete();
  const position=d=>{const index=Number(d.node.uri.match(/\d+/)[0]),before=fixture.files[index].slice(0,(d.node.nameSpan??d.node).start).split('\n');return {file:index,line:before.length,column:before.at(-1).length+1,code:d.code,message:formatMessage(d.code,d.args)};};
  const actual=diagnostics.map(position).sort((a,b)=>a.file-b.file||a.line-b.line||a.column-b.column||a.code.localeCompare(b.code));
  assert.deepEqual(actual,fixture.diagnostics);
});
test('A02-T17 the pinned duplicate fixtures cover every duplicate code',()=>{
  const codes=new Set(pinned.fixtures.flatMap(f=>f.diagnostics.map(d=>d.code)));assert.deepEqual([...codes].sort(),['CS0101','CS0102','CS0111','CS0260','CS0262']);assert(pinned.fixtures.some(f=>f.diagnostics.length===0));assert.match(pinned.sdk,/^\d+\./);
});
test('A02-T17 a redeclared type keeps its own symbol outside name lookup and the table keeps going',()=>{
  const {table,files,diagnostics}=build(['class A { int x; }\nclass A { string y; }\nclass B { A a; }\n']);
  assert.deepEqual(diagnostics.map(d=>[d.code,d.args]),[['CS0101',['A','<global namespace>']]]);assert.equal(diagnostics[0].node,classNode(files[0],'A',1));
  const first=table.typeFor(classNode(files[0],'A')),second=table.typeFor(classNode(files[0],'A',1));assert.notEqual(first,second);assert.equal(second.isDuplicateDeclaration,true);assert.deepEqual(table.duplicateTypes,[second]);assert.deepEqual(names(table.types),['A','B']);
  assert.deepEqual(table.globalNamespace.getTypeMembers('A'),[first]);assert.deepEqual(names(second.getMembers()),['y','.ctor']);assert.equal(table.globalNamespace.lookupType('B').getMembers('a')[0].type,first);assert.equal(table.memberFor(classNode(files[0],'A',1).members[0]).containingType,second);
});
// The parser has no nested types, generics, structs or ref parameters yet: these nodes are written by hand in the parser's shape.
let offset=0;const span=()=>({start:offset,end:(offset+=4)}),node=(kind,name,props={})=>({kind,name,uri:'hand.cs',...span(),nameSpan:span(),modifiers:[],...props});
const cls=(name,members=[],props={})=>node('Class',name,{namespace:'',members,interfaces:[],...props}),fld=(name,type,modifiers=[])=>node('Field',name,{type,initializer:null,modifiers});
const prm=(name,type,modifiers=[])=>node('Parameter',name,{type,modifiers}),mth=(name,returnType,parameters=[],props={})=>node('Method',name,{returnType,parameters,body:null,...props});
const handBuilt=members=>{const diagnostics=[],table=new DeclarationTable([{root:{kind:'CompilationUnit',members,statements:[]}}],{resolveType:makeResolver(),report:(n,code,args)=>diagnostics.push({node:n,code,args})});return {table,diagnostics};};
test('A02-T17 nested and generic declarations use the same code path',()=>{
  const innerA=cls('Inner',[fld('value','T'),fld('items','T[]'),fld('more','List<T>')],{modifiers:['partial']}),innerB=cls('Inner',[mth('Get','U',[prm('seed','T')],{typeParameters:['U']})],{modifiers:['public','partial']});
  const leaf=cls('Leaf',[fld('peer','Leaf'),fld('up','Inner')]),outer=cls('Outer',[fld('first','int'),innerA,leaf,innerB,cls('Pair',[],{typeParameters:[{name:'K'},{name:'V',variance:'out'}]})],{typeParameters:['T'],namespace:'App'});
  const {table,diagnostics}=handBuilt([outer]);
  const type=table.globalNamespace.lookupType('App.Outer',1);assert.equal(type.arity,1);assert.equal(type.typeParameters[0].name,'T');assert.equal(type.typeParameters[0].containingSymbol,type);assert.equal(type.metadataName,'Outer`1');assert.equal(type.toDisplayString(),'App.Outer<T>');
  assert.deepEqual(names(table.types),['Outer','Inner','Leaf','Pair']);assert.deepEqual(names(type.getTypeMembers()),['Inner','Leaf','Pair']);assert.deepEqual(names(type.getMembers()),['first','Inner','Leaf','Pair','.ctor']);
  const inner=type.getTypeMembers('Inner')[0];assert.equal(table.typeFor(innerA),inner);assert.equal(table.typeFor(innerB),inner);assert.equal(inner.containingType,type);assert.equal(inner.declaredAccessibility,Accessibility.Public);assert.equal(type.getTypeMembers('Leaf')[0].declaredAccessibility,Accessibility.Private);
  assert.equal(inner.metadataFullName,'App.Outer`1+Inner');assert.equal(inner.isGenericType,true);assert.equal(type.getTypeMembers('Pair',2)[0].typeParameters[1].variance,'out');assert.equal(type.getTypeMembers('Pair',1).length,0);
  const T=type.typeParameters[0];assert.equal(inner.getMembers('value')[0].type,T);assert.equal(inner.getMembers('items')[0].type.elementType,T);assert.equal(inner.getMembers('more')[0].type.toDisplayString(),'System.Collections.Generic.List<T>');
  const get=inner.getMembers('Get')[0];assert.equal(get.arity,1);assert.equal(get.returnType,get.typeParameters[0]);assert.equal(get.typeParameters[0].typeParameterKind,'method');assert.equal(get.parameters[0].type,T);assert.equal(get.toDisplayString(),'App.Outer<T>.Inner.Get<U>(T)');
  // Resolving a nested type by simple name re-enters the type whose members are being built.
  const leafType=type.getTypeMembers('Leaf')[0];assert.equal(leafType.getMembers('peer')[0].type,leafType);assert.equal(leafType.getMembers('up')[0].type,inner);
  const constructed=type.construct(int);assert.equal(constructed.getMembers('first')[0].containingType,constructed);assert.equal(diagnostics.length,0);
});
test('A02-T17 hand-built duplicates: nested types, type kinds, arity and ref kinds',()=>{
  const dupA=cls('N'),dupB=cls('N'),part1=cls('S',[],{modifiers:['partial']}),plain=cls('S'),part2=cls('S',[],{modifiers:['private','partial']}),part3=cls('S',[],{modifiers:['public','partial']});
  const refA=mth('L','void',[prm('a','int',['ref'])]),refB=mth('L','void',[prm('a','int',['out'])]),refC=mth('L','void',[prm('a','int')]),refD=mth('L','void',[prm('b','int',['ref'])]);
  const g1=mth('K','void',[prm('v','V')],{typeParameters:['V']}),g2=mth('K','void',[prm('v','W')],{typeParameters:['W']}),g3=mth('K','void',[prm('v','T')],{typeParameters:['V']});
  const holder=cls('O',[dupA,dupB,fld('N','int'),part1,plain,part2,part3,refA,refB,refC,refD,g1,g2,g3],{typeParameters:['T'],namespace:'N'});
  const q1=cls('Q',[],{typeParameters:['T'],modifiers:['partial']}),q2=cls('Q',[],{typeParameters:['T']}),q3=cls('Q'),q4=node('Struct','Q',{namespace:'',members:[]}),iface=node('Interface','IShape',{namespace:'',members:[mth('Area','double')]});
  const {table,diagnostics}=handBuilt([holder,q1,q2,q3,q4,iface]);table.complete();
  const at=n=>diagnostics.filter(d=>d.node===n).map(d=>[d.code,...d.args]);
  assert.deepEqual(at(dupB),[['CS0102','O<T>','N']]);assert.deepEqual(at(holder.members[2]),[['CS0102','O<T>','N']]);assert.deepEqual(at(plain),[['CS0260','S']]);assert.deepEqual(at(part1),[['CS0262','O<T>.S']]);
  assert.deepEqual(at(refB),[['CS0663','O<T>','method',RefKind.Out,RefKind.Ref]]);assert.deepEqual(at(refC),[]);assert.deepEqual(at(refD),[['CS0111','L','O<T>']]);assert.deepEqual(at(g2),[['CS0111','K','O<T>']]);assert.deepEqual(at(g3),[]);
  assert.deepEqual(at(q2),[['CS0260','Q']]);assert.deepEqual(at(q3),[]);assert.deepEqual(at(q4),[['CS0101','Q','<global namespace>']]);assert.equal(diagnostics.length,9);
  const o=table.typeFor(holder);assert.equal(o.getTypeMembers('S').length,1);assert.equal(o.getTypeMembers('S')[0].declarations.length,4);assert.equal(o.getTypeMembers('N').length,1);assert.equal(table.typeFor(dupB).isDuplicateDeclaration,true);
  assert.equal(table.globalNamespace.getTypeMembers('Q').length,2);assert.equal(table.globalNamespace.lookupType('Q',1).declarations.length,2);assert.equal(table.typeFor(q4).typeKind,TypeKind.Struct);assert.equal(o.getMembers('L')[0].parameters[0].refKind,RefKind.Ref);
  const shape=table.typeFor(iface);assert.equal(shape.typeKind,TypeKind.Interface);assert.equal(shape.baseType,null);assert.deepEqual(names(shape.getMembers()),['Area']);assert.equal(shape.getMembers('Area')[0].declaredAccessibility,Accessibility.Public);
  assert.equal(declarationKind(q4),TypeKind.Struct);assert.equal(declarationKind(refA),null);assert.equal(declarationKind(node('Enum','E')),TypeKind.Enum);assert.equal(declarationKind(node('Delegate','D')),TypeKind.Delegate);
});
test('A02-T17 splitTypeText takes type texts apart',()=>{
  assert.deepEqual(splitTypeText('int'),{name:'int',typeArguments:[],rankSpecifiers:[]});assert.deepEqual(splitTypeText('A.B.Foo[]'),{name:'A.B.Foo',typeArguments:[],rankSpecifiers:[1]});
  assert.deepEqual(splitTypeText('System.Collections.Generic.Dictionary<string, List<int[]>>[][,]'),{name:'System.Collections.Generic.Dictionary',typeArguments:['string','List<int[]>'],rankSpecifiers:[1,2]});
  const {table}=handBuilt([cls('C',[fld('jagged','int[][,]'),fld('nothing',null)])]),c=table.globalNamespace.lookupType('C'),jagged=c.getMembers('jagged')[0].type;
  assert.equal(jagged.toDisplayString(),'int[][,]');assert.equal(jagged.rank,1);assert.equal(jagged.elementType.rank,2);assert.equal(c.getMembers('nothing')[0].type,ErrorTypeSymbol.unknown);
});
