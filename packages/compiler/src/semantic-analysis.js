/**
 * Semantic analysis over the lossless syntax tree (SF-A02-E01): the driver that builds source symbols for every
 * declaration form, checks declarations (inheritance, overrides, interface implementation, generic constraints,
 * variance, structs, readonly and ref struct rules, enums, constants) and binds every body with the type-system
 * modules. It produces Roslyn diagnostics, the symbol table and bound trees; it does not emit code.
 *
 * `Compilation.build` consults it for programs that use constructs the execution profile cannot run, so that such a
 * program gets the diagnostics a C# compiler would give and - when it is valid C# - one clear "not executable on
 * this runtime profile" diagnostic instead of a miscompilation.
 */
import {diagnostic} from '@sharpforge/text';
import {languageVersion as parseVersion} from '@sharpforge/syntax';
import {SymbolKind,TypeKind,RefKind,Accessibility,ErrorTypeSymbol,NamedTypeSymbol} from './symbols/types.js';
import {MethodKind,DeclarationModifiers} from './symbols/members.js';
import {mergeGlobalNamespaces} from './symbols/namespaces.js';
import {CoreTypes} from './symbols/core-types.js';
import {frameworkBridge} from './symbols/registry-bridge.js';
import {SourceAssembly} from './symbols/source/syntax-symbols.js';
import {inheritConstraints} from './symbols/source/type-parameters.js';
import {baseTypeChain} from './symbols/substitution.js';
import {TypeBinder} from './binder/type-binder.js';
import {Conversions} from './conversions/classify.js';
import {OverloadResolver} from './overload/resolution.js';
import {OperatorResolver} from './overload/operators.js';
import {resolveBases,checkHiding,effectiveAccessibility,isAtLeastAsAccessible} from './binder/inheritance.js';
import {bindOverrides,checkAbstractImplementation,checkModifiers,findOverridden} from './binder/overrides.js';
import {bindInterfaceImplementations} from './binder/interface-impl.js';
import {checkConstructedType} from './binder/constraints.js';
import {bindEnumMembers} from './binder/enums.js';
import {checkStructLayout,checkStructDeclaration} from './binder/structs.js';
import {checkReadOnlyDeclarations} from './binder/readonly.js';
import {checkRefStructDeclarations,checkAsyncOrIteratorUse} from './binder/ref-struct.js';
import {checkVarianceSafety} from './conversions/variance.js';
import {checkImplicitBaseCall,checkConstructorCycles,constructorInitializerKind} from './binder/constructors.js';
import {createFeatureGate} from './binder/feature-check.js';
import {BodyBinder} from './binder/body-binder.js';
import {isAccessible} from './binder/accessibility.js';
import {formatMessage,defaultSeverity,hasDiagnosticCode} from './diagnostics/codes.js';
import {NullableContextMap} from './nullable/annotations.js';
import {bindCompilationReferences} from './metadata-import/compilation-references.js';
import {analyzeDefiniteAssignment} from './flow/semantic-assignment.js';
import {NullableWalker} from './nullable/walker.js';
import {checkNullableSignatures} from './nullable/signature-checks.js';

const spanOf=node=>node.span??node;
const knownNamespaces=/^(System|Microsoft|Windows)(\.|$)/;

export class SemanticAnalysis{
  /**
   * @param {object[]} files parsed files (`parse()` results with `syntax`, `source`, `directives`)
   * @param {object} [options] compilation options: langVersion, langVersionByUri, nullableContext, name, references (imported global namespaces)
   */
  constructor(files,options={}){
    this.files=files.filter(f=>f.syntax);this.options=options;this.diagnostics=[];this.incomplete=false;this.references=bindCompilationReferences(options.references,options.bridge??frameworkBridge());this.core=new CoreTypes(this.references.coreLibrary);this.sources=new Map(this.files.map(f=>[f.source.uri,f.source]));
    const latest=this.versionOf(this.files[0]?.source.uri).number;
    this.conversions=new Conversions(this.core,{numericIntPtr:latest>=11,firstClassSpans:latest>=14});this.overloads=new OverloadResolver(this.conversions,this.core);this.operators=new OperatorResolver(this.conversions,this.core,this.overloads);
    this.constructions=[];this.nullableMaps=new Map();this.bound=new Map();this.constantState=new Map();this.unexecutable=new Map();
    this.typeBinder=new TypeBinder({core:this.core,report:(uri,node,code,args)=>this.report(uri,node,code,args),constructions:this.constructions,tolerateNamespace:name=>this.tolerateNamespace(name),useSite:(symbol,uri,node)=>{for(const d of this.references.useSiteDiagnostics(symbol))this.report(uri,node,d.code,d.args);},isKnownFrameworkName:name=>this.isKnownFrameworkName(name),get module(){return self.assembly.module;},nullableAnnotationsAt:(uri,position)=>this.nullableAt(uri,position).annotations,get globalNamespace(){return self.globalNamespace;}});
    const self=this;
    this.gate=createFeatureGate(uri=>this.versionOf(uri),(uri,node,code,message)=>this.push(uri,node,code,message,'error'));
    this.assembly=new SourceAssembly(this.files,{core:this.core,typeBinder:this.typeBinder,name:options.name,report:(uri,node,code,args)=>this.report(uri,node,code,args),
      resolveBases:type=>resolveBases(type,{typeBinder:this.typeBinder,core:this.core,report:(uri,node,code,args)=>this.report(uri,node,code,args)})});
    this.globalNamespace=mergeGlobalNamespaces(this.assembly.globalNamespace,...this.references.globalNamespaces);
    for(const d of this.references.diagnostics)this.report(this.files[0]?.source.uri,{start:0,end:0},d.code,d.args);
  }
  versionOf(uri){try{return parseVersion(this.options.langVersionByUri?.[uri]??this.options.langVersion??'default');}catch{return parseVersion('default');}}
  nullableAt(uri,position){let map=this.nullableMaps.get(uri);if(!map){map=new NullableContextMap(this.files.find(f=>f.source.uri===uri)?.directives??[],this.options.nullableContext??this.options.nullable??'disable');this.nullableMaps.set(uri,map);}return map.stateAt(position);}
  /** Namespaces of the BCL the closed registry does not model are accepted in using directives and qualified names. */
  tolerateNamespace(name){if(this.references.hasCoreLibrary)return false;if(knownNamespaces.test(name)){this.incomplete=true;this.hasUnknownUsings=true;return true;}return false;}
  /** Names of common BCL types the registry does not model: using one is not an error, it only makes the analysis incomplete. */
  isKnownFrameworkName(name){if(this.references.hasCoreLibrary)return false;if(frameworkNames.has(name)){this.incomplete=true;return true;}return false;}
  /** True when every base class of `type` is declared in source (or is one of the fully modelled roots), so a missing member really is missing. */
  closedHierarchy(type){
    if(this.hasUnknownUsings)return false;if(type.typeKind===TypeKind.TypeParameter)return !type.hasUnknownConstraint&&[...type.constraintTypes].every(c=>this.closedHierarchy(c));
    if(type.typeKind===TypeKind.Delegate||type.elementType)return false;
    for(const t of baseTypeChain(type,this.core)){if(isSourceSymbol(t))continue;if(['System_Object','System_ValueType','System_Enum'].includes(t.specialType))continue;return false;}
    return type.typeKind!==TypeKind.Interface||isSourceSymbol(type)&&type.allInterfaces.every(i=>isSourceSymbol(i));
  }
  /** The registry lists a subset of each framework type's members, so a missing member proves nothing. */
  registryIsComplete(){return false;}
  isError(code){return defaultSeverity(code)==='error';}
  report(uri,node,code,args=[],severity){if(!hasDiagnosticCode(code)){this.incomplete=true;return;}this.push(uri,node,code,formatMessage(code,args),severity??defaultSeverity(code));}
  push(uri,node,code,message,severity){
    const source=this.sources.get(uri)??this.files[0]?.source;if(!source||this.diagnostics.length>=400)return;const s=spanOf(node),start=s.start??0,length=Math.max(code==='CS0162'||s.end>start?(s.end??start)-start:1,s.end===start?0:1);
    if(this.diagnostics.some(d=>d.code===code&&d.uri===source.uri&&d.start===start&&d.message===message))return;
    this.diagnostics.push(diagnostic(source,start,length||1,code,message,severity));
  }
  /** Runs every phase and returns `{diagnostics,incomplete,assembly,bound,unexecutable}`. */
  run(){
    this.assembly.declare(this.globalNamespace);
    // `record` declarations are not parsed yet (they arrive as a method named after the record): nothing can be said about such a file.
    if(this.assembly.topLevel.some(i=>i.statement?.kind==='LocalFunctionStatement'&&i.statement.returnType?.toString()==='record'))return {diagnostics:[],incomplete:true,unsupported:true,assembly:this.assembly,bound:this.bound,core:this.core,unexecutable:this.unexecutable};
    const types=this.assembly.types;
    for(const type of types)type.baseType;
    for(const type of types)type.getMembers();
    for(const type of types)this.bindExplicitInterfaces(type);
    for(const type of types)this.checkType(type);
    this.checkConstructions();
    for(const type of types)this.bindConstants(type);
    this.bindBodies();
    this.reportUnused();
    return {diagnostics:this.diagnostics,incomplete:this.incomplete,assembly:this.assembly,bound:this.bound,core:this.core,unexecutable:this.unexecutable};
  }
  at(symbol){return symbol.locations?.[0]??this.assembly.types[0]?.locations[0];}
  reportAt(symbol,code,args,severity){const at=this.at(symbol);if(at)this.report(at.uri,at,code,args,severity);}
  bindExplicitInterfaces(type){
    for(const m of type.getMembers()){
      if(!m.explicitInterfaceSyntax||m.explicitInterfaceType!==undefined)continue;
      m.explicitInterfaceType=this.typeBinder.bindType(m.explicitInterfaceSyntax,m.scope??type.primaryScope).type;
      for(const a of [m.getMethod,m.setMethod])if(a)a.explicitInterfaceType=m.explicitInterfaceType;
    }
  }
  checkType(type){
    const core=this.core,version=this.versionOf(type.locations[0].uri).number;
    if(type.typeKind===TypeKind.Enum){bindEnumMembers(type,core,(syntax,scope,field)=>this.evaluateConstant(syntax,scope,type,null),(uri,node,code,args)=>this.report(uri,node,code,args));return;}
    for(const d of checkHiding(type,core))this.reportAt(d.member,d.code,d.args);
    for(const d of bindOverrides(type,core,this.conversions)){this.reportAt(d.member,d.code,d.args);}
    for(const m of type.getMembers()){
      if(m.hasCovariantReturn)this.gate(this.at(m).uri,this.at(m),'covariantReturns',{name:'covariant returns',version:9});
      // An override or explicit implementation takes its constraints from the member it overrides.
      if(m.inheritsConstraints&&m.kind===SymbolKind.Method){const base=m.overriddenMethod??null;if(base)inheritConstraints([...m.typeParameters],[...base.typeParameters],t=>t.typeKind===TypeKind.TypeParameter&&base.typeParameters.includes(t)?m.typeParameters[base.typeParameters.indexOf(t)]:t);}
      for(const d of checkModifiers(m,type))this.reportAt(m,d.code,d.args);
      this.checkMemberAccessibility(m,type);
      if(m.kind===SymbolKind.Method&&type.typeKind===TypeKind.Interface&&m.hasBody&&!m.isStatic&&m.methodKind===MethodKind.Ordinary)this.gate(this.at(m).uri,this.at(m),'defaultInterfaceImplementation',{name:'default interface implementation',version:8});
      if(type.typeKind===TypeKind.Interface&&m.isStatic&&(m.isAbstract||(m.modifierWords??[]).includes('virtual')))this.gate(this.at(m).uri,this.at(m),'staticAbstractMembers',{name:'static abstract members in interfaces',version:11});
      if(m.kind===SymbolKind.Method)for(const p of m.parameters){const bad=p.type&&!p.type.isErrorType()?checkAsyncOrIteratorUse(p.type,'parameter',{isAsync:m.isAsync,isIterator:false},version):null;if(bad)this.reportAt(p,bad.code,bad.args);}
    }
    for(const d of checkAbstractImplementation(type,core))this.reportAt(type,d.code,d.args);
    const impl=bindInterfaceImplementations(type,core);type.interfaceImplementations=impl.map;
    for(const d of impl.diagnostics){
      if(d.interface){const listed=[...type.interfaceSyntax??[]].find(([i])=>i.equals(d.interface)||baseOrSelf(i,d.interface,core));if(listed)this.report(listed[1].uri,listed[1].syntax,d.code,d.args);else this.reportAt(type,d.code,d.args);}
      else if(d.onInterfaceName&&d.member.explicitInterfaceSyntax)this.report(this.at(d.member).uri,d.member.explicitInterfaceSyntax,d.code,d.args);
      else this.reportAt(d.member,d.code,d.args);
    }
    for(const d of checkStructLayout(type))this.reportAt(d.field,d.code,d.args);
    for(const d of checkStructDeclaration(type,version)){if(d.feature)this.gate(this.at(d.member).uri,this.at(d.member),d.feature.name,d.feature);else this.reportAt(d.member,d.code,d.args);}
    for(const d of checkReadOnlyDeclarations(type))this.reportAt(d.member,d.code,d.args);
    for(const d of checkRefStructDeclarations(type,version)){if(d.feature)this.gate(this.at(type).uri,this.at(type),d.feature.name,d.feature);else if(d.onType&&(d.member.typeSyntax))this.report(this.at(d.member).uri,d.member.typeSyntax,d.code,d.args);else this.reportAt(d.member,d.code,d.args);}
    if(type.typeKind===TypeKind.Interface||type.typeKind===TypeKind.Delegate)for(const d of checkVarianceSafety(type)){const target=d.where&&typeof d.where==='object'&&d.where.syntax?.type?{uri:this.at(d.where).uri,node:d.where.syntax.type}:d.where==='return'&&d.member.returnTypeSyntax?{uri:d.member.uri??this.at(d.member).uri,node:d.member.returnTypeSyntax}:d.where==='type'&&d.member.typeSyntax?{uri:this.at(d.member).uri,node:d.member.typeSyntax}:null;if(target)this.report(target.uri,target.node,d.code,d.args);else this.reportAt(d.member,d.code,d.args);}
    if(type.isReadOnly&&type.typeKind===TypeKind.Struct)this.gate(this.at(type).uri,this.at(type),'readonlyStructs',{name:'readonly structs',version:7.2});
    if(type.isRefLikeType)this.gate(this.at(type).uri,this.at(type),'refStructs',{name:'ref structs',version:7.2});
    // Nullable reference type signature agreement between overrides/implementations and their bases.
    if(this.nullableAt(this.at(type).uri,this.at(type).start).warnings)for(const d of checkNullableSignatures(type))this.reportAt(d.member,d.code,d.args,'warning');
  }
  /** CS0050-CS0059: a member may not expose a type less accessible than itself. */
  checkMemberAccessibility(m,type){
    if(m.isImplicitlyDeclared||m.explicitInterfaceSyntax)return;
    const rank=Math.min(effectiveAccessibility(type),accessRank(m.declaredAccessibility));if(rank<=accessRank(Accessibility.Private))return;
    const check=(t,code,args)=>{if(t&&!t.isErrorType?.()&&!isAtLeastAsAccessible(t,rank))this.reportAt(m,code,args(t));};
    const display=m.toDisplayString();
    if(m.kind===SymbolKind.Field)check(m.type,'CS0052',t=>[display,t.toDisplayString()]);
    else if(m.kind===SymbolKind.Property){check(m.type,m.isIndexer?'CS0054':'CS0053',t=>[display,t.toDisplayString()]);for(const p of m.parameters)check(p.type,'CS0055',t=>[display,t.toDisplayString()]);}
    else if(m.kind===SymbolKind.Event)check(m.type,'CS7025',t=>[display,t.toDisplayString()]);
    else if(m.kind===SymbolKind.Method&&!m.isAccessor){
      if(!m.isConstructor&&m.methodKind!==MethodKind.Destructor)check(m.returnType,m.methodKind===MethodKind.UserDefinedOperator||m.methodKind===MethodKind.Conversion?'CS0056':'CS0050',t=>[display,t.toDisplayString()]);
      for(const p of m.parameters)check(p.type,m.methodKind===MethodKind.UserDefinedOperator||m.methodKind===MethodKind.Conversion?'CS0057':'CS0051',t=>[display,t.toDisplayString()]);
    }
  }
  /** Constraint checks for every constructed type written in source (deferred until all declarations are known). */
  checkConstructions(){
    for(const c of this.constructions){const type=c.type;if(!type||type.isErrorType?.())continue;
      for(const v of checkConstructedType(type,this.core)){const index=v.type===type?v.index:null,node=index!==null&&c.argSyntax[index]?c.argSyntax[index]:c.syntax;this.report(c.scope.uri,node,v.code,v.args,v.severity);}}
  }
  /** Evaluates a constant expression in a declaration context (const fields, enum members, parameter defaults). */
  evaluateConstant(syntax,scope,containingType,targetType){
    const binder=new BodyBinder(this,{uri:scope.uri,scope,containingType,method:null,isStatic:true,isFieldInitializer:true,isStaticInitializer:true,parameters:[],enumInitializerOf:containingType?.typeKind===TypeKind.Enum?containingType:null});
    return binder.constant(syntax,targetType);
  }
  /** The constant value of a const field or enum member (bound on demand; circular definitions are CS0110). */
  constantOf(field){
    if(field.isEnumMember){if(field.constantValue===undefined){const type=field.containingType;bindEnumMembers(type,this.core,(syntax,scope)=>this.evaluateConstant(syntax,scope,type,null),(uri,node,code,args)=>this.report(uri,node,code,args));}return field.constantValue??null;}
    if(!field.isConst||!field.isSource&&!field.initializerSyntax)return field.hasConstantValue&&field.constantValue instanceof Object?field.constantValue:null;
    const state=this.constantState.get(field);
    if(state==='done')return field.constantValueObject??null;
    if(state==='active'){this.reportAt(field,'CS0110',[field.toDisplayString()]);this.constantState.set(field,'done');field.constantValueObject=null;return null;}
    this.constantState.set(field,'active');let value=null;
    if(field.initializerSyntax){
      const r=this.evaluateConstant(field.initializerSyntax,field.scope,field.containingType,field.type);
      if(this.constantState.get(field)==='done')return null;
      if(!r.errors){if(r.constant)value=r.constant;else if(!(r.bound?.literal==='null'))this.report(field.uri,field.initializerSyntax,'CS0133',[field.toDisplayString()]);}
    }else this.reportAt(field,'CS0145');
    field.constantValueObject=value;this.constantState.set(field,'done');return value;
  }
  bindConstants(type){
    if(type.typeKind===TypeKind.Enum)return;
    for(const m of type.getMembers())if(m.kind===SymbolKind.Field&&m.isConst){this.constantOf(m);const t=m.type;if(t&&!t.isErrorType()&&t.isValueType===true&&t.typeKind===TypeKind.Struct&&!t.specialType&&m.typeSyntax)this.report(m.uri,m.typeSyntax,'CS0283',[t.toDisplayString()]);}
  }
  bindParameterDefault(p,binder){
    if(!p.defaultSyntax||p.defaultBound)return;p.defaultBound=true;
    const r=binder.constant(p.defaultSyntax,p.type);
    if(!r.errors){if(r.constant)p.explicitDefaultValue=r.constant;else if(r.bound&&!(r.bound.literal||r.bound.kind==='Default'||r.bound.kind==='ObjectCreation'&&!r.bound.args?.length||r.bound.operand?.literal||r.bound.operand?.kind==='Default'))binder.report(p.defaultSyntax,'CS1736',[p.name]);}
  }
  context(member,type,extra={}){return {uri:member.uri??this.at(member)?.uri,scope:member.scope??type.primaryScope,containingType:type,method:member.kind===SymbolKind.Method?member:null,isStatic:member.isStatic,isFieldInitializer:false,...extra};}
  /** Binds the body of a method-like symbol and runs the flow passes over it. */
  bindMethodBody(method,context){
    const syntax=method.syntax,isAsync=method.isAsync,declared=method.returnType;
    let returnType=declared;
    if(isAsync&&declared){if(declared.originalDefinition===this.core.taskT||declared.name==='ValueTask'&&declared.typeArguments?.length===1)returnType=declared.typeArguments[0].type;else if(declared.equals(this.core.task)||declared.name==='ValueTask')returnType=this.core.void;
      else if(declared.specialType!=='System_Void'&&!declared.isErrorType()&&!['IAsyncEnumerable','IAsyncEnumerator'].includes(declared.name)&&isClosedType(declared))this.report(context.uri,method.locations[0],'CS1983');}
    const binder=new BodyBinder(this,{...context,method,returnType,declaredReturnType:declared,returnRefKind:method.refKind??RefKind.None,isAsync,isIterator:false,parameters:method.parameters});
    for(const p of method.parameters)if(p.defaultSyntax)this.bindParameterDefault(p,binder);
    let body=null;
    if(syntax.body??syntax.block)body=binder.block(syntax.body??syntax.block);
    else if(syntax.expressionBody){
      const expression=syntax.expressionBody.expression,e=binder.expression(expression);
      if(!returnType||returnType.specialType==='System_Void'||method.isConstructor||method.methodKind===MethodKind.PropertySet||method.methodKind===MethodKind.Destructor){const v=e.kind==='TypeExpression'||e.kind==='NamespaceExpression'?binder.asValue(e):e;if(!v.hasErrors&&!binder.isStatementExpression(expression))binder.report(expression,'CS0201');body={kind:'ExpressionBody',syntax:expression,completes:true,expression:v};}
      else{const v=binder.asValue(e),converted=binder.convert(v,returnType,expression);if(v.form==='lambda'&&!converted.hasErrors)binder.finishLambda(v,returnType);body={kind:'ExpressionBody',syntax:expression,completes:false,expression:converted,isReturn:true};}
    }
    if(body){
      const needsValue=returnType&&returnType.specialType!=='System_Void'&&!returnType.isErrorType?.()&&!method.isConstructor;
      if(body.completes&&needsValue&&!binder.isIterator&&!binder.c.isIterator&&!binder.usesGoto&&!binder.hasLabelsAnywhere&&body.kind==='Block')this.report(context.uri,method.methodKind===MethodKind.PropertyGet&&method.syntax.keyword?method.syntax.keyword:method.locations[0]??syntax,'CS0161',[method.methodKind===MethodKind.PropertyGet&&method.associatedSymbol?method.associatedSymbol.toDisplayString()+'.get':method.toDisplayString()]);
      body.locals=binder.locals;body.binder=binder;this.bound.set(method,body);
      if(!context.parent){
        for(const d of analyzeDefiniteAssignment(method,body,{core:this.core,languageVersion:this.versionOf(context.uri).number,containingType:context.containingType}))this.report(context.uri,d.node,d.code,d.args);
        if(this.nullableMaps.get(context.uri)?.anyWarnings??this.nullableAt(context.uri,0).warnings)for(const d of new NullableWalker(this,context.uri).analyze(method,body))this.report(context.uri,d.node,d.code,d.args,'warning');
      }
    }
    return body;
  }
  bindBodies(){
    for(const member of this.assembly.bodies){
      const type=member.containingType;if(!type)continue;
      if(member.kind===SymbolKind.Method){
        if(member.isPrimaryConstructor){this.bindConstructorInitializer(member,type,new BodyBinder(this,this.context(member,type,{parameters:member.parameters})));continue;}
        const context=this.context(member,type);
        if(member.methodKind===MethodKind.Constructor&&member.initializerSyntax){const binder=new BodyBinder(this,{...context,parameters:member.parameters,isConstructorInitializer:true});this.bindConstructorInitializer(member,type,binder);}
        this.bindMethodBody(member,context);
      }else{
        // Field, auto-property and field-like event initializers.
        const binder=new BodyBinder(this,{uri:member.uri,scope:member.scope,containingType:type,method:null,isStatic:member.isStatic,isFieldInitializer:true,isStaticInitializer:member.isStatic,parameters:type.primaryConstructor&&!member.isStatic?type.primaryConstructor.parameters:[]});
        const init=member.initializerSyntax;let value;
        if(init.kind==='ArrayInitializerExpression'){value=member.type?.elementType?{kind:'ArrayCreation',syntax:init,type:member.type,elements:binder.arrayInitializer(init,member.type.elementType,member.type.rank)}:binder.bad(init);if(member.type&&!member.type.isErrorType()&&!member.type.elementType)binder.report(init,'CS0622');}
        else{const raw=binder.value(init);value=member.type?binder.convert(raw,member.type,init):raw;if(raw.form==='lambda'&&!value.hasErrors)binder.finishLambda(raw,member.type);}
        if(member.kind===SymbolKind.Field){member.writes=(member.writes??0)+1;if(!(value.constantValue||value.literal||value.kind==='Default'))member.nonConstantWrite=true;}
        if(member.kind===SymbolKind.Property&&!member.isAutoProperty)this.reportAt(member,'CS8050');
        this.bound.set(member,{kind:'Initializer',syntax:init,expression:value,binder});
      }
    }
    // Constructors without an initializer call base() implicitly: the base needs an accessible parameterless constructor.
    for(const type of this.assembly.types){
      if(type.typeKind!==TypeKind.Class||type.isStatic||type.hasCircularBase)continue;
      const ctors=type.getMembers('.ctor').filter(c=>c.methodKind===MethodKind.Constructor);
      for(const ctor of ctors){
        if(ctor.isCopyConstructor||constructorInitializerKind(ctor,type)!=='implicitBase'||ctor.isPrimaryConstructor&&ctor.baseArgumentsSyntax)continue;
        const problem=checkImplicitBaseCall(type,this.overloads);if(problem){this.reportAt(ctor.isImplicitlyDeclared?type:ctor,problem.code,problem.args);break;}
      }
      for(const d of checkConstructorCycles(type,c=>c.thisTarget??null))this.report(this.at(d.ctor).uri,d.ctor.initializerSyntax?.thisOrBaseKeyword??this.at(d.ctor),d.code,d.args);
    }
    this.bindTopLevel();
  }
  bindConstructorInitializer(ctor,type,binder){
    const init=ctor.initializerSyntax,isThis=init?.kind==='ThisConstructorInitializer',argList=init?.argumentList??ctor.baseArgumentsSyntax;
    const savedStatic=binder.c.isStatic;binder.c.isStatic=true;binder.c.isConstructorArguments=true;   // arguments cannot use `this`
    const args=binder.arguments(argList);binder.c.isStatic=savedStatic;
    const target=isThis?type:type.baseType;if(!target||target.isErrorType?.())return;
    if(type.typeKind===TypeKind.Struct&&!isThis&&init){binder.report(init.thisOrBaseKeyword,'CS0522',[ctor.toDisplayString()]);return;}
    const all=target.getMembers('.ctor').filter(c=>c.methodKind===MethodKind.Constructor&&!c.isCopyConstructor),accessible=all.filter(c=>isAccessible(c.originalDefinition??c,type.originalDefinition,{throughType:type.originalDefinition}));
    if(!all.length){this.incomplete=true;return;}
    const r=this.overloads.resolve(accessible,args,{isConstructor:true});
    const at=init?.thisOrBaseKeyword??argList;
    if(!r.succeeded){if(args.some(a=>a.hasErrors))return;if(!isSourceSymbol(target)){this.incomplete=true;return;}const e=r.error;binder.report(binder.errorNode(e,args,at),e.code,e.code==='CS1729'?[target.toDisplayString(),args.length]:e.args);return;}
    const call=binder.finishCall(r,null,args,init??argList,{});
    if(isThis)ctor.thisTarget=r.method.originalDefinition??r.method;else ctor.baseTarget=r.method;
    this.bound.set({kind:'ConstructorInitializer',ctor},call);ctor.initializerCall=call;
  }
  /** Top-level statements are the body of the synthesized `<Main>$`; top-level methods become its local functions. */
  bindTopLevel(){
    const byFile=new Map();for(const item of this.assembly.topLevel){if(!byFile.has(item.file))byFile.set(item.file,[]);byFile.get(item.file).push(item);}
    for(const [file,items] of byFile){
      const statements=items.filter(i=>i.statement).map(i=>i.statement);if(!statements.length)continue;
      const scope=items[0].scope,uri=file.source.uri,usesAwait=statements.some(s=>containsAwait(s));
      const program=this.programType??=Object.assign(new NamedTypeSymbol({name:'Program',typeKind:TypeKind.Class,containingSymbol:this.assembly.globalNamespace,declaredAccessibility:Accessibility.Internal,baseType:()=>this.core.object,isImplicitlyDeclared:true}),{isSource:true});
      const binder=new BodyBinder(this,{uri,scope,containingType:program,method:null,isStatic:true,isFieldInitializer:false,isTopLevel:true,isAsync:usesAwait,returnType:null,parameters:[{name:'args',kind:SymbolKind.Parameter,type:this.core.arrayOf(this.core.string),refKind:RefKind.None,isImplicitlyDeclared:true}]});
      const body=binder.block({statements,span:file.syntax.span,kind:'Block'},{statements});body.locals=binder.locals;body.binder=binder;this.bound.set(file,body);
      for(const d of analyzeDefiniteAssignment(null,body,{core:this.core,languageVersion:this.versionOf(uri).number,containingType:null}))this.report(uri,d.node,d.code,d.args);
      if(this.nullableMaps.get(uri)?.anyWarnings??this.nullableAt(uri,0).warnings)for(const d of new NullableWalker(this,uri).analyze(null,body))this.report(uri,d.node,d.code,d.args,'warning');
    }
  }
  /** CS0168 / CS0219 (locals), CS8321 (local functions), CS0164 (labels), CS0169 / CS0414 / CS0649 (private fields). */
  reportUnused(){
    for(const body of this.bound.values()){
      const binder=body.binder;if(!binder||binder.c.parent)continue;
      for(const local of binder.allLocals??[]){
        if(local.reads||local.isPatternLocal||local.isForEach||local.isUsing||local.name==='_'||binder.usedBeforeDeclaration?.has(local.name))continue;
        const at=local.locations[0];if(!at)continue;
        if(!local.writes||local.isCatch)this.report(binder.c.uri,at,'CS0168',[local.name]);
        else if(!local.nonConstantWrite&&!local.isOutVar)this.report(binder.c.uri,at,'CS0219',[local.name]);
      }
      for(const f of binder.allLocalFunctions??[])if(!f.method.uses)this.report(f.uri,f.method.locations[0],'CS8321',[f.method.name]);
      for(const l of binder.allLabels??[])if(!l.label.uses)this.report(l.uri,l.node,'CS0164');
    }
    // Roslyn reports unused-field warnings only for a compilation without errors.
    if(this.incomplete)return;
    for(const type of this.assembly.types){
      if(type.typeKind!==TypeKind.Class&&type.typeKind!==TypeKind.Struct)continue;
      for(const f of type.getMembers()){
        if(f.kind!==SymbolKind.Field||f.isConst||f.isImplicitlyDeclared||!f.type||f.type.isErrorType())continue;
        const rank=Math.min(effectiveAccessibility(type),accessRank(f.declaredAccessibility)),isPrivate=f.declaredAccessibility===Accessibility.Private,isInternal=!isPrivate&&rank<=accessRank(Accessibility.Internal);
        if(!isPrivate&&!isInternal)continue;
        if(!f.reads&&!f.writes){if(isPrivate)this.reportAt(f,'CS0169',[f.toDisplayString()]);else this.reportAt(f,'CS0649',[f.toDisplayString(),defaultText(f.type)]);}
        else if(!f.writes)this.reportAt(f,'CS0649',[f.toDisplayString(),defaultText(f.type)]);
        else if(!f.reads&&isPrivate&&!f.nonConstantWrite)this.reportAt(f,'CS0414',[f.toDisplayString()]);
      }
    }
  }
}
const frameworkNames=new Set('DateTime DateTimeOffset TimeSpan Guid Random Tuple ValueTuple Lazy Nullable Func Action Predicate Comparison Converter EventHandler EventArgs Delegate Attribute Type Uri Version Array Buffer BitConverter Convert Environment GC Math MathF Console String Char Int32 Int64 Double Decimal Boolean Byte Object Enum Exception ArgumentException ArgumentNullException ArgumentOutOfRangeException InvalidOperationException NotSupportedException NotImplementedException FormatException OverflowException DivideByZeroException NullReferenceException IndexOutOfRangeException InvalidCastException KeyNotFoundException ArithmeticException ApplicationException SystemException AggregateException OperationCanceledException TimeoutException ObjectDisposedException StackOverflowException OutOfMemoryException IOException FileNotFoundException UnauthorizedAccessException IDisposable IAsyncDisposable IComparable IEquatable IFormattable ICloneable IEnumerable IEnumerator ICollection IList IDictionary IReadOnlyList IReadOnlyCollection IReadOnlyDictionary ISet IComparer IEqualityComparer IAsyncEnumerable IAsyncEnumerator IGrouping IOrderedEnumerable IQueryable ILookup IObserver IObservable IProgress List Dictionary HashSet SortedSet SortedDictionary SortedList Queue Stack LinkedList KeyValuePair Comparer EqualityComparer Enumerable Queryable StringBuilder Encoding Regex Match Task ValueTask CancellationToken CancellationTokenSource Thread Interlocked Monitor Volatile Timer Stopwatch Debug Trace File Directory Path Stream StreamReader StreamWriter TextReader TextWriter StringReader StringWriter MemoryStream FileStream BinaryReader BinaryWriter Span ReadOnlySpan Memory ReadOnlyMemory Index Range Activator Expression CultureInfo NumberStyles StringComparison StringComparer StringSplitOptions DayOfWeek MidpointRounding FlagsAttribute ObsoleteAttribute SerializableAttribute Flags Obsolete Serializable Conditional CallerMemberName NotNull MaybeNull NotNullWhen MaybeNullWhen AllowNull DisallowNull DoesNotReturn MemberNotNull HashCode WeakReference IntPtr UIntPtr BigInteger Complex Vector2 Vector3 Half Int128 UInt128 Rune JsonSerializer HttpClient ImmutableArray ImmutableList ConcurrentDictionary ConcurrentQueue ConcurrentBag BlockingCollection ObservableCollection ReadOnlyCollection Collection ArrayList Hashtable BitArray PriorityQueue TaskCompletionSource Parallel SemaphoreSlim Mutex Lock ThreadLocal AsyncLocal Unsafe MemoryMarshal CollectionsMarshal Nullable'.split(' '));
const accessRank=a=>[Accessibility.Private,Accessibility.ProtectedAndInternal,Accessibility.Protected,Accessibility.Internal,Accessibility.ProtectedOrInternal,Accessibility.Public].indexOf(a);
const baseOrSelf=(listed,iface,core)=>listed.allInterfaces?.some(i=>i.equals(iface));
const isSourceSymbol=s=>{for(let x=s?.originalDefinition??s;x;x=x.containingSymbol)if(x.isSource)return true;return false;};
const isClosedType=t=>isSourceSymbol(t)||!!t.specialType;
const defaultText=type=>!type||type.isReferenceType===true||type.isNullableValueType?'null':type.specialType==='System_Boolean'?'false':type.typeKind===TypeKind.Struct&&!type.specialType?'':'0';
function containsAwait(node){if(node.kind==='AwaitExpression')return true;if(node.kind==='LocalFunctionStatement'||node.kind.endsWith('LambdaExpression')||node.kind==='AnonymousMethodExpression')return false;if((node.kind==='LocalDeclarationStatement'||node.kind==='UsingStatement'||node.kind==='ForEachStatement')&&node.awaitKeyword)return true;for(const c of node.childNodes())if(containsAwait(c))return true;return false;}
/** Analyses parsed files and returns `{diagnostics,incomplete,assembly,bound,core}`. */
export function analyze(files,options={}){return new SemanticAnalysis(files,options).run();}
export {ErrorTypeSymbol,DeclarationModifiers,baseTypeChain,findOverridden};
