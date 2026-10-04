import {DiagnosticId} from '../diagnostics/codes.js';
import { applyNullableMetadataFlags as applyNullableTransform } from '../nullable/metadata-flags.js';
import { flatTypeArguments as flatArguments, withTypeArguments as rebuild, withArrayElement as arrayWith,
  withFunctionPointerTypes as functionPointerWith } from '../symbols/annotated-type-shape.js';
export { applyNullableTransform };
import {decodeCustomAttribute} from '@sharpforge/cil';
import {TypeWithAnnotations,NamedTypeSymbol,ConstructedNamedTypeSymbol,ArrayTypeSymbol,PointerTypeSymbol,FunctionPointerTypeSymbol,ErrorTypeSymbol,DynamicTypeSymbol,RefKind,SymbolDisplayFormat} from '../symbols/types.js';
/**
 * Custom-attribute decoding for imported metadata (ECMA-335 II.23.3) and the well-known attributes the
 * compiler gives meaning to: ParamArray, Extension, Obsolete, Conditional, DefaultMember, Nullable /
 * NullableContext, TupleElementNames, Dynamic, NativeInteger, IsReadOnly, IsByRefLike, RequiredMember,
 * CompilerFeatureRequired and InternalsVisibleTo.
 *
 * `decodeAttributeBlob` turns a value blob into typed constants; `decodeWellKnownAttributes` summarises the raw
 * attributes of one metadata entity; the `apply*Transform` functions rewrite an imported type symbol with the
 * per-position data the Nullable, Dynamic and TupleElementNames attributes carry.
 * The input records are the raw attributes of pe-metadata.js: {namespace,name,fullName,blob,parameterTypes}.
 */
export const WellKnownAttribute=Object.freeze({
  ParamArray:'System.ParamArrayAttribute',ParamCollection:'System.Runtime.CompilerServices.ParamCollectionAttribute',Extension:'System.Runtime.CompilerServices.ExtensionAttribute',Obsolete:'System.ObsoleteAttribute',
  Conditional:'System.Diagnostics.ConditionalAttribute',DefaultMember:'System.Reflection.DefaultMemberAttribute',Nullable:'System.Runtime.CompilerServices.NullableAttribute',NullableContext:'System.Runtime.CompilerServices.NullableContextAttribute',
  TupleElementNames:'System.Runtime.CompilerServices.TupleElementNamesAttribute',Dynamic:'System.Runtime.CompilerServices.DynamicAttribute',IsReadOnly:'System.Runtime.CompilerServices.IsReadOnlyAttribute',
  RequiresLocation:'System.Runtime.CompilerServices.RequiresLocationAttribute',IsByRefLike:'System.Runtime.CompilerServices.IsByRefLikeAttribute',IsUnmanaged:'System.Runtime.CompilerServices.IsUnmanagedAttribute',
  RequiredMember:'System.Runtime.CompilerServices.RequiredMemberAttribute',SetsRequiredMembers:'System.Diagnostics.CodeAnalysis.SetsRequiredMembersAttribute',CompilerFeatureRequired:'System.Runtime.CompilerServices.CompilerFeatureRequiredAttribute',
  InternalsVisibleTo:'System.Runtime.CompilerServices.InternalsVisibleToAttribute',NativeInteger:'System.Runtime.CompilerServices.NativeIntegerAttribute',Flags:'System.FlagsAttribute',AttributeUsage:'System.AttributeUsageAttribute'
});
/** Messages of the Obsolete markers the compiler writes next to CompilerFeatureRequired; they are not user obsoletion. */
export const ByRefLikeObsoleteMarker='Types with embedded references are not supported in this version of your compiler.';
export const RequiredMembersObsoleteMarker='Constructors of types with required members are not supported in this version of your compiler.';
/** Compiler features this compiler understands; any other CompilerFeatureRequired name makes a symbol unusable. */
export const supportedCompilerFeatures=Object.freeze(['RefStructs','RequiredMembers','ClosedClasses']);
/** Adapt the shared CIL codec to the compiler's existing typed-constant result shape. */
export function decodeAttributeBlob(blob, parameterTypes = [], env = {}) {
  // Legacy callers have always treated unresolved enum storage as Int32.
  // The public CIL API requires an explicit underlying type and reports MD0104 otherwise.
  const options = { ...env, enumUnderlyingType: (name, token) => env.enumUnderlyingType?.(name, token) ?? 8 };
  const result = decodeCustomAttribute(blob, parameterTypes, options);
  return {
    constructorArguments: result.constructorArguments,
    namedArguments: result.namedArguments,
    hasErrors: !result.success,
  };
}
const named=(decoded,name)=>decoded.namedArguments.find(a=>a.name===name)?.value.value;
const values=constantValue=>constantValue?.kind==='array'?constantValue.value?.map(v=>v.value)??null:null;
/**
 * Summarises the well-known attributes among the raw attributes of one metadata entity.
 * @returns {object} isParamArray, isParamCollection, isExtension, obsolete ({message,isError,diagnosticId,urlFormat}|null),
 *   conditionalSymbols, defaultMemberName, nullable (a byte for the single-byte form, an array for the per-position
 *   form, null when absent), nullableContext (byte|null), tupleElementNames (array|null), dynamic (boolean array|null;
 *   `[true]` for the parameterless form), nativeInteger (true for the parameterless form, a boolean array, or null), isReadOnly, requiresLocation, isByRefLike, isUnmanaged, requiredMember,
 *   setsRequiredMembers, compilerFeatureRequired ([{featureName,isOptional}]), internalsVisibleTo, isFlagsEnum
 */
export function decodeWellKnownAttributes(rawAttributes=[]){
  const data={isParamArray:false,isParamCollection:false,isExtension:false,obsolete:null,conditionalSymbols:[],defaultMemberName:null,nullable:null,nullableContext:null,tupleElementNames:null,dynamic:null,nativeInteger:null,isReadOnly:false,requiresLocation:false,isByRefLike:false,isUnmanaged:false,requiredMember:false,setsRequiredMembers:false,compilerFeatureRequired:[],internalsVisibleTo:[],isFlagsEnum:false};
  const decode=raw=>decodeAttributeBlob(raw.blob,raw.parameterTypes),first=raw=>decode(raw).constructorArguments[0];
  for(const raw of rawAttributes){
    switch(raw.fullName){
      case WellKnownAttribute.ParamArray:data.isParamArray=true;break;
      case WellKnownAttribute.ParamCollection:data.isParamCollection=true;break;
      case WellKnownAttribute.Extension:data.isExtension=true;break;
      case WellKnownAttribute.IsReadOnly:data.isReadOnly=true;break;
      case WellKnownAttribute.RequiresLocation:data.requiresLocation=true;break;
      case WellKnownAttribute.IsByRefLike:data.isByRefLike=true;break;
      case WellKnownAttribute.IsUnmanaged:data.isUnmanaged=true;break;
      case WellKnownAttribute.RequiredMember:data.requiredMember=true;break;
      case WellKnownAttribute.SetsRequiredMembers:data.setsRequiredMembers=true;break;
      case WellKnownAttribute.Flags:data.isFlagsEnum=true;break;
      case WellKnownAttribute.Obsolete:{const d=decode(raw);if(!d.hasErrors&&!data.obsolete)data.obsolete=Object.freeze({message:d.constructorArguments[0]?.value??null,isError:d.constructorArguments[1]?.value===true,diagnosticId:named(d,'DiagnosticId')??null,urlFormat:named(d,'UrlFormat')??null});break;}
      case WellKnownAttribute.Conditional:{const v=first(raw)?.value;if(typeof v==='string')data.conditionalSymbols.push(v);break;}
      case WellKnownAttribute.DefaultMember:{const v=first(raw)?.value;if(typeof v==='string')data.defaultMemberName=v;break;}
      case WellKnownAttribute.Nullable:{const v=first(raw);if(v)data.nullable=v.kind==='array'?values(v)??[]:v.value;break;}
      case WellKnownAttribute.NullableContext:{const v=first(raw)?.value;if(typeof v==='number')data.nullableContext=v;break;}
      case WellKnownAttribute.TupleElementNames:data.tupleElementNames=values(first(raw));break;
      case WellKnownAttribute.Dynamic:{const d=decode(raw);if(!d.hasErrors)data.dynamic=d.constructorArguments.length?values(d.constructorArguments[0])??[]:[true];break;}
      case WellKnownAttribute.NativeInteger:{const d=decode(raw);if(!d.hasErrors)data.nativeInteger=d.constructorArguments.length?values(d.constructorArguments[0])??[]:true;break;}
      case WellKnownAttribute.CompilerFeatureRequired:{const d=decode(raw),featureName=d.constructorArguments[0]?.value;if(typeof featureName==='string')data.compilerFeatureRequired.push(Object.freeze({featureName,isOptional:named(d,'IsOptional')===true}));break;}
      case WellKnownAttribute.InternalsVisibleTo:{const v=first(raw)?.value;if(typeof v==='string')data.internalsVisibleTo.push(v);break;}
    }
  }
  // The Obsolete attribute the compiler pairs with IsByRefLike is a marker for old compilers, not an obsoletion.
  if(data.isByRefLike&&data.obsolete?.message===ByRefLikeObsoleteMarker)data.obsolete=null;
  return data;
}
/** The first CompilerFeatureRequired feature this compiler does not understand, or null. */
export function unsupportedCompilerFeature(data,supported=supportedCompilerFeatures){return data.compilerFeatureRequired.find(f=>!supported.includes(f.featureName))?.featureName??null;}
/**
 * The diagnostic a use of an obsolete symbol produces, as `{code,args}`, or null.
 * CS0612 has no message, CS0618 is the warning with a message and CS0619 the error; a custom DiagnosticId replaces the id.
 */
export function obsoleteDiagnostic(symbol){
  const o=symbol?.obsolete;if(!o)return null;const display=symbol.toDisplayString(SymbolDisplayFormat.ErrorMessage);
  const base=o.message==null?{code:DiagnosticId.CS0612,args:[display]}:{code:o.isError?DiagnosticId.CS0619:DiagnosticId.CS0618,args:[display,o.message]};
  return o.diagnosticId?{...base,customId:o.diagnosticId,helpLink:o.urlFormat?o.urlFormat.replace('{0}',o.diagnosticId):null}:base;
}
/**
 * Whether an InternalsVisibleTo declaration list grants access to an assembly identity. A declaration with a
 * PublicKey only matches an assembly signed with that key; names compare case-insensitively.
 */
export function grantsInternalsAccess(declarations,identity){
  return declarations.some(text=>{const [name,...rest]=text.split(',').map(p=>p.trim());if(name.toLowerCase()!==identity.name.toLowerCase())return false;const key=rest.map(p=>/^PublicKey\s*=\s*([0-9a-f]+)$/i.exec(p)).find(Boolean)?.[1];return !key||key.toLowerCase()===identity.publicKey;});
}

const Mismatch=Symbol('mismatch');
/**
 * Applies DynamicAttribute transform flags: one flag per type node in pre-order, preceded by one (false) flag for a
 * by-reference parameter or return and one per custom modifier; `true` turns System.Object into dynamic.
 * @param {TypeWithAnnotations|TypeSymbol} type
 * @param {boolean[]|null} flags
 * @param {string} [refKind] RefKind of the parameter, return or field the type belongs to
 * @param {number} [refCustomModifierCount] custom modifiers on the by-reference marker itself (each takes a flag)
 * @returns {TypeWithAnnotations} the type unchanged when the flags do not fit it
 */
export function applyDynamicTransform(type,flags,refKind=RefKind.None,refCustomModifierCount=0){
  const input=TypeWithAnnotations.create(type);if(!flags)return input;let position=0;
  const next=()=>{if(position>=flags.length)throw Mismatch;return flags[position++];};
  const visit=(t,ref=RefKind.None)=>{
    if(ref&&ref!==RefKind.None)next();for(let i=0;i<t.customModifiers.length;i++)next();
    const flag=next(),s=t.type;
    if(s instanceof ArrayTypeSymbol)return t.withType(arrayWith(s,visit(s.elementTypeWithAnnotations)));
    if(s instanceof PointerTypeSymbol){const pointee=visit(s.pointedAtTypeWithAnnotations);return pointee===s.pointedAtTypeWithAnnotations?t:t.withType(new PointerTypeSymbol(pointee));}
    if(s instanceof FunctionPointerTypeSymbol)return t.withType(functionPointerWith(s,visit));
    if(s instanceof ErrorTypeSymbol){s.typeArguments.forEach(a=>visit(a));return t;}
    if(s instanceof NamedTypeSymbol){if(flag)return s.specialType==='System_Object'?t.withType(DynamicTypeSymbol.instance):(()=>{throw Mismatch;})();return t.withType(rebuild(s,flatArguments(s).map(a=>visit(a))));}
    if(flag)throw Mismatch;return t;
  };
  try{position=refCustomModifierCount;const result=visit(input,refKind);return position===flags.length?result:input;}catch(e){if(e===Mismatch)return input;throw e;}
}
/**
 * Applies NativeIntegerAttribute flags: one flag per System.IntPtr / System.UIntPtr occurrence in pre-order
 * (`true` alone marks every occurrence); a marked occurrence is nint / nuint.
 * @returns {TypeWithAnnotations} the type unchanged when the flags do not fit it
 */
export function applyNativeIntegerTransform(type,flags){
  const input=TypeWithAnnotations.create(type);if(!flags)return input;let position=0;
  const next=()=>{if(flags===true)return true;if(position>=flags.length)throw Mismatch;return flags[position++];};
  const visit=t=>{
    const s=t.type;
    if(s instanceof ArrayTypeSymbol)return t.withType(arrayWith(s,visit(s.elementTypeWithAnnotations)));
    if(s instanceof PointerTypeSymbol){const pointee=visit(s.pointedAtTypeWithAnnotations);return pointee===s.pointedAtTypeWithAnnotations?t:t.withType(new PointerTypeSymbol(pointee));}
    if(s instanceof FunctionPointerTypeSymbol)return t.withType(functionPointerWith(s,a=>visit(a)));
    if(s instanceof NamedTypeSymbol){
      if(s.specialType==='System_IntPtr'||s.specialType==='System_UIntPtr'){if(!next()||s.isNativeInteger)return t;const native=new ConstructedNamedTypeSymbol(s.originalDefinition,[],null);native.isNativeInteger=true;return t.withType(native);}
      return t.withType(rebuild(s,flatArguments(s).map(visit)));
    }
    return t;
  };
  try{const result=visit(input);return flags===true||position===flags.length?result:input;}catch(e){if(e===Mismatch)return input;throw e;}
}
const tupleCardinality=type=>type.originalDefinition.arity<8?type.originalDefinition.arity:7+(type.typeArguments[7]?.type.isTupleType?tupleCardinality(type.typeArguments[7].type):1);
/**
 * Applies TupleElementNamesAttribute names: every tuple type takes as many names as it has elements, in pre-order.
 * @returns {TypeWithAnnotations} the type unchanged when the names do not fit it
 */
export function applyTupleElementNames(type,names){
  const input=TypeWithAnnotations.create(type);if(!names)return input;let position=0;
  const visit=(t,isRest=false)=>{
    const s=t.type;
    if(s instanceof ArrayTypeSymbol)return t.withType(arrayWith(s,visit(s.elementTypeWithAnnotations)));
    if(s instanceof PointerTypeSymbol){const pointee=visit(s.pointedAtTypeWithAnnotations);return pointee===s.pointedAtTypeWithAnnotations?t:t.withType(new PointerTypeSymbol(pointee));}
    if(s instanceof FunctionPointerTypeSymbol)return t.withType(functionPointerWith(s,a=>visit(a)));
    if(s instanceof NamedTypeSymbol&&!(s instanceof ErrorTypeSymbol)){
      let own=null;const tuple=s.isTupleType&&!s.isDefinition;
      if(tuple){const count=tupleCardinality(s);if(position+count>names.length)throw Mismatch;own=names.slice(position,position+count);position+=count;}
      const args=flatArguments(s),rebuilt=rebuild(s,args.map((a,i)=>visit(a,tuple&&s.originalDefinition.arity===8&&i===args.length-1)));
      return own&&!isRest&&own.some(n=>n!=null)?t.withType(rebuilt.withTupleElementNames(own)):t.withType(rebuilt);
    }
    return t;
  };
  try{const result=visit(input);return position===names.length?result:input;}catch(e){if(e===Mismatch)return input;throw e;}
}
/**
 * Applies, in Roslyn's order, the Dynamic, NativeInteger, TupleElementNames and Nullable data of one metadata entity to its type.
 * @param {TypeWithAnnotations|TypeSymbol} type
 * @param {object} data a `decodeWellKnownAttributes` result
 * @param {object} [context] refKind (and refCustomModifierCount) of the entity; nullableContext: the enclosing NullableContext byte
 */
export function applyTypeTransforms(type,data,context={}){
  let result=applyDynamicTransform(type,data.dynamic,context.refKind,context.refCustomModifierCount??0);
  result=applyNativeIntegerTransform(result,data.nativeInteger);result=applyTupleElementNames(result,data.tupleElementNames);
  return applyNullableTransform(result,data.nullable,context.nullableContext??0);
}
