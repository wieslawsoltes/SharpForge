import {fixedCallSignature} from './varargs-profile.js';
import {CilError} from './binary.js';
import {decodeCoded} from './metadata.js';
import {genericTypeParts} from './field-profile.js';
import {frameworkType} from '@sharpforge/framework';

const aliases=new Map(Object.entries({'System.Void':'void','System.Boolean':'bool','System.Char':'char','System.SByte':'sbyte','System.Byte':'byte','System.Int16':'short','System.UInt16':'ushort','System.Int32':'int','System.UInt32':'uint','System.Int64':'long','System.UInt64':'ulong','System.Single':'float','System.Double':'double','System.Decimal':'decimal','System.String':'string','System.Object':'object','System.IntPtr':'nint','System.UIntPtr':'nuint'}));
/** Normalize signature components, preserving opaque metadata identifiers such as closure-cell names. */
export function normalizeCallType(type) {
  const modifier=type.search(/\s+(?:modreq\(|modopt\(|pinned$)/);
  if(modifier>=0)return normalizeCallType(type.slice(0,modifier))+type.slice(modifier);
  const suffix=type.match(/(?:\[[\d\s,.*:+-]*\]|[&*])$/);
  if(suffix)return normalizeCallType(type.slice(0,-suffix[0].length))+suffix[0];
  const parts=genericTypeParts(type);
  if(parts.arguments.length)return parts.definition+'<'+parts.arguments.map(normalizeCallType).join(',')+'>';
  return type==='System.Exception'?'Exception':aliases.get(type)??type;
}

export function substituteCallType(type,typeArguments=[],methodArguments=[]) {
  return normalizeCallType(type.replace(/!!\d+|!\d+/g,variable=>variable.startsWith('!!')?methodArguments[Number(variable.slice(2))]??variable:typeArguments[Number(variable.slice(1))]??variable));
}
export const callStorageType=type=>type.replace(/\s+mod(?:req|opt)\([^)]*\)/g,'').replace(/\s+pinned$/,'');
export function instantiateSignature(signature,typeArguments=[],methodArguments=[]) {
  return {...signature,returnType:substituteCallType(signature.returnType,typeArguments,methodArguments),parameters:signature.parameters.map(type=>substituteCallType(type,typeArguments,methodArguments))};
}
export const callSignatureKey=signature=>JSON.stringify([!!signature.isStatic,signature.callingConvention??0,normalizeCallType(callStorageType(signature.returnType)),signature.parameters.map(type=>normalizeCallType(callStorageType(type)))]);

/** Resolve MemberRef/MethodSpec using the declaring type's substitution environment. */
export function resolveExecutionMethod(inspector,token,context={}) {
  const raw=inspector.resolveToken(token);
  if(raw.kind!=='method')throw new CilError('Call operand is not a method');
  const contextTypes=context.typeArguments??genericTypeParts(context.genericIdentity??'').arguments,contextMethods=context.methodArguments??[];
  let owner=substituteCallType(raw.owner,contextTypes,contextMethods),parts=genericTypeParts(owner);
  const methodArguments=(raw.genericArguments??[]).map(type=>substituteCallType(type,contextTypes,contextMethods));
  const arity=raw.signature.genericArity??0;
  if(raw.genericArguments&&methodArguments.length!==arity)throw new CilError('Generic method argument count mismatch');
  const signature=instantiateSignature(raw.signature,parts.arguments.length?parts.arguments:contextTypes,methodArguments);
  let target=raw.resolvedToken??(raw.signature.callingConvention===5&&raw.ownerToken>>>24===6?raw.ownerToken:null)??(raw.token>>>24===6?raw.token:raw.definitionToken>>>24===6?raw.definitionToken:null);
  let definition=target?inspector.methods.get(target):null;
  if(!definition) {
    const visited=new Set();
    while(!visited.has(owner)) {
      visited.add(owner);const type=inspector.types.find(type=>type.name===parts.definition);
      if(!type)break;
      const matches=type.methods.filter(method=>method.name===raw.name&&(inspector.signature(method.token).genericArity??0)===arity&&callSignatureKey(instantiateSignature(inspector.signature(method.token),parts.arguments,methodArguments))===callSignatureKey(fixedCallSignature(signature)));
      if(matches.length>1)throw new CilError('Ambiguous internal call declaration');
      if(matches.length){definition=matches[0];target=definition.token;break;}
      if(!type.baseToken)break;
      owner=substituteCallType(inspector.metadata.typeName(type.baseToken),parts.arguments,methodArguments);parts=genericTypeParts(owner);
    }
  }
  const typeArguments=definition?parts.arguments.length?parts.arguments:definition.ownerToken===context.ownerToken?contextTypes:[]:genericTypeParts(substituteCallType(raw.owner,contextTypes,contextMethods)).arguments;
  if(definition&&raw.token>>>24===6&&context.genericIdentity&&definition.ownerToken===context.ownerToken)owner=context.genericIdentity;
  return {...raw,...(definition??{}),token:raw.token,definitionToken:target??raw.definitionToken,resolvedToken:target,signature,
    owner:definition?.owner??raw.owner,ownerInstance:definition?genericTypeParts(owner).arguments.length?owner:null:genericTypeParts(raw.owner).arguments.length?substituteCallType(raw.owner,contextTypes,contextMethods):null,
    typeArguments,methodArguments,genericArguments:raw.genericArguments?methodArguments:undefined};
}

export function methodGenericParameters(inspector,methodToken) {
  return (inspector.metadata.rows[42]??[]).map((row,index)=>({index:row[0],flags:row[1],owner:decodeCoded('TypeOrMethodDef',row[2]),row:index+1})).filter(parameter=>parameter.owner===methodToken).sort((a,b)=>a.index-b.index);
}

export function managedDelegateSignature(inspector,name) {
  const framework=frameworkType(name);
  if(framework?.kind==='delegate')return {kind:'method',isStatic:false,returnType:framework.result??'void',parameters:framework.parameters};
  const parts=genericTypeParts(name);
  if((parts.definition==='System.Action'&&parts.arguments.length===0)||/^System.Action`\d+$/.test(parts.definition)&&Number(parts.definition.split('`')[1])===parts.arguments.length)return {kind:'method',isStatic:false,returnType:'void',parameters:parts.arguments};
  if(/^System.Func`\d+$/.test(parts.definition)&&parts.arguments.length&&Number(parts.definition.split('`')[1])===parts.arguments.length)return {kind:'method',isStatic:false,returnType:parts.arguments.at(-1),parameters:parts.arguments.slice(0,-1)};
  const type=inspector.types.find(type=>type.name===parts.definition);
  if(!type||!type.baseToken||inspector.metadata.typeName(type.baseToken)!=='System.MulticastDelegate')return null;
  const invoke=type.methods.find(method=>method.name==='Invoke');
  return invoke?instantiateSignature(inspector.signature(invoke.token),parts.arguments):null;
}

export function supportedDelegateCall(inspector,descriptor) {
  const signature=descriptor.signature,type=descriptor.ownerInstance??descriptor.owner,delegate=managedDelegateSignature(inspector,type);
  if(delegate&&descriptor.name==='.ctor')return !signature.isStatic&&signature.returnType==='void'&&signature.parameters.length===2&&signature.parameters[0]==='object'&&['nint','System.IntPtr'].includes(signature.parameters[1]);
  if(delegate&&descriptor.name==='Invoke')return callSignatureKey(delegate)===callSignatureKey(signature);
  if(!delegate&&!['System.Delegate','System.MulticastDelegate'].includes(descriptor.owner))return false;
  const key=descriptor.name+'|'+signature.parameters.join(',')+'|'+signature.returnType+'|'+signature.isStatic;
  return new Set(['Combine|System.Delegate,System.Delegate|System.Delegate|true','Combine|System.Delegate[]|System.Delegate|true','Remove|System.Delegate,System.Delegate|System.Delegate|true','RemoveAll|System.Delegate,System.Delegate|System.Delegate|true','op_Equality|System.Delegate,System.Delegate|bool|true','op_Inequality|System.Delegate,System.Delegate|bool|true','GetInvocationList||System.Delegate[]|false','Equals|object|bool|false']).has(key);
}
