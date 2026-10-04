import {DiagnosticId} from '../../diagnostics/codes.js';
import {NamedTypeSymbol,TypeParameterSymbol,ArrayTypeSymbol,ErrorTypeSymbol,TypeKind,SymbolKind,Accessibility,RefKind,Variance,SymbolDisplayFormat} from '../types.js';
import {NamespaceSymbol,NamespaceExtent} from '../namespaces.js';
import {MethodSymbol,FieldSymbol,PropertySymbol,ParameterSymbol,MethodKind,DeclarationModifiers,modifiersFromSyntax,accessibilityFromSyntax,isAccessibilityKeyword} from '../members.js';
/**
 * The declaration table: source namespace, type and member symbols built from parsed files.
 *
 * Construction is cheap and eager only for what name lookup needs: the namespace tree and one `SourceNamedTypeSymbol`
 * per type (partial declarations of the same name and arity in the same container merge into one symbol with several
 * declaration nodes and locations). Member symbols are created lazily on the first `getMembers` of a type, which is
 * also when member type texts are resolved and member duplicates (CS0102, CS0111) are reported.
 *
 * Type-level diagnostics follow Roslyn: CS0101 (CS0102 for nested types) at every non-partial redeclaration, which then
 * gets its own unmerged symbol outside name lookup (`table.duplicateTypes`); CS0260 at every non-partial declaration of
 * a type that also has partial declarations; CS0262 once, at the first declaration, when partial declarations state
 * different accessibilities.
 *
 * The table never writes message text and never binds bodies. Type texts ('int', 'A.B.Foo', 'List<int>', 'T[]') go
 * through the caller's `resolveType(typeText,context)`; array suffixes and in-scope type parameters are handled here,
 * and anything the callback does not resolve becomes an `ErrorTypeSymbol`.
 */
const typeKinds=Object.freeze({Class:TypeKind.Class,Struct:TypeKind.Struct,Interface:TypeKind.Interface,Enum:TypeKind.Enum,Delegate:TypeKind.Delegate,Record:TypeKind.Class,RecordStruct:TypeKind.Struct});
/** The TypeKind a syntax node declares, or null when the node is not a type declaration. */
export function declarationKind(node){
  switch(node?.kind){
    case 'Class':case 'Struct':case 'Interface':case 'Enum':case 'Delegate':case 'Record':case 'RecordStruct':return typeKinds[node.kind];
    default:return null;
  }
}
const locationOf=node=>{const span=node.nameSpan??node;return {uri:node.uri,start:span.start,end:span.end};};
const typeParameterNames=node=>(node.typeParameters??[]).map(p=>typeof p==='string'?{name:p}:p);
const makeTypeParameters=node=>typeParameterNames(node).map((p,ordinal)=>new TypeParameterSymbol({name:p.name,ordinal,variance:p.variance==='in'?Variance.In:p.variance==='out'?Variance.Out:Variance.None,locations:p.uri?[locationOf(p)]:[]}));
const explicitAccess=modifiers=>(modifiers??[]).filter(isAccessibilityKeyword).sort().join(' ');
const refKindOf=node=>{const m=node.refKind??(node.modifiers??[]).find(k=>k==='ref'||k==='out'||k==='in');return m==='ref'?RefKind.Ref:m==='out'?RefKind.Out:m==='in'?RefKind.In:RefKind.None;};
/**
 * Splits a type text into its parts: `{name, typeArguments:[text], rankSpecifiers:[rank]}`.
 * 'System.Collections.Generic.Dictionary<string, int[]>[][,]' gives the dotted name, two argument texts and ranks [1,2].
 */
export function splitTypeText(text){
  let rest=String(text??'').trim();const rankSpecifiers=[];
  for(let m;(m=/\[(,*)\]$/.exec(rest));rest=rest.slice(0,m.index).trimEnd())rankSpecifiers.unshift(m[1].length+1);
  const open=rest.indexOf('<');if(open<0||!rest.endsWith('>'))return {name:rest,typeArguments:[],rankSpecifiers};
  const typeArguments=[];let depth=0,start=open+1;
  for(let i=open+1;i<rest.length-1;i++){const c=rest[i];if(c==='<'||c==='['||c==='(')depth++;else if(c==='>'||c===']'||c===')')depth--;else if(c===','&&depth===0){typeArguments.push(rest.slice(start,i).trim());start=i+1;}}
  typeArguments.push(rest.slice(start,-1).trim());return {name:rest.slice(0,open).trim(),typeArguments,rankSpecifiers};
}
/** A class, struct, interface, enum or delegate declared in source; one symbol for all its partial declarations. */
export class SourceNamedTypeSymbol extends NamedTypeSymbol {
  constructor(table,declarations,container,isDuplicate=false){
    const first=declarations[0],nested=container.kind===SymbolKind.NamedType,written=declarations.find(d=>explicitAccess(d.modifiers));
    const fallback=!nested?Accessibility.Internal:container.typeKind===TypeKind.Interface?Accessibility.Public:Accessibility.Private,modifiers=declarations.reduce((flags,d)=>flags|modifiersFromSyntax(d.modifiers),0);
    super({name:first.name,typeKind:declarationKind(first),typeParameters:makeTypeParameters(first),containingSymbol:container,declaredAccessibility:accessibilityFromSyntax(written?.modifiers??[],fallback),
      isStatic:!!(modifiers&DeclarationModifiers.Static),isAbstract:!!(modifiers&DeclarationModifiers.Abstract),isSealed:!!(modifiers&DeclarationModifiers.Sealed),isReadOnly:!!(modifiers&DeclarationModifiers.ReadOnly),isRecord:first.kind==='Record'||first.kind==='RecordStruct'||!!first.isRecord,
      locations:declarations.map(locationOf),baseType:()=>table._baseType(this),interfaces:()=>table._interfaces(this)});
    this.table=table;this.declarations=declarations;this.syntax=first;this.modifiers=modifiers;this.isPartial=!!(modifiers&DeclarationModifiers.Partial);this.isDuplicateDeclaration=isDuplicate;this._nestedTypes=[];this._memberState=0;this._members=[];
  }
  /** Source types are always part of the compilation being built. */
  get isSourceSymbol(){return true;}
  /** Members in declaration order (all partial declarations, in file order); built on first use. */
  getMembers(name){
    if(this._memberState===0){this._memberState=1;try{this.table._buildMembers(this,this._members);}finally{this._memberState=2;}}
    // While members are being built (a type resolver looking at this very type) nested types are already visible.
    const all=this._memberState===1?[...new Set([...this._members,...this._nestedTypes])]:this._members;return name===undefined?all:all.filter(m=>m.name===name);
  }
  /** Nested types are known without building the other members. */
  getTypeMembers(name,arity){return this._nestedTypes.filter(t=>(name===undefined||t.name===name)&&(arity===undefined||t.arity===arity));}
  addMember(member){this.getMembers();return super.addMember(member);}
}
export class DeclarationTable {
  /**
   * @param {Array<{root:object,source?:object}>} files parsed files (`parse(new SourceText(text,uri))` results).
   * @param {object} options
   *   resolveType(typeText,context) -> TypeSymbol|TypeWithAnnotations|null; context is
   *     {node,containingType,containingNamespace,typeParameters:Map<name,TypeParameterSymbol>,table}.
   *   report(node,code,args) receives every declaration diagnostic.
   *   module: identity stored on the source namespaces (`NamespaceSymbol.module`), used by accessibility checks.
   */
  constructor(files=[],options={}){
    this.files=files;this.resolveType=options.resolveType??(()=>null);this.report=options.report??(()=>{});this.module=options.module??null;
    this.globalNamespace=new NamespaceSymbol('',null,NamespaceExtent.Source,this.module);
    /** Every source type that takes part in name lookup, outer types before their nested types. */
    this.types=[];
    /** Unmerged symbols of redeclarations that reported CS0101/CS0102; they are not reachable by name. */
    this.duplicateTypes=[];
    /** `{file,statements}` for each file with top-level statements, in file order. */
    this.topLevelStatements=[];
    this._typeByNode=new Map();this._symbolByNode=new Map();this._ownerByNode=new Map();this._topLevelNodes=[];this._topLevelMethods=null;
    const byNamespace=new Map();
    for(const file of files){
      const root=file.root??file;
      for(const node of root.members??[]){
        if(declarationKind(node)){const ns=this.globalNamespace.ensureNamespace(node.namespace??'');if(!byNamespace.has(ns))byNamespace.set(ns,[]);byNamespace.get(ns).push(node);}
        else if(node.kind==='Method'){this._topLevelNodes.push(node);this._own(node,null);}
      }
      if(root.statements?.length)this.topLevelStatements.push({file,statements:root.statements});
    }
    for(const [ns,nodes] of byNamespace)this._declareTypes(nodes,ns);
  }
  /** Top-level methods (CompilationUnit members of kind Method) as MethodSymbols with the modifiers as written; their container is the global namespace. */
  get topLevelMethods(){
    if(!this._topLevelMethods){this._topLevelMethods=[];for(const node of this._topLevelNodes)this._topLevelMethods.push(this._method(node,null,this._context(node,null,this.globalNamespace.lookupNamespace(node.namespace??'')??this.globalNamespace,new Map())));}
    return this._topLevelMethods;
  }
  /** The symbol of a type declaration node (any of the partial declarations), or null. */
  typeFor(node){return this._typeByNode.get(node)??null;}
  /** The symbol declared by a syntax node: type, field, property, accessor, method, constructor or parameter. Builds the owner's members if needed. */
  memberFor(node){
    if(this._typeByNode.has(node))return this._typeByNode.get(node);
    if(!this._symbolByNode.has(node)&&this._ownerByNode.has(node)){const owner=this._ownerByNode.get(node);if(owner)owner.getMembers();else this.topLevelMethods;}
    return this._symbolByNode.get(node)??null;
  }
  /** The declaration nodes of a source type (several for a partial type); empty for other symbols. */
  declarationsOf(type){return type?.originalDefinition?.declarations??[];}
  /** Builds the members of every type (and so reports every member diagnostic). Returns the table. */
  complete(){for(const type of [...this.types,...this.duplicateTypes])type.getMembers();this.topLevelMethods;return this;}
  _own(node,owner){this._ownerByNode.set(node,owner);for(const child of [...(node.parameters??[]),...(node.accessors??[])])this._ownerByNode.set(child,owner);}
  /** Groups type declarations of one container by name and arity, merges partial ones and creates the symbols. */
  _declareTypes(nodes,container){
    const nested=container.kind===SymbolKind.NamedType,groups=new Map();
    for(const node of nodes){const key=node.name+'`'+(node.typeParameters?.length??0);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(node);}
    const duplicate=node=>{this.report(node,nested?DiagnosticId.CS0102:DiagnosticId.CS0101,nested?[container.toDisplayString(SymbolDisplayFormat.MinimallyQualified),node.name]:[node.name,container.toDisplayString()]);this._createType([node],container,true);};
    for(const group of groups.values()){
      // Declarations of another kind than the first (class vs struct) never merge.
      const kind=group[0].kind,same=group.filter(n=>n.kind===kind),isPartial=n=>(n.modifiers??[]).includes('partial'),anyPartial=same.some(isPartial);
      let merged=same;
      if(same.length>1&&!anyPartial)merged=[same[0]];
      else if(same.length>1)for(const node of same)if(!isPartial(node))this.report(node,DiagnosticId.CS0260,[node.name]);
      const symbol=this._createType(merged,container,false);
      if(merged.length>1&&new Set(merged.map(d=>explicitAccess(d.modifiers)).filter(Boolean)).size>1)this.report(merged[0],DiagnosticId.CS0262,[symbol.toDisplayString(SymbolDisplayFormat.MinimallyQualified)]);
      for(const node of group)if(!merged.includes(node))duplicate(node);
    }
  }
  _createType(declarations,container,isDuplicate){
    const symbol=new SourceNamedTypeSymbol(this,declarations,container,isDuplicate);
    for(const node of declarations)this._typeByNode.set(node,symbol);
    if(isDuplicate)this.duplicateTypes.push(symbol);else{this.types.push(symbol);if(container.kind===SymbolKind.NamedType)container._nestedTypes.push(symbol);else container.addType(symbol);}
    const nestedNodes=[];
    for(const declaration of declarations)for(const member of declaration.members??[]){if(declarationKind(member))nestedNodes.push(member);else this._own(member,symbol);}
    if(nestedNodes.length)this._declareTypes(nestedNodes,symbol);
    return symbol;
  }
  _context(node,containingType,containingNamespace,typeParameters){return {node,containingType,containingNamespace,typeParameters,table:this};}
  /** Type parameters in scope inside a type: its own and those of its enclosing types (inner names win). */
  _typeParameterScope(type){const chain=[];for(let t=type;t;t=t.containingType)chain.unshift(t);const scope=new Map();for(const t of chain)for(const p of t.typeParameters)scope.set(p.name,p);return scope;}
  /** Resolves a type text: arrays and in-scope type parameters here, everything else through the callback, else an error type. */
  _type(text,context){
    if(text==null||text==='')return ErrorTypeSymbol.unknown;
    const parts=splitTypeText(text);
    if(parts.rankSpecifiers.length){
      const elementText=parts.name+(parts.typeArguments.length?'<'+parts.typeArguments.join(', ')+'>':'');let type=this._type(elementText,context);
      for(const rank of [...parts.rankSpecifiers].reverse())type=new ArrayTypeSymbol(type,rank);return type;
    }
    const parameter=context.typeParameters.get(parts.name);if(parameter&&!parts.typeArguments.length)return parameter;
    return this.resolveType(String(text).trim(),context)??new ErrorTypeSymbol(parts.name,parts.typeArguments.length,parts.typeArguments.length?{typeArguments:parts.typeArguments.map(a=>this._type(a,context))}:{});
  }
  _typeContext(type){return this._context(type.syntax,type,type.containingNamespace,this._typeParameterScope(type));}
  _baseType(type){
    if(type.typeKind===TypeKind.Interface)return null;if(type.typeKind!==TypeKind.Class)return this.resolveType(type.typeKind===TypeKind.Struct?'System.ValueType':type.typeKind===TypeKind.Enum?'System.Enum':'System.MulticastDelegate',this._typeContext(type))??null;
    const written=type.declarations.map(d=>d.baseType).find(Boolean),context=this._typeContext(type);
    if(written){const base=this._type(written,context);return base.type??base;}
    const object=this.resolveType('object',context);return object?object.type??object:null;
  }
  _interfaces(type){const context=this._typeContext(type),result=[];for(const text of new Set(type.declarations.flatMap(d=>d.interfaces??[]))){const t=this._type(text,context);result.push(t.type??t);}return result;}
  _parameter(node,context){
    const modifiers=node.modifiers??[],symbol=new ParameterSymbol({name:node.name,type:this._type(node.type,{...context,node}),refKind:refKindOf(node),isParams:modifiers.includes('params')||!!node.isParams,isThis:modifiers.includes('this'),isOptional:!!(node.default??node.defaultValue??node.initializer),locations:[locationOf(node)],syntax:node});
    this._symbolByNode.set(node,symbol);return symbol;
  }
  _method(node,type,context){
    const modifiers=node.modifiers??[],flags=modifiersFromSyntax(modifiers),isStatic=!!(flags&DeclarationModifiers.Static),isConstructor=node.name==='.ctor',typeParameters=isConstructor?[]:makeTypeParameters(node);
    let scope=context.typeParameters;if(typeParameters.length){scope=new Map(scope);for(const p of typeParameters)scope.set(p.name,p);}
    const inner={...context,node,typeParameters:scope},parameters=(node.parameters??[]).map(p=>this._parameter(p,inner)),fallback=type?.typeKind===TypeKind.Interface?Accessibility.Public:Accessibility.Private;
    const symbol=new MethodSymbol({name:isConstructor?(isStatic?'.cctor':'.ctor'):node.name,methodKind:isConstructor?(isStatic?MethodKind.StaticConstructor:MethodKind.Constructor):MethodKind.Ordinary,returnType:this._type(node.returnType??'void',inner),refKind:refKindOf({refKind:node.returnRefKind}),parameters,typeParameters,
      containingSymbol:type??this.globalNamespace,declaredAccessibility:isConstructor&&isStatic?Accessibility.Private:accessibilityFromSyntax(modifiers,fallback),modifiers:flags,isExtensionMethod:!!parameters[0]?.isThis,locations:[locationOf(node)],syntax:node});
    this._symbolByNode.set(node,symbol);return symbol;
  }
  _field(node,type,context){
    const symbol=new FieldSymbol({name:node.name,type:this._type(node.type,{...context,node}),containingSymbol:type,declaredAccessibility:accessibilityFromSyntax(node.modifiers,Accessibility.Private),modifiers:modifiersFromSyntax(node.modifiers),locations:[locationOf(node)],syntax:node});
    this._symbolByNode.set(node,symbol);return symbol;
  }
  /** A property with its accessor methods and, for an auto-property, the backing field. Returns the symbols to add as members. */
  _property(node,type,context){
    const inner={...context,node},propertyType=this._type(node.type,inner),flags=modifiersFromSyntax(node.modifiers),fallback=type.typeKind===TypeKind.Interface?Accessibility.Public:Accessibility.Private,access=accessibilityFromSyntax(node.modifiers,fallback),location=locationOf(node);
    const parameters=()=>(node.parameters??[]).map(p=>new ParameterSymbol({name:p.name,type:this._type(p.type,inner),refKind:refKindOf(p),locations:[locationOf(p)],syntax:p}));
    const accessor=name=>{
      const syntax=(node.accessors??[]).find(a=>name==='get'?a.name==='get':a.name==='set'||a.name==='init');if(!syntax)return null;
      const isGet=name==='get',symbol=new MethodSymbol({name:(isGet?'get_':'set_')+node.name,methodKind:isGet?MethodKind.PropertyGet:MethodKind.PropertySet,returnType:isGet?propertyType:this._type('void',inner),parameters:[...parameters(),...(isGet?[]:[new ParameterSymbol({name:'value',type:propertyType})])],
        containingSymbol:type,declaredAccessibility:explicitAccess(syntax.modifiers)?accessibilityFromSyntax(syntax.modifiers,access):access,modifiers:flags|modifiersFromSyntax(syntax.modifiers),isInitOnly:syntax.name==='init',locations:[{uri:syntax.uri,start:syntax.start,end:syntax.end}],syntax});
      this._symbolByNode.set(syntax,symbol);return symbol;
    };
    const getMethod=accessor('get'),setMethod=accessor('set');
    const isAuto=(node.accessors??[]).length>0&&node.accessors.every(a=>!a.body)&&!(flags&(DeclarationModifiers.Abstract|DeclarationModifiers.Extern))&&type.typeKind!==TypeKind.Interface&&!(node.parameters??[]).length;
    const backingField=isAuto?new FieldSymbol({name:'<'+node.name+'>k__BackingField',type:propertyType,containingSymbol:type,declaredAccessibility:Accessibility.Private,modifiers:(flags&DeclarationModifiers.Static)|(setMethod&&!setMethod.isInitOnly?0:DeclarationModifiers.ReadOnly),locations:[location],syntax:node,isImplicitlyDeclared:true}):null;
    const property=new PropertySymbol({name:node.name,type:propertyType,parameters:parameters(),getMethod,setMethod,backingField,containingSymbol:type,declaredAccessibility:access,modifiers:flags,locations:[location],syntax:node});
    if(backingField)backingField.associatedSymbol=property;
    this._symbolByNode.set(node,property);return [property,getMethod,setMethod,backingField].filter(Boolean);
  }
  /** Creates the member symbols of a type into `members`, then the implicit constructor, then reports duplicates. */
  _buildMembers(type,members){
    const context=this._typeContext(type),placed=new Set();
    for(const declaration of type.declarations)for(const node of declaration.members??[]){
      if(declarationKind(node)){const nested=this._typeByNode.get(node);if(nested&&!nested.isDuplicateDeclaration&&!placed.has(nested)){placed.add(nested);members.push(nested);}continue;}
      switch(node.kind){
        case 'Field':members.push(this._field(node,type,context));break;
        case 'Property':members.push(...this._property(node,type,context));break;
        case 'Method':members.push(this._method(node,type,context));break;
        default:break; // events, operators and other member kinds slot in here once the syntax tree carries them
      }
    }
    const implicit=type.typeKind===TypeKind.Struct||type.typeKind===TypeKind.Class&&!type.isStatic;
    if(implicit&&!members.some(m=>m.kind===SymbolKind.Method&&m.methodKind===MethodKind.Constructor&&(type.typeKind!==TypeKind.Struct||!m.parameters.length)))
      members.push(new MethodSymbol({name:'.ctor',methodKind:MethodKind.Constructor,returnType:this._type('void',context),parameters:[],containingSymbol:type,declaredAccessibility:type.isAbstract?Accessibility.Protected:Accessibility.Public,locations:type.locations.slice(0,1),syntax:null,isImplicitlyDeclared:true}));
    this._reportMemberConflicts(type,members);
  }
  /** Roslyn's member name conflict rules: CS0102 for a name reused by a non-method, CS0111 for an equal method signature (CS0663 when only ref/out/in differ). */
  _reportMemberConflicts(type,members){
    const typeNames=new Set(type._nestedTypes.map(t=>t.name)),last=new Map(),signatures=new Map(),display=type.toDisplayString(SymbolDisplayFormat.MinimallyQualified),refKinds=m=>m.parameters.map(p=>p.refKind);
    for(const member of members){
      if(member.kind===SymbolKind.NamedType||member.isImplicitlyDeclared||member.kind===SymbolKind.Method&&member.isAccessor)continue;
      const isMethod=member.kind===SymbolKind.Method,isIndexer=member.kind===SymbolKind.Property&&member.isIndexer;
      if(isIndexer){const key='this['+member.parameters.map(p=>(p.refKind===RefKind.None?'':'ref ')+p.typeWithAnnotations.toDisplayString(SymbolDisplayFormat.Test)).join(',')+']';if(signatures.has(key))this.report(member.syntax,DiagnosticId.CS0111,['this',display]);else signatures.set(key,member);continue;}
      const previous=last.get(member.name);
      if(typeNames.has(member.name)||previous&&!(isMethod&&previous.kind===SymbolKind.Method))this.report(member.syntax,DiagnosticId.CS0102,[display,member.name]);
      if(isMethod){
        // signatureKey folds ref, out and in together: an exact repeat is CS0111, a difference only in those modifiers CS0663.
        const key=member.signatureKey,earlier=signatures.get(key)??[],kinds=refKinds(member),same=earlier.find(m=>refKinds(m).every((k,i)=>k===kinds[i]));
        if(same)this.report(member.syntax,DiagnosticId.CS0111,[member.isConstructor?type.name:member.name,display]);
        else if(earlier.length){const other=refKinds(earlier[0]),at=kinds.findIndex((k,i)=>k!==other[i]);this.report(member.syntax,DiagnosticId.CS0663,[display,member.isConstructor?'constructor':'method',kinds[at],other[at]]);}
        signatures.set(key,[...earlier,member]);
      }
      last.set(member.name,member);
    }
  }
}
/** Builds the declaration table for parsed files; see `DeclarationTable` for the options. */
export function buildDeclarationTable(files,options){return new DeclarationTable(files,options);}
