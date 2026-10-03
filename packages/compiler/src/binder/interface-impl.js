/**
 * Interface implementation (SF-A02-T03.3, C# spec 18.6): which member of a class or struct implements each member of
 * each interface it lists or inherits - removing the old "IDisposable only" restriction.
 *
 * For an interface member, in order: an explicit implementation in the type (`void I.M()`), a public instance member
 * of the type with the same signature, then the same search in each base class (an inherited member implements the
 * interface too), and finally a default implementation in the interface itself (C# 8). A type that re-lists an
 * interface re-implements it: the search starts at that type again.
 *   CS0535 not implemented            CS0738 a candidate has the wrong return type
 *   CS0736 the candidate is static    CS0737 the candidate is not public
 *   CS0539 explicit member not found in the interface      CS0540 the type does not implement that interface
 * The resulting map (`type.interfaceImplementations`) is what a back end emits as MethodImpl rows / interface vtables.
 */
import {TypeKind,SymbolKind,Accessibility} from '../symbols/types.js';
import {MethodKind} from '../symbols/members.js';
import {baseTypeChain,allInterfacesOf} from '../symbols/substitution.js';

const sameType=(a,b,ma,mb)=>{if(!a||!b)return a===b;if(a.equals(b))return true;const ia=(ma.typeParameters??[]).indexOf(a),ib=(mb.typeParameters??[]).indexOf(b);if(ia>=0&&ia===ib)return true;return mapMethodTypeParameters(a,ma)===mapMethodTypeParameters(b,mb);};
const mapMethodTypeParameters=(t,m)=>{let text=t.toDisplayString();(m.typeParameters??[]).forEach((p,i)=>{text=text.replace(new RegExp('\\b'+p.name+'\\b','g'),'!!'+i);});return text;};
const parametersMatch=(a,b)=>a.parameters.length===b.parameters.length&&(a.arity??0)===(b.arity??0)&&a.parameters.every((p,i)=>p.refKind===b.parameters[i].refKind&&sameType(p.type,b.parameters[i].type,a,b));
const typeOfMember=m=>m.kind===SymbolKind.Method?m.returnType:m.type;
const simpleName=m=>m.simpleName??m.name;
/** Members of an interface that need (or can take) an implementation: instance methods, properties, indexers and events. */
export function implementableMembers(iface){return iface.getMembers().filter(m=>!m.isStatic&&(m.kind===SymbolKind.Method&&m.methodKind===MethodKind.Ordinary||m.kind===SymbolKind.Property||m.kind===SymbolKind.Event)&&m.declaredAccessibility!==Accessibility.Private);}
function matches(candidate,member){
  if(candidate.kind!==member.kind)return false;
  if(member.kind===SymbolKind.Method)return parametersMatch(candidate,member);
  if(member.kind===SymbolKind.Property)return candidate.isIndexer===member.isIndexer&&(!member.isIndexer||parametersMatch(candidate,member));
  return true;
}
/**
 * Finds the implementation of one interface member for a type.
 * @returns {{member}|{error:{code,args},close?:object}|{defaultImplementation:member}}
 */
export function findImplementation(type,iface,member,core){
  const chain=type.typeKind===TypeKind.Struct?[type]:baseTypeChain(type,core);let close=null;
  for(const t of chain){
    // Explicit implementations are named `Namespace.IFace.Member`.
    const explicit=t.getMembers().find(m=>m.explicitInterfaceType&&m.explicitInterfaceType.equals(iface)&&simpleName(m)===member.name&&matches(m,member));
    if(explicit)return {member:explicit,isExplicit:true};
    for(const c of t.getMembers(member.name)){
      if(c.explicitInterfaceSyntax||!matches(c,member))continue;
      const sameReturn=sameType(typeOfMember(c),typeOfMember(member),c,member);
      if(c.isStatic){close??={code:'CS0736',candidate:c};continue;}
      if(c.declaredAccessibility!==Accessibility.Public){close??={code:'CS0737',candidate:c};continue;}
      if(!sameReturn){close??={code:'CS0738',candidate:c};continue;}
      if(member.kind===SymbolKind.Property&&(member.getMethod&&!c.getMethod||member.setMethod&&!c.setMethod)){close??={code:'CS0535',candidate:c,accessor:member.getMethod&&!c.getMethod?'get':'set'};continue;}
      return {member:c,isExplicit:false,declaredIn:t};
    }
    // A base class that lists the interface already implements it (possibly through its own bases).
    if(t!==type&&t.interfaces?.some(i=>i.equals(iface))&&!close)break;
  }
  if(!member.isAbstract)return {defaultImplementation:member};
  const typeName=type.toDisplayString(),memberName=member.toDisplayString();
  if(close?.code==='CS0738')return {error:{code:'CS0738',args:[typeName,memberName,close.candidate.toDisplayString(),typeOfMember(member).toDisplayString()]}};
  if(close?.code==='CS0736'||close?.code==='CS0737')return {error:{code:close.code,args:[typeName,memberName,close.candidate.toDisplayString()]}};
  if(close?.accessor)return {error:{code:'CS0535',args:[typeName,memberName+'.'+close.accessor]}};
  if(member.kind===SymbolKind.Property&&!member.isIndexer){const parts=[member.getMethod&&'get',member.setMethod&&(member.setMethod.isInitOnly?'init':'set')].filter(Boolean);return {errors:parts.map(p=>({code:'CS0535',args:[typeName,memberName+'.'+p]}))};}
  return {error:{code:'CS0535',args:[typeName,memberName]}};
}
/**
 * Maps every interface member to its implementation for a class or struct.
 * @param {(member)=>void} bindExplicit resolves `member.explicitInterfaceType` for explicit implementations (done by the caller's type binder)
 * @returns {{map:Map<object,object>,diagnostics:{code,args,interface?:object,member?:object}[]}}
 */
export function bindInterfaceImplementations(type,core){
  const diagnostics=[],map=new Map();
  if(type.typeKind!==TypeKind.Class&&type.typeKind!==TypeKind.Struct)return {map,diagnostics};
  const all=allInterfacesOf(type,core);
  // Explicit implementations must name an interface of the type and one of its members.
  for(const m of type.getMembers()){
    const iface=m.explicitInterfaceType;if(!iface||iface.isErrorType?.())continue;if(m.kind===SymbolKind.Method&&m.isAccessor)continue;
    if(iface.typeKind!==TypeKind.Interface){diagnostics.push({code:'CS0538',args:[iface.toDisplayString()],member:m,onInterfaceName:true});continue;}
    if(!all.some(i=>i.equals(iface))){diagnostics.push({code:'CS0540',args:[m.toDisplayString(),iface.toDisplayString()],member:m,onInterfaceName:true});continue;}
    if(!implementableMembers(iface).some(im=>im.name===simpleName(m)&&matches(m,im)))diagnostics.push({code:'CS0539',args:[m.toDisplayString()],member:m});
  }
  // Only interfaces this type lists itself (or gains through them) are checked here; base classes were checked on their own.
  const inheritedFromBase=type.typeKind===TypeKind.Class&&type.baseType?allInterfacesOf(type.baseType,core):[];
  const listed=type.interfaces;
  for(const iface of all){
    const relisted=listed.some(i=>i.equals(iface)||allInterfacesOf(i,core).some(x=>x.equals(iface)));
    if(!relisted&&inheritedFromBase.some(i=>i.equals(iface)))continue;
    for(const member of implementableMembers(iface)){
      const found=findImplementation(type,iface,member,core);
      if(found.member){map.set(member,found.member);if(found.member.kind===SymbolKind.Property){if(member.getMethod&&found.member.getMethod)map.set(member.getMethod,found.member.getMethod);if(member.setMethod&&found.member.setMethod)map.set(member.setMethod,found.member.setMethod);}}
      else if(found.defaultImplementation)map.set(member,member);
      else for(const error of found.errors??[found.error])diagnostics.push({...error,interface:iface,member});
    }
  }
  return {map,diagnostics};
}
/** The MethodImpl rows a type needs: explicit implementations, and implicit ones whose name or declaring type differs from the interface method. */
export function methodImplRows(type,map){
  const rows=[];for(const [declaration,body] of map){if(declaration.kind!==SymbolKind.Method||body===declaration)continue;if(body.explicitInterfaceType||body.name!==declaration.name||body.containingType!==type&&body.containingType?.originalDefinition!==type.originalDefinition)rows.push({class:type,body,declaration});}
  return rows;
}
