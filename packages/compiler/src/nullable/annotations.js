/**
 * Nullable annotations and contexts (SF-A02-T05.3).
 *
 * `NullableContextMap` answers "which nullable context is in effect at this position" from the `#nullable` directive
 * trivia of a file and the compilation default (`/nullable`). `annotate` turns the syntax fact "the type was written
 * with `?`" into a NullableAnnotation for that context: annotated, not annotated, or oblivious when annotations are
 * disabled. `encodeNullableFlags` / `decodeNullableFlags` are the metadata form Roslyn emits in NullableAttribute
 * (one byte per type in pre-order: 0 oblivious, 1 not annotated, 2 annotated; non-generic value types have no byte),
 * and `nullableContextFlag` chooses the NullableContextAttribute value of a scope (its most common byte).
 */
import {NullableAnnotation,TypeWithAnnotations,NamedTypeSymbol,ArrayTypeSymbol,PointerTypeSymbol,TypeKind} from '../symbols/types.js';

/** The four `/nullable` settings as the two independent switches they stand for. */
export const nullableSettings=Object.freeze({disable:Object.freeze({annotations:false,warnings:false}),enable:Object.freeze({annotations:true,warnings:true}),warnings:Object.freeze({annotations:false,warnings:true}),annotations:Object.freeze({annotations:true,warnings:false})});

/** The nullable context of one file as a function of position. */
export class NullableContextMap{
  /**
   * @param {object[]} directives directive trivia of the file (`parse().directives`); only active `#nullable` ones count
   * @param {'disable'|'enable'|'warnings'|'annotations'} defaultContext the compilation-wide setting
   */
  constructor(directives=[],defaultContext='disable'){
    const initial=nullableSettings[defaultContext]??nullableSettings.disable;this.initial=initial;this.entries=[];let current={...initial};
    for(const d of [...directives].sort((a,b)=>a.end-b.end)){
      const s=d.structure;if(!s||s.directive!=='nullable'||s.isActive===false||!s.setting)continue;
      const value=s.setting==='enable'?true:s.setting==='disable'?false:null,next={...current};
      for(const key of s.target?[s.target]:['annotations','warnings'])if(key in next)next[key]=value===null?initial[key]:value;
      current=next;this.entries.push({position:d.end,state:Object.freeze(next)});
    }
    Object.freeze(this);
  }
  /** `{annotations,warnings}` in effect at `position`. */
  stateAt(position){let low=0,high=this.entries.length;while(low<high){const mid=low+high>>1;if(this.entries[mid].position<=position)low=mid+1;else high=mid;}return low?this.entries[low-1].state:this.initial;}
  annotationsEnabledAt(position){return this.stateAt(position).annotations;}
  warningsEnabledAt(position){return this.stateAt(position).warnings;}
  /** True when any part of the file can produce nullable warnings (lets callers skip the flow walk). */
  get anyWarnings(){return this.initial.warnings||this.entries.some(e=>e.state.warnings);}
}

/** The annotation of a reference type written with (`questionMark`) or without `?` in a context where annotations are on or off. */
export function annotationFor(questionMark,annotationsEnabled){return questionMark?NullableAnnotation.Annotated:annotationsEnabled?NullableAnnotation.NotAnnotated:NullableAnnotation.Oblivious;}
/** Applies `annotationFor` to a type; value types other than Nullable<T> carry no reference annotation. */
export function annotate(type,questionMark,annotationsEnabled){
  if(type instanceof TypeWithAnnotations)type=type.type;
  if(type.isValueType===true&&!type.isNullableValueType)return new TypeWithAnnotations(type,annotationsEnabled?NullableAnnotation.NotAnnotated:NullableAnnotation.Oblivious);
  return new TypeWithAnnotations(type,annotationFor(questionMark,annotationsEnabled));
}
const byteOf=a=>a===NullableAnnotation.Annotated?2:a===NullableAnnotation.NotAnnotated?1:0;
const annotationOf=b=>b===2?NullableAnnotation.Annotated:b===1?NullableAnnotation.NotAnnotated:NullableAnnotation.Oblivious;
const hasByte=type=>!(type instanceof PointerTypeSymbol)&&!(type.isValueType===true&&type.typeKind!==TypeKind.TypeParameter&&!(type instanceof NamedTypeSymbol&&type.arity>0));
const parts=type=>type instanceof ArrayTypeSymbol?[type.elementTypeWithAnnotations]:type instanceof NamedTypeSymbol&&!type.isDefinition?[...(type.containingType&&!type.containingType.isDefinition?type.containingType.typeArguments:[]),...type.typeArguments]:[];
/** The NullableAttribute bytes of a type reference, pre-order. A generic value type contributes 0 for itself. */
export function encodeNullableFlags(typeWithAnnotations){
  const out=[],walk=t=>{const type=t.type;if(hasByte(type))out.push(type.isValueType===true&&type.typeKind!==TypeKind.TypeParameter?0:byteOf(t.nullableAnnotation));for(const p of parts(type))walk(p);};
  walk(typeWithAnnotations instanceof TypeWithAnnotations?typeWithAnnotations:new TypeWithAnnotations(typeWithAnnotations));return out;
}
/** Roslyn stores a single byte when every byte is equal. */
export function compactNullableFlags(bytes){return bytes.length>1&&bytes.every(b=>b===bytes[0])?[bytes[0]]:bytes;}
/**
 * Applies NullableAttribute bytes (or the NullableContext byte when the attribute is absent) to an imported type.
 * Returns a TypeWithAnnotations whose nested types are annotated too.
 */
export function decodeNullableFlags(type,bytes,contextFlag=0){
  let index=0;const single=bytes&&bytes.length===1?bytes[0]:null,next=()=>bytes==null?contextFlag:single??bytes[index++]??0;
  const walk=t=>{
    const bare=t instanceof TypeWithAnnotations?t.type:t;let annotation=NullableAnnotation.Oblivious;
    if(hasByte(bare)){const b=next();annotation=bare.isValueType===true&&bare.typeKind!==TypeKind.TypeParameter?NullableAnnotation.Oblivious:annotationOf(b);}
    if(bare instanceof ArrayTypeSymbol)return new TypeWithAnnotations(new ArrayTypeSymbol(walk(bare.elementTypeWithAnnotations),bare.rank,{isSZArray:bare.isSZArray,baseType:bare._base,interfaces:bare._interfaces}),annotation);
    if(bare instanceof NamedTypeSymbol&&!bare.isDefinition&&bare.typeArguments.length)return new TypeWithAnnotations(bare.originalDefinition.construct(bare.typeArguments.map(walk)),annotation);
    return new TypeWithAnnotations(bare,annotation);
  };
  return walk(type);
}
/** The NullableContextAttribute value for a scope: the most frequent byte among its members' flags (ties: the smaller). */
export function nullableContextFlag(flagLists){
  const counts=[0,0,0];for(const list of flagLists)for(const b of list)counts[b]++;
  let best=0;for(let b=1;b<3;b++)if(counts[b]>counts[best])best=b;return best;
}
/** The attributes to emit for one member: `{nullable:number[]|null}` - null when the scope's context flag already says it. */
export function nullableAttributeFor(typeWithAnnotations,contextFlag){
  const bytes=compactNullableFlags(encodeNullableFlags(typeWithAnnotations));
  return {nullable:bytes.length===0||bytes.length===1&&bytes[0]===contextFlag?null:bytes};
}
