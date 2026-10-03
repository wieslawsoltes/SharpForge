/**
 * Names of synthesized symbols, compatible with Roslyn's GeneratedNames so that debuggers, decompilers and
 * reflection-based tools recognise SharpForge output. The shape is `<prefix>kind__suffix` where `kind` is Roslyn's
 * GeneratedNameKind character.
 */
export const GeneratedNameKind=Object.freeze({ThisProxyField:'4',HoistedLocalField:'5',DisplayClassLocalOrField:'8',LambdaMethod:'b',LambdaDisplayClass:'c',StateMachineType:'d',LocalFunction:'g',AutoPropertyBackingField:'k',IteratorCurrentBackingField:'2',StateMachineParameterProxyField:'3',StateMachineStateField:'1',AsyncBuilderField:'t',AwaiterField:'u',HoistedSynthesizedLocalField:'s',HoistedWithLocalPrefix:'7',LambdaCacheField:'9',FixedBufferField:'e',AnonymousType:'f',TransparentIdentifier:'h',AnonymousTypeField:'i',IteratorCurrentThreadIdField:'l',DynamicCallSiteContainerType:'o',DynamicCallSiteField:'p',PrimaryConstructorParameter:'P'});
const suffix=(methodOrdinal,entityOrdinal,generation=0)=>(methodOrdinal>=0?String(methodOrdinal)+(entityOrdinal>=0?'_':''):'')+(entityOrdinal>=0?String(entityOrdinal):'')+(generation>0?'#'+generation:'');
/** `<M>d__0`: the state machine class of iterator/async method M. */
export const stateMachineTypeName=(methodName,methodOrdinal,generation=0)=>`<${methodName}>d__${suffix(methodOrdinal,-1,generation)}`;
/** `<>c__DisplayClass0_0`: the closure class for scope `closureOrdinal` of method `methodOrdinal`. */
export const displayClassName=(methodOrdinal,closureOrdinal,generation=0)=>`<>c__DisplayClass${suffix(methodOrdinal,closureOrdinal,generation)}`;
/** `<>c`: the singleton class that holds non-capturing lambdas. */
export const staticLambdaDisplayClassName=(generation=0)=>'<>c'+(generation>0?'#'+generation:'');
/** `<M>b__0_1`: lambda `lambdaOrdinal` of method M. */
export const lambdaMethodName=(methodName,methodOrdinal,lambdaOrdinal,generation=0)=>`<${methodName}>b__${suffix(methodOrdinal,lambdaOrdinal,generation)}`;
/** `<M>g__Local|0_1`: local function Local of method M. */
export const localFunctionName=(methodName,localFunctionName_,methodOrdinal,ordinal,generation=0)=>`<${methodName}>g__${localFunctionName_}|${suffix(methodOrdinal,ordinal,generation)}`;
/** `<>9__0_1`: the cache field of a non-capturing lambda. */
export const lambdaCacheFieldName=(methodOrdinal,lambdaOrdinal,generation=0)=>`<>9__${suffix(methodOrdinal,lambdaOrdinal,generation)}`;
/** `<>9`: the static instance field of the `<>c` class. */
export const staticLambdaDisplayClassInstanceFieldName=()=>'<>9';
/** `CS$<>8__locals0`: the local that holds a display class instance. */
export const displayClassLocalName=ordinal=>`CS$<>8__locals${ordinal}`;
/** `<name>5__1`: a user local hoisted into a state machine (slot ordinals are 1-based). */
export const hoistedLocalFieldName=(localName,slotOrdinal)=>`<${localName}>5__${slotOrdinal}`;
/** `<>s__1`: a compiler temporary hoisted into a state machine. */
export const hoistedSynthesizedLocalFieldName=slotOrdinal=>`<>s__${slotOrdinal}`;
/** `<>7__wrap1`: a hoisted using/lock/foreach helper local. */
export const hoistedWrapFieldName=slotOrdinal=>`<>7__wrap${slotOrdinal}`;
export const stateMachineStateFieldName=()=>'<>1__state';
export const iteratorCurrentFieldName=()=>'<>2__current';
export const iteratorThreadIdFieldName=()=>'<>l__initialThreadId';
export const asyncBuilderFieldName=()=>'<>t__builder';
/** `<>u__1`: the awaiter field for awaiter slot `slotOrdinal` (1-based). */
export const awaiterFieldName=slotOrdinal=>`<>u__${slotOrdinal}`;
export const thisProxyFieldName=()=>'<>4__this';
/** `<>3__name`: the copy of a parameter kept by an iterator for re-enumeration. */
export const stateMachineParameterProxyFieldName=parameterName=>`<>3__${parameterName}`;
/** `<Name>k__BackingField`: the backing field of an auto-property. */
export const backingFieldName=propertyName=>`<${propertyName}>k__BackingField`;
/** `<name>P`: the field a captured primary-constructor parameter is stored in. */
export const primaryConstructorParameterFieldName=parameterName=>`<${parameterName}>P`;
/** `<>f__AnonymousType0`: anonymous type number `index`. */
export const anonymousTypeName=index=>`<>f__AnonymousType${index}`;
/** `<Name>i__Field`: the backing field of an anonymous type property. */
export const anonymousTypeFieldName=propertyName=>`<${propertyName}>i__Field`;
/** `<>h__TransparentIdentifier0`: a query-expression transparent identifier. */
export const transparentIdentifierName=index=>`<>h__TransparentIdentifier${index}`;
export const topLevelProgramTypeName=()=>'Program';
export const topLevelMainMethodName=()=>'<Main>$';
/** `<Main>`: the synchronous entry point wrapper around an async Main. */
export const asyncMainWrapperName=()=>'<Main>';
export const recordCloneMethodName=()=>'<Clone>$';
export const privateImplementationDetailsTypeName=()=>'<PrivateImplementationDetails>';
/** Parses a generated name into {prefix, kind, suffix}; null when the name is not compiler generated. */
export function parseGeneratedName(name){const m=/^(?:CS\$)?<([^>]*)>([1-9a-zA-Z])(?:__(.*))?$/.exec(name);return m?{prefix:m[1],kind:m[2],suffix:m[3]??''}:null;}
/** True for names the compiler generates (they cannot be written in C# source). */
export const isGeneratedName=name=>name.startsWith('<')||name.startsWith('CS$<');
