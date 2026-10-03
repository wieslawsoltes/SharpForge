/**
 * Language-version gates for semantic-only features (SF-A02-T12.3 / B01).
 *
 * The parser gates what it can see in the token stream (packages/syntax `checkFeatures`). Features that only binding
 * can recognise - async Main, covariant returns, default interface implementations, static abstract members,
 * native-sized integers, readonly members, ref reassignment, parameterless struct constructors, first-class spans,
 * inferred tuple names, target-typed conditional, unmanaged/Enum/Delegate constraints ... - are gated here with the
 * same catalog (`languageFeature(id)`), so syntax and semantic rows share one feature id, name and version.
 */
import {languageFeature,featureAvailability,parseLanguageVersion} from '@sharpforge/syntax';

/** Semantic features the binder gates: binder-facing key -> A01 catalog feature id. */
export const semanticFeatures=Object.freeze({
  asyncMain:'AsyncMain',covariantReturns:'CovariantReturnsForOverrides',defaultInterfaceImplementation:'DefaultInterfaceImplementation',staticAbstractMembers:'StaticAbstractMembersInInterfaces',
  nativeInt:'NativeInt',readonlyMembers:'ReadOnlyMembers',readonlyStructs:'ReadOnlyStructs',refStructs:'RefStructs',refReassignment:'RefReassignment',refConditional:'RefConditional',refLocalsReturns:'RefLocalsReturns',
  parameterlessStructConstructors:'ParameterlessStructConstructors',structFieldInitializers:'StructFieldInitializers',inferredTupleNames:'InferredTupleNames',targetTypedConditional:'TargetTypedConditional',
  unmanagedConstraint:'UnmanagedGenericTypeConstraint',enumConstraint:'EnumGenericTypeConstraint',delegateConstraint:'DelegateGenericTypeConstraint',notNullConstraint:'NotNullGenericTypeConstraint',
  genericAttributes:'GenericAttributes',refStructInterfaces:'RefStructInterfaces',allowsRefStruct:'AllowsRefStructConstraint',firstClassSpan:'FirstClassSpan',improvedOverloadCandidates:'ImprovedOverloadCandidates',
  nullableReferenceTypes:'NullableReferenceTypes',unconstrainedTypeParameterInNullCoalescing:'UnconstrainedTypeParameterInNullCoalescingOperator',extensionGetEnumerator:'ExtensionGetEnumerator',numericIntPtr:'NumericIntPtr',
  privateProtected:'PrivateProtected',tupleEquality:'TupleEquality',recordStructs:'RecordStructs',lambdaReturnType:'LambdaReturnType',inferredDelegateType:'InferredDelegateType',userDefinedCompoundAssignment:'UserDefinedCompoundAssignmentOperators'});
/** The catalog row of a semantic feature key, or null when the syntax catalog does not list it (then the fallback name/version apply). */
export function semanticFeature(key){const id=semanticFeatures[key]??key;return languageFeature(id)??null;}
/**
 * Checks one semantic feature against the selected language version.
 * @param {string} key a key of `semanticFeatures` or a catalog feature id  @param version LangVersion text or parsed version
 * @param {{name:string,version:number}} [fallback] used when the catalog has no such row
 * @returns {null|{code:string,message:string,args:string[]}} the Roslyn "feature not available" diagnostic, or null when available
 */
export function checkSemanticFeature(key,version,fallback=null){
  const id=semanticFeatures[key]??key,row=languageFeature(id);
  if(row)return featureAvailability(id,version);
  if(!fallback)return null;
  const selected=typeof version==='object'&&version?version:parseLanguageVersion(version)??parseLanguageVersion('default');
  if(selected.number>=fallback.version)return null;
  const display=n=>Number.isInteger(n)?(n>=7?n+'.0':String(n)):String(n),codes={1:'CS8022',2:'CS8023',3:'CS8024',4:'CS8025',5:'CS8026',6:'CS8059',7:'CS8107',7.1:'CS8302',7.2:'CS8320',7.3:'CS8370',8:'CS8400',9:'CS8773',10:'CS8936',11:'CS9058',12:'CS9202',13:'CS9260',14:'CS9327'};
  return {code:codes[selected.number]??'CS9058',message:`Feature '${fallback.name}' is not available in C# ${display(selected.number)}. Please use language version ${display(fallback.version)} or greater.`};
}
/** A binder-side gate: `gate(node,key,fallback)` reports through `report(node,code,message)` once per node and returns whether the feature is available. */
export function createFeatureGate(versionOf,report){
  const seen=new Set();
  return (uri,node,key,fallback=null)=>{
    const result=checkSemanticFeature(key,versionOf(uri),fallback);if(!result)return true;
    const span=node.span??node,id=uri+':'+span.start+':'+key;if(!seen.has(id)){seen.add(id);report(uri,node,result.code,result.message);}
    return false;
  };
}
