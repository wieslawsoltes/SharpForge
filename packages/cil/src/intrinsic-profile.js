import {decimalIntrinsicDefinitions} from '@sharpforge/bytecode';
import {nullableMethodDefinition} from './nullable-profile.js';
import {canonicalType,contracts,types} from '@sharpforge/framework';

const aliases={decimal:'System.Decimal',object:'System.Object',string:'System.String',Exception:'System.Exception',int:'System.Int32',double:'System.Double',long:'System.Int64',bool:'System.Boolean'};
export const systemType=name=>aliases[name]??name;
/** Include return type and staticness: parameter-only keys can accept invalid MemberRefs. */
function signatureKey(owner,name,parameters,result,isStatic) {
  return owner+'::'+name+'('+JSON.stringify(parameters)+'):'+JSON.stringify(result)+':'+(isStatic?'static':'instance');
}
export function intrinsicKey(descriptor) {
  const signature=descriptor.signature;
  return signatureKey(canonicalType(systemType(descriptor.owner)),descriptor.name,signature.parameters.map(canonicalType),canonicalType(signature.returnType),signature.isStatic);
}
const definitions=new Map();
function add(owner,name,parameters,returnType,isStatic,implementation,contract=null) {
  const descriptor=Object.freeze({kind:'method',owner,name,signature:Object.freeze({parameters:Object.freeze([...parameters]),returnType,isStatic,genericArity:0,callingConvention:0})});
  const key=intrinsicKey(descriptor);
  definitions.set(key,Object.freeze({key,descriptor,implementation,contract}));
}
for(const [name,parameter,result] of [['SingleToInt32Bits','float','int'],['DoubleToInt64Bits','double','long'],['Int32BitsToSingle','int','float'],['Int64BitsToDouble','long','double']])add('System.BitConverter',name,[parameter],result,true,'bitConverter');
for(const owner of ['System.IntPtr','System.UIntPtr'])add(owner,'get_Size',[],'int',true,'nativeSize');
for(const descriptor of decimalIntrinsicDefinitions)add(descriptor.owner,descriptor.name,descriptor.parameters,descriptor.returnType,descriptor.isStatic,'decimal');
const primitive=['System.Decimal','int','uint','long','ulong','double','float','bool','char','string','object'];
for(const name of ['Write','WriteLine'])for(const type of primitive)add('System.Console',name,[type],'void',true,'console');
add('System.Console','WriteLine',[],'void',true,'console');
add('System.Object','.ctor',[],'void',false,'objectCtor');
add('System.Object','ToString',[],'string',false,'objectToString');
add('System.Object','GetType',[],'System.Type',false,'objectGetType');
add('System.Type','GetTypeFromHandle',['System.RuntimeTypeHandle'],'System.Type',true,'typeFromHandle');
for(const name of ['op_Equality','op_Inequality'])add('System.Type',name,['System.Type','System.Type'],'bool',true,'typeCompare');
for(const parameter of ['System.Type','object'])add('System.Type','Equals',[parameter],'bool',false,'typeEquals');
for(const owner of ['System.Type','System.Reflection.MemberInfo'])add(owner,'get_Name',[],'string',false,'typeName');
add('System.Type','get_FullName',[],'string',false,'typeName');
add('System.Type','get_TypeHandle',[],'System.RuntimeTypeHandle',false,'typeHandle');
add('System.Type','ToString',[],'string',false,'typeString');
for(const name of ['IsGenericType','IsGenericTypeDefinition','ContainsGenericParameters'])add('System.Type','get_'+name,[],'bool',false,'typeProperty');
add('System.Object','ReferenceEquals',['object','object'],'bool',true,'objectReferenceEquals');
add('System.Enum','ToString',[],'string',false,'enumToString');
add('System.Enum','HasFlag',['System.Enum'],'bool',false,'enumHasFlag');
for(const parameters of [[],['string']])add('System.Exception','.ctor',parameters,'void',false,'exceptionCtor');
add('System.Exception','get_Message',[],'string',false,'exceptionMessage');
for(const result of ['Exception','System.Exception'])add('System.Exception','get_InnerException',[],result,false,'exceptionInner');
add('System.TypeInitializationException','get_Message',[],'string',false,'exceptionMessage');
for(const result of ['Exception','System.Exception'])add('System.TypeInitializationException','get_InnerException',[],result,false,'exceptionInner');
for(const name of ['Sort','Reverse'])add('System.Array',name,['System.Array'],'void',true,'arrayMutate');
add('System.String','.ctor',['char[]'],'void',false,'stringCtor');
for(const count of [2,3,4])add('System.String','Concat',Array(count).fill('string'),'string',true,'stringConcat');
add('System.String','Concat',['object','object'],'string',true,'stringConcat');
for(const name of ['op_Equality','op_Inequality','Equals'])add('System.String',name,['string','string'],'bool',true,'stringCompare');
add('System.String','IsNullOrEmpty',['string'],'bool',true,'stringNullOrEmpty');
add('System.String','Intern',['string'],'string',true,'stringIntern');
add('System.String','IsInterned',['string'],'string',true,'stringIsInterned');
add('System.String','get_Length',[],'int',false,'stringLength');
add('System.String','get_Chars',['int'],'char',false,'stringChars');
for(const name of ['ToUpperInvariant','ToLowerInvariant','ToUpper','ToLower','Trim','ToString'])add('System.String',name,[],'string',false,'stringTransform');
for(const name of ['Contains','StartsWith','EndsWith'])add('System.String',name,['string'],'bool',false,'stringSearch');
add('System.String','IndexOf',['string'],'int',false,'stringSearch');
add('System.String','Replace',['string','string'],'string',false,'stringReplace');
for(const parameters of [['int'],['int','int']])add('System.String','Substring',parameters,'string',false,'stringSubstring');
for(const name of ['Abs','Min','Max'])for(const type of ['int','double','long','float'])add('System.Math',name,Array(name==='Abs'?1:2).fill(type),type,true,'math');
for(const name of ['Sqrt','Floor','Ceiling','Round','Sin','Cos','Tan','Log','Exp','Pow'])add('System.Math',name,Array(name==='Pow'?2:1).fill('double'),'double',true,'math');
add('System.GC','Collect',[],'void',true,'gcCollect');
add('System.GC','GetTotalMemory',['bool'],'long',true,'gcMemory');
add('System.GC','CollectionCount',['int'],'int',true,'gcCount');
for(const type of ['int','double','bool','string','object'])add('System.Convert','ToInt32',[type],'int',true,'convertInt32');
for(const type of ['int','double','string'])add('System.Convert','ToDouble',[type],'double',true,'convertDouble');
for(const type of primitive)add('System.Convert','ToString',[type],'string',true,'convertString');
for(const [owner,result] of [['System.Int32','int'],['System.Double','double'],['System.Int64','long']])add(owner,'Parse',['string'],result,true,'parse');

const builtinDefinitions=new Map(definitions),frameworkDefinitions=new Map();

// Expand inherited framework members once. Runtime lookup does not walk the type tree.
// Preserve contractForMember's nearest declaration and registration-order preference.
const declared=new Map();
for(const contract of contracts) {
  if(!declared.has(contract.owner))declared.set(contract.owner,[]);
  declared.get(contract.owner).push(contract);
}
for(const owner of new Set([...types.keys(),...declared.keys()])) {
  const seenTypes=new Set(),seenMembers=new Set();
  let current=owner;
  while(current&&!seenTypes.has(current)) {
    seenTypes.add(current);
    for(const contract of declared.get(current)??[]) {
      const result=contract.kind==='constructor'?'void':contract.result;
      const key=intrinsicKey({owner,name:contract.name,signature:{parameters:contract.parameters,returnType:result,isStatic:contract.isStatic}});
      if(seenMembers.has(key))continue;
      seenMembers.add(key);
      add(owner,contract.name,contract.parameters,result,contract.isStatic,'framework',contract);
      frameworkDefinitions.set(key,definitions.get(key));
    }
    current=types.get(current)?.base;
  }
}
export const intrinsicDefinitions=Object.freeze([...definitions.values()]);
export function intrinsicDefinition(descriptor) {
  if(descriptor?.kind!=='method'||!descriptor.signature||!Array.isArray(descriptor.signature.parameters))return null;
  const signature=descriptor.signature;
  // Framework canonical aliases and built-in CLI aliases intentionally differ.
  // This preserves the verifier's previous contract-first selection policy.
  const contract=frameworkDefinitions.get(signatureKey(canonicalType(descriptor.owner),descriptor.name,signature.parameters.map(canonicalType),canonicalType(signature.returnType),signature.isStatic));
  if(contract)return contract;
  const nullable=nullableMethodDefinition(descriptor);if(nullable)return nullable;
  if(descriptor.genericArguments||signature.genericArity||signature.callingConvention)return null;
  return builtinDefinitions.get(signatureKey(systemType(descriptor.owner),descriptor.name,signature.parameters.map(type=>type==='Array'?'System.Array':type.replace(/^decimal(?=&|$)/,'System.Decimal')),signature.returnType==='decimal'?'System.Decimal':signature.returnType,signature.isStatic))??null;
}
