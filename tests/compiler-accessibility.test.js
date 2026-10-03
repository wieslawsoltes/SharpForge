import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isAccessible,checkAccess,checkConstructorAccess,moduleOf,hasInternalAccessTo} from '../packages/compiler/src/binder/accessibility.js';
import {NamedTypeSymbol,ArrayTypeSymbol,PointerTypeSymbol,TypeParameterSymbol,ErrorTypeSymbol,DynamicTypeSymbol,TypeKind,Accessibility} from '../packages/compiler/src/symbols/types.js';
import {NamespaceSymbol,NamespaceExtent} from '../packages/compiler/src/symbols/namespaces.js';
import {MethodSymbol,FieldSymbol,PropertySymbol,ParameterSymbol,LocalSymbol,MethodKind,DeclarationModifiers,accessibilityFromSyntax} from '../packages/compiler/src/symbols/members.js';
import {formatMessage} from '../packages/compiler/src/diagnostics/codes.js';
// Expectations pinned from real Roslyn; regenerate with packages/compiler/test/accessibility/generate-roslyn-accessibility.js.
const pinned=JSON.parse(readFileSync(new URL('../packages/compiler/test/accessibility/roslyn-accessibility.json',import.meta.url),'utf8'));
const corlib=new NamespaceSymbol('',null,NamespaceExtent.Metadata,{name:'corlib'}),system=corlib.ensureNamespace('System');
const object=system.addType(new NamedTypeSymbol({name:'Object',specialType:'System_Object'})),int=system.addType(new NamedTypeSymbol({name:'Int32',specialType:'System_Int32',typeKind:TypeKind.Struct})),voidType=system.addType(new NamedTypeSymbol({name:'Void',specialType:'System_Void',typeKind:TypeKind.Struct}));
const accessOf=(text,fallback)=>accessibilityFromSyntax(text?text.split(' '):[],fallback);
/** Builds the symbol graph a fixture model describes: one module per assembly, types with base types, nested types and members. */
function buildFixture(fixture){
  const types=new Map(),members=new Map(),modules=new Map(),pendingBases=[];
  for(const asm of fixture.assemblies){
    const module={name:asm.name,internalsVisibleTo:asm.internalsVisibleTo},global=new NamespaceSymbol('',null,NamespaceExtent.Source,module);modules.set(asm.name,module);
    const declare=(model,owner,ownerName)=>{
      const name=ownerName?ownerName+'.'+model.name:model.name,symbol=new NamedTypeSymbol({name:model.name,declaredAccessibility:accessOf(model.access,owner?Accessibility.Private:Accessibility.Internal),baseType:()=>model.base?types.get(model.base):object});
      if(owner)owner.addMember(symbol);else global.addType(symbol);types.set(name,symbol);pendingBases.push(symbol);
      let hasConstructor=false;
      for(const m of model.members){
        const init={name:m.name,containingSymbol:symbol,declaredAccessibility:accessOf(m.access,Accessibility.Private),modifiers:m.static?DeclarationModifiers.Static:0};
        const member=m.kind==='field'?new FieldSymbol({...init,type:int}):m.kind==='property'?new PropertySymbol({...init,type:int}):new MethodSymbol({...init,returnType:voidType,methodKind:m.kind==='constructor'?MethodKind.Constructor:MethodKind.Ordinary});
        hasConstructor||=m.kind==='constructor';symbol.addMember(member);members.set(name+'.'+m.name,member);
      }
      if(!hasConstructor){const implicit=new MethodSymbol({name:'.ctor',methodKind:MethodKind.Constructor,returnType:voidType,containingSymbol:symbol,declaredAccessibility:Accessibility.Public,isImplicitlyDeclared:true});symbol.addMember(implicit);members.set(name+'..ctor',implicit);}
      for(const nested of model.types)declare(nested,symbol,name);
    };
    for(const model of asm.types)declare(model,null,'');
  }
  for(const symbol of pendingBases)assert(symbol.baseType,'base type resolves');
  return {types,members,modules};
}
/** What a binder does for one fixture access: the types named in the expression are checked left to right, then the member. */
function bindAccess(graph,access){
  const within=graph.types.get(access.within),isType=graph.types.has(access.target),owner=isType?access.target:access.target.endsWith('..ctor')?access.target.slice(0,-6):access.target.slice(0,access.target.lastIndexOf('.'));
  const member=isType?null:graph.members.get(access.target),named=access.through??owner,parts=named.split('.');
  for(let i=1;i<=parts.length;i++){const error=checkAccess(graph.types.get(parts.slice(0,i).join('.')),within);if(error)return error;}
  if(isType)return null;
  if(member.isConstructor)return checkConstructorAccess(member,within);
  const options=access.through?{throughType:graph.types.get(access.through)}:{};assert.equal(isAccessible(member,within,options),checkAccess(member,within,options)===null);
  return checkAccess(member,within,options);
}
for(const fixture of pinned.fixtures)test(`A02-T25 accessibility matches Roslyn: ${fixture.name}`,()=>{
  const graph=buildFixture(fixture);
  for(const access of fixture.accesses){
    const result=bindAccess(graph,access),label=`${fixture.name}: ${access.target}${access.through?' through '+access.through:''} in ${access.within} (${access.assembly}.cs line ${access.line})`;
    if(access.code===null)assert.equal(result,null,label+' is accessible');
    else if(access.code==='CS0122'||access.code==='CS1540'){assert.equal(result?.code,access.code,label);assert.equal(formatMessage(result.code,result.args),access.message,label);}
    // Roslyn does not import inaccessible members of a referenced assembly (member not found) and reports CS0281 for some
    // friend-assembly accesses; over full symbol graphs both are plain inaccessibility.
    else assert.equal(result?.code,'CS0122',label+` (Roslyn: ${access.code})`);
  }
});
test('A02-T25 the pinned fixtures cover every accessibility and both codes',()=>{
  assert(pinned.fixtures.length>=15);assert.match(pinned.sdk,/^\d+\./);
  const accesses=pinned.fixtures.flatMap(f=>f.accesses),codes=new Set(accesses.map(a=>a.code));assert(codes.has('CS0122')&&codes.has('CS1540')&&codes.has(null));assert(accesses.length>=150);
  const declared=new Set();const visit=t=>{declared.add(t.access);for(const m of t.members)declared.add(m.access);t.types.forEach(visit);};pinned.fixtures.forEach(f=>f.assemblies.forEach(a=>a.types.forEach(visit)));
  for(const access of ['public','private','protected','internal','protected internal','private protected',null])assert(declared.has(access),String(access));
  assert(pinned.fixtures.some(f=>f.assemblies.some(a=>a.internalsVisibleTo.length)));
  for(const f of pinned.fixtures){for(const a of f.assemblies)assert.equal(typeof f.sources[a.name],'string');for(const a of f.accesses)assert.match(f.sources[a.assembly].split('\n')[a.line-1],new RegExp(`__a${a.id}\\(`));}
});
// A hand-built graph for the rules the C# fixtures cannot express through checkAccess options alone.
const lib={name:'Lib'},libGlobal=new NamespaceSymbol('',null,NamespaceExtent.Metadata,lib),source=new NamespaceSymbol('',null,NamespaceExtent.Source,null);
const declare=(container,name,access,options={})=>{const t=new NamedTypeSymbol({name,declaredAccessibility:access,baseType:options.baseType??object,arity:options.arity??0,typeKind:options.typeKind});return container instanceof NamespaceSymbol?container.ensureNamespace(options.namespace??'').addType(t):container.addMember(t);};
const field=(type,name,access,isStatic=false)=>type.addMember(new FieldSymbol({name,type:int,containingSymbol:type,declaredAccessibility:access,modifiers:isStatic?DeclarationModifiers.Static:0}));
const libBase=declare(libGlobal,'Base',Accessibility.Public,{namespace:'Lib.Core'}),libInternal=declare(libGlobal,'Hidden',Accessibility.Internal),internalField=field(libBase,'I',Accessibility.Internal),protectedField=field(libBase,'P',Accessibility.Protected);
const derived=declare(source,'Derived',Accessibility.Internal,{baseType:libBase,namespace:'App'}),other=declare(source,'Other',Accessibility.Internal,{namespace:'App'}),privateField=field(other,'secret',Accessibility.Private);
test('A02-T25 assemblies are identified by the module of the outermost namespace',()=>{
  assert.equal(moduleOf(libBase),lib);assert.equal(moduleOf(internalField),lib);assert.equal(moduleOf(derived),null);assert.equal(moduleOf(privateField),null);assert.equal(moduleOf(libBase.containingNamespace),lib);assert.equal(moduleOf(null),null);
  assert.equal(hasInternalAccessTo(null,null),true);assert.equal(hasInternalAccessTo(null,lib),false);assert.equal(hasInternalAccessTo(lib,lib),true);
  assert.equal(hasInternalAccessTo(null,lib,{internalsVisibleTo:[lib]}),true);assert.equal(hasInternalAccessTo(null,lib,{internalsVisibleTo:new Set(['Lib'])}),true);assert.equal(hasInternalAccessTo(null,lib,{internalsVisibleTo:['Else']}),false);
  assert.equal(hasInternalAccessTo(null,lib,{internalsVisibleTo:(declaring,within)=>declaring===lib&&within===null}),true);assert.equal(hasInternalAccessTo(null,{name:'F',internalsVisibleTo:['App']},{assemblyName:'App'}),true);
  const friend={name:'Friend'};assert.equal(hasInternalAccessTo(friend,{name:'F',internalsVisibleTo:[friend]}),true);assert.equal(hasInternalAccessTo(friend,{name:'F',internalsVisibleTo:['Friend']}),true);assert.equal(hasInternalAccessTo({name:'Foe'},{name:'F',internalsVisibleTo:['Friend']}),false);
});
test('A02-T25 internal access across modules and InternalsVisibleTo options',()=>{
  assert.equal(isAccessible(libBase,other),true);assert.deepEqual(checkAccess(libInternal,other),{code:'CS0122',args:['Hidden']});assert.deepEqual(checkAccess(internalField,derived,{throughType:derived}),{code:'CS0122',args:['Lib.Core.Base.I']});
  assert.equal(checkAccess(libInternal,other,{internalsVisibleTo:[lib]}),null);assert.equal(isAccessible(internalField,derived,{internalsVisibleTo:['Lib']}),true);assert.equal(isAccessible(internalField,libBase),true);
  // Namespace scope (no accessing type): only public and internal reach, and the accessing module can be stated explicitly.
  assert.equal(isAccessible(other,null),true);assert.equal(isAccessible(libInternal,null),false);assert.equal(isAccessible(libInternal,null,{withinModule:lib}),true);assert.equal(isAccessible(privateField,null),false);assert.equal(isAccessible(protectedField,null),false);assert.equal(isAccessible(other,null,{withinModule:lib}),false);
  assert.equal(isAccessible(other,source.getNamespace('App')),true);assert.equal(isAccessible(libInternal,libGlobal),true);
});
test('A02-T25 within may be any symbol and non-member symbols are always accessible',()=>{
  const method=other.addMember(new MethodSymbol({name:'Run',returnType:voidType,containingSymbol:other})),local=new LocalSymbol({name:'x',type:int,containingSymbol:method}),parameter=new ParameterSymbol({name:'p',type:int});
  assert.equal(isAccessible(privateField,method),true);assert.equal(isAccessible(privateField,privateField),true);assert.deepEqual(checkAccess(privateField,derived,{throughType:other}),{code:'CS0122',args:['App.Other.secret']});
  for(const symbol of [local,parameter,new TypeParameterSymbol({name:'T'}),ErrorTypeSymbol.unknown,DynamicTypeSymbol.instance,source,object])assert.equal(isAccessible(symbol,derived),true);
  const lambda=new MethodSymbol({name:'',methodKind:MethodKind.AnonymousFunction,returnType:voidType,containingSymbol:method}),localFunction=new MethodSymbol({name:'f',methodKind:MethodKind.LocalFunction,returnType:voidType,containingSymbol:method});
  assert.equal(isAccessible(lambda,derived),true);assert.equal(isAccessible(localFunction,null),true);
  const topLevel=new MethodSymbol({name:'Main',returnType:voidType,containingSymbol:source});assert.equal(isAccessible(topLevel,derived),true);
});
test('A02-T25 arrays, pointers and constructed types are as accessible as their parts',()=>{
  const hidden=declare(other,'Hidden',Accessibility.Private),box=declare(source,'Box',Accessibility.Public,{arity:1}),inBox=field(box,'value',Accessibility.Protected),boxDerived=declare(source,'IntBox',Accessibility.Public,{baseType:box.construct(int)});
  assert.equal(isAccessible(new ArrayTypeSymbol(hidden),derived),false);assert.equal(isAccessible(new ArrayTypeSymbol(hidden),other),true);assert.equal(isAccessible(new PointerTypeSymbol(hidden),derived),false);assert.equal(isAccessible(new ArrayTypeSymbol(new ArrayTypeSymbol(int)),derived),true);
  assert.equal(isAccessible(box.construct(hidden),derived),false);assert.equal(isAccessible(box.construct(hidden),hidden),true);assert.equal(isAccessible(box.construct(int),derived),true);assert.equal(isAccessible(box,derived),true);
  assert.deepEqual(checkAccess(box.construct(hidden),derived),{code:'CS0122',args:['Box<App.Other.Hidden>']});
  // Protected access ignores construction: Box<int>.value from a class deriving from Box<int>, through Box<string> or itself.
  const constructedField=box.construct(int).getMembers('value')[0];assert.equal(isAccessible(constructedField,boxDerived,{throughType:boxDerived}),true);assert.equal(checkAccess(constructedField,boxDerived,{throughType:box.construct(int)}).code,'CS1540');assert.equal(checkAccess(inBox,derived,{throughType:box.construct(int)}).code,'CS0122');
  assert.equal(isAccessible(inBox,box.construct(int),{throughType:box.construct(object)}),true);
});
test('A02-T25 protected access through type parameters and for interfaces',()=>{
  const constrained=new TypeParameterSymbol({name:'T',constraintTypes:[derived]}),unconstrained=new TypeParameterSymbol({name:'U'}),toBase=new TypeParameterSymbol({name:'V',constraintTypes:[libBase]});
  assert.equal(isAccessible(protectedField,derived,{throughType:constrained}),true);assert.equal(checkAccess(protectedField,derived,{throughType:toBase}).code,'CS1540');assert.deepEqual(checkAccess(protectedField,derived,{throughType:unconstrained}),{code:'CS1540',args:['Lib.Core.Base.P','U','App.Derived']});
  assert.deepEqual(checkAccess(protectedField,derived,{throughType:libBase}).args,['Lib.Core.Base.P','Lib.Core.Base','App.Derived']);assert.equal(checkAccess(protectedField,other,{throughType:libBase}).code,'CS0122');
  const shape=declare(source,'IShape',Accessibility.Public,{typeKind:TypeKind.Interface,baseType:null}),helper=shape.addMember(new MethodSymbol({name:'Helper',returnType:voidType,containingSymbol:shape,declaredAccessibility:Accessibility.Protected,modifiers:DeclarationModifiers.Static}));
  const circle=source.addType(new NamedTypeSymbol({name:'Circle',baseType:object,interfaces:[shape]}));assert.equal(isAccessible(helper,circle),true);assert.equal(isAccessible(helper,other),false);
});
test('A02-T25 constructor access: new on a base type versus a constructor initializer',()=>{
  const baseCtor=libBase.addMember(new MethodSymbol({name:'.ctor',methodKind:MethodKind.Constructor,returnType:voidType,containingSymbol:libBase,declaredAccessibility:Accessibility.Protected}));
  assert.deepEqual(checkConstructorAccess(baseCtor,derived),{code:'CS0122',args:['Lib.Core.Base.Base()']});assert.equal(checkConstructorAccess(baseCtor,derived,{allowProtectedConstructorsOfBaseType:true}),null);
  assert.equal(checkConstructorAccess(baseCtor,libBase),null);assert.equal(checkConstructorAccess(baseCtor,other,{allowProtectedConstructorsOfBaseType:true}).code,'CS0122');assert.equal(checkConstructorAccess(baseCtor,null).code,'CS0122');
});
