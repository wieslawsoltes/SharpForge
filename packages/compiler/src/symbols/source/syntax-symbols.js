/**
 * Source symbols built from the lossless syntax tree: every declaration form the parser accepts - namespaces,
 * classes, structs, interfaces, enums, delegates, records, nested and generic types, fields, methods, constructors,
 * properties, indexers, events, operators and conversions - becomes a symbol of the model in ../types.js and
 * ../members.js. Types are declared eagerly (name, arity, container); base types, interfaces and members are bound on
 * first use, so declaration order and cross-file references do not matter.
 *
 * Reports CS0101/CS0260/CS0262 (duplicate and partial types), CS0102/CS0111 (duplicate members), CS0542 (member
 * named like its type), CS0100 (duplicate parameter) and the modifier checks the declaration alone decides.
 */
import {NamedTypeSymbol,TypeKind,Accessibility,RefKind,SymbolKind,TypeWithAnnotations} from '../types.js';
import {MethodSymbol,FieldSymbol,PropertySymbol,EventSymbol,ParameterSymbol,MethodKind,DeclarationModifiers,modifiersFromSyntax,accessibilityFromSyntax} from '../members.js';
import {NamespaceSymbol,NamespaceExtent} from '../namespaces.js';
import {Scope} from '../../binder/type-binder.js';
import {declareTypeParameters,bindConstraintClauses,inheritConstraints} from './type-parameters.js';
import {binaryOperatorNames,unaryOperatorNames} from '../../overload/operators.js';

const typeKinds={ClassDeclaration:TypeKind.Class,StructDeclaration:TypeKind.Struct,InterfaceDeclaration:TypeKind.Interface,EnumDeclaration:TypeKind.Enum,DelegateDeclaration:TypeKind.Delegate,RecordDeclaration:TypeKind.Class,RecordStructDeclaration:TypeKind.Struct};
export const isTypeDeclaration=node=>Object.hasOwn(typeKinds,node.kind);
const words=tokens=>tokens.map(t=>t.text);
const spanOf=node=>{const s=node.span;return {start:s.start,end:s.end};};
const twa=t=>t instanceof TypeWithAnnotations?t:new TypeWithAnnotations(t);

/** A class, struct, interface, enum or delegate declared in source (all partial declarations together). */
export class SourceTypeSymbol extends NamedTypeSymbol{
  constructor(assembly,init,declaration){
    super(init);this.assembly=assembly;this.declarations=[declaration];this.syntax=declaration.syntax;this._nested=[];this._built=null;this._baseState=0;this._declaredBase=undefined;this._declaredInterfaces=null;this.isResolvingBase=false;this.isSource=true;
  }
  get baseType(){this.assembly.resolveBases(this);return this._declaredBase??null;}
  get interfaces(){this.assembly.resolveBases(this);return this._declaredInterfaces??[];}
  getTypeMembers(name,arity){return this._nested.filter(t=>(name===undefined||t.name===name)&&(arity===undefined||t.arity===arity));}
  getMembers(name){const all=this._built??=this.assembly.buildMembers(this);return name===undefined?all:all.filter(m=>m.name===name);}
  addMember(member){this.getMembers().push(member);member.containingSymbol=this;return member;}
  /** The scope members of one declaration are bound in (its file, namespaces, usings, containing types, this type). */
  scopeFor(declaration){return declaration.memberScope??=declaration.scope.child('type',{type:this});}
  get primaryScope(){return this.scopeFor(this.declarations[0]);}
  get isPartial(){return this.declarations.some(d=>words(d.syntax.modifiers).includes('partial'));}
}

export class SourceAssembly{
  /**
   * @param {{source:{uri:string,text:string},syntax:object}[]} files parsed files (red trees)
   * @param {{core:object, typeBinder:object, report:(uri,node,code,args)=>void, name?:string, evaluateConstant?:Function}} host
   */
  constructor(files,host){
    this.files=files;this.host=host;this.core=host.core;this.module=Object.freeze({name:host.name??'Application',kind:'source'});
    this.globalNamespace=new NamespaceSymbol('',null,NamespaceExtent.Source,this.module);this.types=[];this.unitScopes=new Map();this.topLevel=[];this.bodies=[];
  }
  report(uri,node,code,args=[]){this.host.report(uri,node,code,args);}
  /** Declares every type of every file; `merged` is the global namespace lookups go through (source + references). */
  declare(merged){
    this.merged=merged;
    const globalUsings=this.files.flatMap(f=>f.syntax.usings.filter(u=>u.globalKeyword).map(u=>u));
    for(const file of this.files){
      const uri=file.source.uri,unit=new Scope('unit',{namespace:merged,sourceNamespace:this.globalNamespace,usings:{directives:[...file.syntax.usings.filter(u=>!u.globalKeyword)],global:globalUsings,bound:null},uri});
      this.unitScopes.set(uri,unit);this.declareMembers(file.syntax.members,unit,this.globalNamespace,null,file);
    }
    return this;
  }
  declareMembers(members,scope,namespace,container,file){
    for(const member of members){
      if(member.kind==='NamespaceDeclaration'||member.kind==='FileScopedNamespaceDeclaration'){
        let ns=namespace,inner=scope;
        // `namespace A.B` nests one scope per name part; the usings belong to the innermost.
        const parts=nameParts(member.name);
        parts.forEach((part,i)=>{ns=ns.getOrAddNamespace(part);const merged=inner.namespace.getNamespace(part)??ns;inner=inner.child('namespace',{namespace:merged,sourceNamespace:ns,usings:i===parts.length-1?{directives:[...member.usings],global:[],bound:null}:null});});
        this.declareMembers(member.members,inner,ns,null,file);
      }else if(isTypeDeclaration(member))this.declareType(member,scope,namespace,container,file);
      else if(member.kind==='GlobalStatement')this.topLevel.push({statement:member.statement,scope,file});
      else if(!container&&member.kind!=='IncompleteMember')this.topLevel.push({member,scope,file});
    }
  }
  declareType(syntax,scope,namespace,container,file){
    const uri=file.source.uri,name=syntax.identifier.valueText,modifiers=words(syntax.modifiers),arity=syntax.typeParameterList?.parameters.length??0,kind=typeKinds[syntax.kind];
    const declaration={syntax,scope,uri,file},siblings=container?container._nested:namespace.getTypeMembers(),existing=siblings.find(t=>t.name===name&&t.arity===arity&&t.isSource);
    if(existing){
      const partial=modifiers.includes('partial'),allPartial=existing.declarations.every(d=>words(d.syntax.modifiers).includes('partial'));
      if(partial&&allPartial&&existing.typeKind===kind){
        const access=m=>m.filter(w=>['public','internal','private','protected'].includes(w)).sort().join(' ');
        if(access(modifiers)&&existing.declarations.some(d=>access(words(d.syntax.modifiers))&&access(words(d.syntax.modifiers))!==access(modifiers)))this.report(uri,syntax.identifier,'CS0262',[name]);
        existing.declarations.push(declaration);this.declareNested(syntax,existing,declaration,file);return existing;
      }
      if(partial!==allPartial||partial&&existing.typeKind!==kind)this.report(uri,syntax.identifier,existing.typeKind!==kind?'CS0261':'CS0260',[name]);
      else this.report(uri,syntax.identifier,container?'CS0102':'CS0101',container?[container.toDisplayString(),name]:[name,namespace.isGlobalNamespace?'<global namespace>':namespace.toDisplayString()]);
      // The duplicate is still declared (detached) so its members are checked.
    }
    const interfaceMember=container?.typeKind===TypeKind.Interface;
    const type=new SourceTypeSymbol(this,{name,typeKind:kind,containingSymbol:container??namespace,declaredAccessibility:accessibilityFromSyntax(modifiers,container?(interfaceMember?Accessibility.Public:Accessibility.Private):Accessibility.Internal),
      isStatic:modifiers.includes('static'),isAbstract:modifiers.includes('abstract')||kind===TypeKind.Interface,isSealed:modifiers.includes('sealed')||kind===TypeKind.Struct||kind===TypeKind.Enum||kind===TypeKind.Delegate||modifiers.includes('static'),
      isReadOnly:modifiers.includes('readonly'),isRefLikeType:modifiers.includes('ref')&&kind===TypeKind.Struct,isRecord:syntax.kind.startsWith('Record'),typeParameters:[],locations:[{uri,...spanOf(syntax.identifier)}]},declaration);
    type.typeParameters=Object.freeze(declareTypeParameters(syntax.typeParameterList,type,uri,(n,c,a)=>this.report(uri,n,c,a)));type._typeArguments=null;
    type.modifierWords=modifiers;
    if(!existing){if(container)container._nested.push(type);else namespace.addType(type);}else type.isDuplicate=true;
    if(container)type.containingSymbol=container;
    this.types.push(type);this.declareNested(syntax,type,declaration,file);return type;
  }
  declareNested(syntax,type,declaration,file){
    if(syntax.kind==='EnumDeclaration'||syntax.kind==='DelegateDeclaration')return;
    const scope=type.scopeFor(declaration);
    for(const member of syntax.members??[])if(isTypeDeclaration(member))this.declareType(member,scope,null,type,file);
  }
  /** Binds the base list of a type once (see binder/inheritance.js for the rules and diagnostics). */
  resolveBases(type){
    if(type._baseState===2)return;
    if(type._baseState===1){return;}
    type._baseState=1;type.isResolvingBase=true;
    try{const result=this.host.resolveBases(type,this);type._declaredBase=result.baseType;type._declaredInterfaces=result.interfaces;type.enumUnderlyingType=result.enumUnderlyingType??type.enumUnderlyingType;}
    finally{type.isResolvingBase=false;type._baseState=2;}
    this.host.afterBases?.(type,this);
  }
  bindType(syntax,scope,options){return this.host.typeBinder.bindType(syntax,scope,options);}
  /** Builds the member symbols of a type from all of its declarations. */
  buildMembers(type){
    const members=[];type._built=members;
    for(const declaration of type.declarations){
      const syntax=declaration.syntax,scope=type.scopeFor(declaration),uri=declaration.uri;
      if(type.typeKind===TypeKind.Delegate){this.delegateMembers(type,syntax,scope,uri,members);continue;}
      if(type.typeKind===TypeKind.Enum){for(const m of syntax.members){const field=new FieldSymbol({name:m.identifier.valueText,type,containingSymbol:type,declaredAccessibility:Accessibility.Public,modifiers:DeclarationModifiers.Const|DeclarationModifiers.Static,locations:[{uri,...spanOf(m.identifier)}],syntax:m,constantValue:{value:undefined}});field.isEnumMember=true;field.scope=scope;members.push(field);}continue;}
      // Constraint clauses of the type itself (each partial declaration may repeat them).
      if(syntax.constraintClauses?.length)bindConstraintClauses([...type.typeParameters],syntax.constraintClauses,t=>this.bindType(t,scope).type,(n,c,a)=>this.report(uri,n,c,a),{ownerDisplay:type.toDisplayString()});
      if(syntax.parameterList)this.primaryConstructor(type,syntax,scope,uri,members);
      for(const m of syntax.members??[])this.member(type,m,scope,uri,members);
    }
    this.implicitConstructors(type,members);
    this.reportConflicts(type,members);
    return members;
  }
  modifiers(type,syntax,uri){
    const list=words(syntax.modifiers??[]);let flags=modifiersFromSyntax(list);
    const inInterface=type.typeKind===TypeKind.Interface;
    return {list,flags,access:accessibilityFromSyntax(list,inInterface?Accessibility.Public:Accessibility.Private),inInterface};
  }
  parameters(list,scope,uri,owner){
    const seen=new Set();
    return (list?.parameters??[]).map((p,ordinal)=>{
      const mods=words(p.modifiers),name=p.identifier.valueText;
      if(seen.has(name)&&name)this.report(uri,p.identifier,'CS0100',[name]);seen.add(name);
      const refKind=mods.includes('out')?RefKind.Out:mods.includes('ref')?(mods.includes('readonly')?RefKind.RefReadOnlyParameter:RefKind.Ref):mods.includes('in')?RefKind.In:RefKind.None;
      const type=p.type?this.bindType(p.type,scope):twa(this.core.object);
      const parameter=new ParameterSymbol({name,type,ordinal,refKind,isParams:mods.includes('params'),isThis:mods.includes('this'),scoped:mods.includes('scoped')?'scoped':null,...(p.default?{explicitDefaultValue:{value:undefined}}:{}),locations:[{uri,...spanOf(p.identifier)}],syntax:p});
      parameter.defaultSyntax=p.default?.value??null;parameter.scope=scope;return parameter;
    });
  }
  method(type,syntax,scope,uri,{name,kind=MethodKind.Ordinary,returnTypeSyntax=null,extraFlags=0,parameterList=syntax.parameterList,access=null}){
    const m=this.modifiers(type,syntax,uri);let flags=m.flags|extraFlags;
    const hasBody=!!(syntax.body||syntax.expressionBody);
    // Interface members without a body are abstract; with one (C# 8) they are virtual unless sealed, static or private.
    if(m.inInterface&&kind!==MethodKind.Constructor&&kind!==MethodKind.StaticConstructor&&!(flags&DeclarationModifiers.Static)){if(!hasBody&&!(flags&DeclarationModifiers.Extern))flags|=DeclarationModifiers.Abstract;else if(!(flags&DeclarationModifiers.Sealed)&&m.access!==Accessibility.Private)flags|=DeclarationModifiers.Virtual;}
    const method=new MethodSymbol({name,methodKind:kind,containingSymbol:type,declaredAccessibility:access??m.access,modifiers:flags,locations:[{uri,...spanOf(syntax.identifier??syntax.operatorToken??syntax.type??syntax.keyword??syntax)}],syntax,typeParameters:[]});
    const typeParameters=declareTypeParameters(syntax.typeParameterList,method,uri,(n,c,a)=>this.report(uri,n,c,a));method.typeParameters=Object.freeze(typeParameters);
    const mscope=typeParameters.length?scope.child('typeParameters',{parameters:typeParameters}):scope;method.scope=mscope;method.uri=uri;method.hasBody=hasBody;method.modifierWords=m.list;
    let returnSyntax=returnTypeSyntax;if(returnSyntax?.kind==='RefType'){method.refKind=returnSyntax.readOnlyKeyword?RefKind.RefReadOnly:RefKind.Ref;returnSyntax=returnSyntax.type;}
    method.returnTypeWithAnnotations=returnSyntax?this.bindType(returnSyntax,mscope):twa(this.core.void);method.returnTypeSyntax=returnSyntax;
    const parameters=this.parameters(parameterList,mscope,uri,method);method.parameters=Object.freeze(parameters.map((p,i)=>{p.ordinal=i;p.containingSymbol=method;return p;}));
    method.isExtensionMethod=parameters[0]?.isThis===true;
    if(syntax.constraintClauses?.length){
      if(flags&DeclarationModifiers.Override||syntax.explicitInterfaceSpecifier)method.inheritsConstraints=true;
      bindConstraintClauses(typeParameters,syntax.constraintClauses,t=>this.bindType(t,mscope).type,(n,c,a)=>this.report(uri,n,c,a),{ownerDisplay:name});
    }else if(typeParameters.length&&(flags&DeclarationModifiers.Override||syntax.explicitInterfaceSpecifier))method.inheritsConstraints=true;
    if(syntax.explicitInterfaceSpecifier){method.explicitInterfaceSyntax=syntax.explicitInterfaceSpecifier.name;method.simpleName=name;method.name=syntax.explicitInterfaceSpecifier.name.toString().replace(/\s+/g,'')+'.'+name;method.declaredAccessibility=Accessibility.Private;}
    if(hasBody)this.bodies.push(method);
    return method;
  }
  member(type,syntax,scope,uri,members){
    switch(syntax.kind){
      case 'FieldDeclaration':case 'EventFieldDeclaration':{
        const m=this.modifiers(type,syntax,uri),fieldType=this.bindType(syntax.declaration.type,scope);
        for(const v of syntax.declaration.variables){
          const name=v.identifier.valueText,locations=[{uri,...spanOf(v.identifier)}];
          if(syntax.kind==='EventFieldDeclaration'){
            const event=new EventSymbol({name,type:fieldType,containingSymbol:type,declaredAccessibility:m.access,modifiers:m.flags|(m.inInterface&&!(m.flags&DeclarationModifiers.Static)?DeclarationModifiers.Abstract:0),locations,syntax:v,isFieldLike:true});
            event.scope=scope;event.uri=uri;event.initializerSyntax=v.initializer?.value??null;members.push(event);continue;
          }
          const field=new FieldSymbol({name,type:fieldType,containingSymbol:type,declaredAccessibility:m.access,modifiers:m.flags,locations,syntax:v,...(m.flags&DeclarationModifiers.Const?{constantValue:{value:undefined}}:{})});
          field.initializerSyntax=v.initializer?.value??null;field.scope=scope;field.uri=uri;field.declarationSyntax=syntax;field.typeSyntax=syntax.declaration.type;members.push(field);
          if(field.initializerSyntax&&!(m.flags&DeclarationModifiers.Const))this.bodies.push(field);
        }
        return;
      }
      case 'MethodDeclaration':members.push(this.method(type,syntax,scope,uri,{name:syntax.identifier.valueText,returnTypeSyntax:syntax.returnType}));return;
      case 'ConstructorDeclaration':{
        const isStatic=words(syntax.modifiers).includes('static'),ctor=this.method(type,syntax,scope,uri,{name:isStatic?'.cctor':'.ctor',kind:isStatic?MethodKind.StaticConstructor:MethodKind.Constructor});
        if(syntax.identifier.valueText!==type.name)this.report(uri,syntax.identifier,'CS1520');
        ctor.initializerSyntax=syntax.initializer??null;members.push(ctor);return;
      }
      case 'DestructorDeclaration':members.push(this.method(type,syntax,scope,uri,{name:'Finalize',kind:MethodKind.Destructor,access:Accessibility.Protected}));return;
      case 'OperatorDeclaration':{
        const token=syntax.operatorToken.text,unary=syntax.parameterList.parameters.length===1,name=((unary?unaryOperatorNames[token]:null)??binaryOperatorNames[token]??'op_'+token).replace(/^op_/,syntax.checkedKeyword?'op_Checked':'op_');
        const op=this.method(type,syntax,scope,uri,{name,kind:MethodKind.UserDefinedOperator,returnTypeSyntax:syntax.returnType});op.operatorToken=token;members.push(op);return;
      }
      case 'ConversionOperatorDeclaration':{
        const implicit=syntax.implicitOrExplicitKeyword.text==='implicit',op=this.method(type,syntax,scope,uri,{name:implicit?'op_Implicit':'op_Explicit',kind:MethodKind.Conversion,returnTypeSyntax:syntax.type});members.push(op);return;
      }
      case 'PropertyDeclaration':case 'IndexerDeclaration':members.push(...this.property(type,syntax,scope,uri));return;
      case 'EventDeclaration':{
        const m=this.modifiers(type,syntax,uri),event=new EventSymbol({name:syntax.identifier.valueText,type:this.bindType(syntax.type,scope),containingSymbol:type,declaredAccessibility:m.access,modifiers:m.flags,locations:[{uri,...spanOf(syntax.identifier)}],syntax,isFieldLike:false});
        event.scope=scope;event.uri=uri;members.push(event);
        for(const a of syntax.accessorList?.accessors??[]){const accessor=new MethodSymbol({name:a.keyword.text+'_'+event.name,methodKind:a.keyword.text==='add'?MethodKind.EventAdd:MethodKind.EventRemove,returnType:this.core.void,parameters:[new ParameterSymbol({name:'value',type:event.typeWithAnnotations})],containingSymbol:type,declaredAccessibility:m.access,modifiers:m.flags,syntax:a,associatedSymbol:event});accessor.scope=scope;accessor.uri=uri;accessor.hasBody=!!(a.body||a.expressionBody);if(accessor.hasBody)this.bodies.push(accessor);if(a.keyword.text==='add')event.addMethod=accessor;else event.removeMethod=accessor;}
        return;
      }
      case 'IncompleteMember':return;
      default:if(isTypeDeclaration(syntax))return;
    }
  }
  property(type,syntax,scope,uri){
    const m=this.modifiers(type,syntax,uri),indexer=syntax.kind==='IndexerDeclaration',name=indexer?'this[]':syntax.identifier.valueText;let typeSyntax=syntax.type,refKind=RefKind.None;
    if(typeSyntax.kind==='RefType'){refKind=typeSyntax.readOnlyKeyword?RefKind.RefReadOnly:RefKind.Ref;typeSyntax=typeSyntax.type;}
    const propertyType=this.bindType(typeSyntax,scope),parameters=indexer?this.parameters(syntax.parameterList,scope,uri,null):[];
    const accessors=syntax.accessorList?.accessors??[],bodiless=accessors.every(a=>!a.body&&!a.expressionBody)&&!syntax.expressionBody;
    let flags=m.flags;const isAbstractLike=!!(flags&(DeclarationModifiers.Abstract|DeclarationModifiers.Extern));
    if(m.inInterface&&!(flags&DeclarationModifiers.Static)){if(bodiless)flags|=DeclarationModifiers.Abstract;else if(!(flags&DeclarationModifiers.Sealed))flags|=DeclarationModifiers.Virtual;}
    const isAuto=bodiless&&!isAbstractLike&&!(flags&DeclarationModifiers.Abstract)&&!indexer;
    const accessor=(keyword,a)=>{
      const isGet=keyword==='get',own=a?words(a.modifiers):[],access=a&&own.some(w=>['public','private','protected','internal'].includes(w))?accessibilityFromSyntax(own,m.access):m.access;
      const method=new MethodSymbol({name:(isGet?'get_':'set_')+(indexer?'Item':name),methodKind:isGet?MethodKind.PropertyGet:MethodKind.PropertySet,returnType:isGet?propertyType:this.core.void,
        parameters:[...parameters.map(p=>new ParameterSymbol({name:p.name,type:p.typeWithAnnotations,refKind:p.refKind,isParams:p.isParams,syntax:p.syntax})),...(isGet?[]:[new ParameterSymbol({name:'value',type:propertyType})])],
        containingSymbol:type,declaredAccessibility:access,modifiers:flags|(own.includes('readonly')?DeclarationModifiers.ReadOnly:0),syntax:a??syntax,isInitOnly:keyword==='init'});
      method.scope=scope;method.uri=uri;method.hasBody=a?!!(a.body||a.expressionBody):true;method.refKind=isGet?refKind:RefKind.None;method.isAutoAccessor=isAuto;
      if(method.hasBody)this.bodies.push(method);return method;
    };
    let getMethod=null,setMethod=null;
    if(syntax.expressionBody)getMethod=accessor('get',null);
    for(const a of accessors){const k=a.keyword.text;if(k==='get'){if(getMethod)this.report(uri,a.keyword,'CS1007');else getMethod=accessor('get',a);}else if(k==='set'||k==='init'){if(setMethod)this.report(uri,a.keyword,'CS1007');else setMethod=accessor(k,a);}}
    const property=new PropertySymbol({name,type:propertyType,parameters,getMethod,setMethod,refKind,containingSymbol:type,declaredAccessibility:m.access,modifiers:flags,locations:[{uri,...spanOf(indexer?syntax.thisKeyword:syntax.identifier)}],syntax});
    property.scope=scope;property.uri=uri;property.isAutoProperty=isAuto;property.initializerSyntax=syntax.initializer?.value??null;property.isInitOnly=!!setMethod?.isInitOnly;property.typeSyntax=typeSyntax;
    if(syntax.explicitInterfaceSpecifier){property.explicitInterfaceSyntax=syntax.explicitInterfaceSpecifier.name;property.simpleName=name;property.name=syntax.explicitInterfaceSpecifier.name.toString().replace(/\s+/g,'')+'.'+name;property.declaredAccessibility=Accessibility.Private;for(const a of [getMethod,setMethod])if(a){a.declaredAccessibility=Accessibility.Private;a.name=property.name.replace(/[^.]+$/,'')+a.name;}}
    if(isAuto){const backing=new FieldSymbol({name:`<${name}>k__BackingField`,type:propertyType,containingSymbol:type,declaredAccessibility:Accessibility.Private,modifiers:(flags&DeclarationModifiers.Static)|(setMethod&&!setMethod.isInitOnly?0:DeclarationModifiers.ReadOnly),associatedSymbol:property,isImplicitlyDeclared:true});property.backingField=backing;}
    if(property.initializerSyntax)this.bodies.push(property);
    return [property];
  }
  delegateMembers(type,syntax,scope,uri,members){
    if(syntax.constraintClauses?.length)bindConstraintClauses([...type.typeParameters],syntax.constraintClauses,t=>this.bindType(t,scope).type,(n,c,a)=>this.report(uri,n,c,a),{ownerDisplay:type.toDisplayString()});
    let returnSyntax=syntax.returnType,refKind=RefKind.None;if(returnSyntax.kind==='RefType'){refKind=RefKind.Ref;returnSyntax=returnSyntax.type;}
    const invoke=new MethodSymbol({name:'Invoke',methodKind:MethodKind.DelegateInvoke,returnType:this.bindType(returnSyntax,scope),refKind,parameters:this.parameters(syntax.parameterList,scope,uri,null),containingSymbol:type,declaredAccessibility:Accessibility.Public,modifiers:DeclarationModifiers.Virtual,syntax,isImplicitlyDeclared:true});
    members.push(invoke);
  }
  primaryConstructor(type,syntax,scope,uri,members){
    const parameters=this.parameters(syntax.parameterList,scope,uri,null);
    const ctor=new MethodSymbol({name:'.ctor',methodKind:MethodKind.Constructor,returnType:this.core.void,parameters,containingSymbol:type,declaredAccessibility:Accessibility.Public,modifiers:0,locations:[{uri,...spanOf(syntax.identifier)}],syntax:syntax.parameterList});
    ctor.isPrimaryConstructor=true;ctor.scope=scope;ctor.uri=uri;ctor.hasBody=false;type.primaryConstructor=ctor;members.push(ctor);
    const base=syntax.baseList?.types.find(t=>t.kind==='PrimaryConstructorBaseType');if(base){ctor.baseArgumentsSyntax=base.argumentList;this.bodies.push(ctor);}
    // Positional record parameters become public init-only (record class) or settable (record struct) properties.
    if(type.isRecord)for(const p of parameters){
      if((syntax.members??[]).some(x=>(x.kind==='PropertyDeclaration'||x.kind==='FieldDeclaration')&&(x.identifier?.valueText===p.name||x.declaration?.variables.some(v=>v.identifier.valueText===p.name))))continue;
      const mk=(get)=>{const a=new MethodSymbol({name:(get?'get_':'set_')+p.name,methodKind:get?MethodKind.PropertyGet:MethodKind.PropertySet,returnType:get?p.typeWithAnnotations:this.core.void,parameters:get?[]:[new ParameterSymbol({name:'value',type:p.typeWithAnnotations})],containingSymbol:type,declaredAccessibility:Accessibility.Public,modifiers:0,isInitOnly:!get&&type.typeKind===TypeKind.Class,isImplicitlyDeclared:true});a.isAutoAccessor=true;return a;};
      const property=new PropertySymbol({name:p.name,type:p.typeWithAnnotations,getMethod:mk(true),setMethod:mk(false),containingSymbol:type,declaredAccessibility:Accessibility.Public,modifiers:0,locations:p.locations,syntax:p.syntax,isImplicitlyDeclared:true});
      property.isAutoProperty=true;property.isInitOnly=type.typeKind===TypeKind.Class;property.isPositional=true;members.push(property);
    }
  }
  implicitConstructors(type,members){
    if(type.typeKind===TypeKind.Interface||type.typeKind===TypeKind.Enum||type.typeKind===TypeKind.Delegate||type.isStatic)return;
    const declared=members.filter(m=>m.kind===SymbolKind.Method&&m.methodKind===MethodKind.Constructor);
    const needed=type.typeKind===TypeKind.Struct?!declared.some(c=>c.parameters.length===0):declared.length===0;
    if(needed){const ctor=new MethodSymbol({name:'.ctor',methodKind:MethodKind.Constructor,returnType:this.core.void,parameters:[],containingSymbol:type,declaredAccessibility:type.isAbstract&&type.typeKind===TypeKind.Class?Accessibility.Protected:Accessibility.Public,modifiers:0,isImplicitlyDeclared:true,locations:type.locations});ctor.isImplicitConstructor=true;members.push(ctor);}
    // Records get a copy constructor so `with` and derived records can clone.
    if(type.isRecord&&type.typeKind===TypeKind.Class&&!declared.some(c=>c.parameters.length===1&&c.parameters[0].type===type)){const copy=new MethodSymbol({name:'.ctor',methodKind:MethodKind.Constructor,returnType:this.core.void,parameters:[new ParameterSymbol({name:'original',type})],containingSymbol:type,declaredAccessibility:Accessibility.Protected,modifiers:0,isImplicitlyDeclared:true});copy.isCopyConstructor=true;members.push(copy);}
  }
  reportConflicts(type,members){
    const names=new Map(),signatures=new Map();
    for(const m of members){
      if(m.isImplicitlyDeclared&&!m.isPositional)continue;const uri=m.uri??m.locations[0]?.uri,at=m.locations[0];if(!at)continue;
      if(m.name===type.name&&m.kind!==SymbolKind.Method||m.kind===SymbolKind.Method&&m.methodKind===MethodKind.Ordinary&&m.name===type.name)this.report(uri,at,'CS0542',[m.name]);
      if(m.kind===SymbolKind.Method){
        if(m.methodKind!==MethodKind.Ordinary&&!m.isConstructor&&m.methodKind!==MethodKind.UserDefinedOperator&&m.methodKind!==MethodKind.Conversion)continue;
        const key=m.signatureKey+(m.methodKind===MethodKind.Conversion?'->'+m.returnTypeWithAnnotations.toDisplayString():'');
        if(signatures.has(key)){if(!(m.modifiers&DeclarationModifiers.Partial&&signatures.get(key).modifiers&DeclarationModifiers.Partial))this.report(uri,at,'CS0111',[m.isConstructor?type.name:m.name,type.toDisplayString()]);}else signatures.set(key,m);
        if(names.has(m.name)&&names.get(m.name).kind!==SymbolKind.Method)this.report(uri,at,'CS0102',[type.toDisplayString(),m.name]);
        if(!names.has(m.name))names.set(m.name,m);continue;
      }
      if(m.kind===SymbolKind.Property&&m.isIndexer)continue;
      if(names.has(m.name))this.report(uri,at,'CS0102',[type.toDisplayString(),m.name]);else names.set(m.name,m);
    }
    for(const nested of type._nested){if(names.has(nested.name)&&!nested.isDuplicate)this.report(nested.locations[0].uri,nested.locations[0],'CS0102',[type.toDisplayString(),nested.name]);}
  }
}
function nameParts(name){return name.kind==='QualifiedName'?[...nameParts(name.left),...nameParts(name.right)]:[name.identifier.valueText];}
export {inheritConstraints};
