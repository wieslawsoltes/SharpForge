import { CilError } from '../binary.js';
export const metadataCodedIndices = {
  ResolutionScope:[2,[0,26,35,1]],TypeDefOrRef:[2,[2,1,27]],MemberRefParent:[3,[2,1,26,6,27]],HasConstant:[2,[4,8,23]],HasCustomAttribute:[5,[6,4,1,2,8,9,10,0,14,23,20,17,26,27,32,35,38,39,40,42,44,43]],CustomAttributeType:[3,[null,null,6,10,null]],HasFieldMarshal:[1,[4,8]],HasDeclSecurity:[2,[2,6,32]],HasSemantics:[1,[20,23]],MethodDefOrRef:[1,[6,10]],MemberForwarded:[1,[4,6]],Implementation:[2,[38,35,39]],TypeOrMethodDef:[1,[2,6]],HasCustomDebugInformation:[5,[6,4,1,2,8,9,10,0,14,23,20,17,26,27,32,35,38,39,40,42,44,43,48,50,51,52,53]]
};
const coded=metadataCodedIndices;
export function token(table, row) { return (table * 0x1000000 + row) >>> 0; }
export function codedIndex(kind, metadataToken) { if (!metadataToken) return 0; const [bits,tables] = coded[kind], table = metadataToken >>> 24, tag = tables.indexOf(table); if (tag < 0) throw new CilError(`Token cannot be encoded as ${kind}`); return ((metadataToken & 0xffffff) << bits) | tag; }
export function decodeCoded(kind, value) { if (!value) return 0; const [bits,tables] = coded[kind],table=tables[value & ((1<<bits)-1)]; if (table === undefined || table === null) throw new CilError(`Invalid ${kind} tag`); return token(table,value>>>bits); }
export function metadataIndexWidth(kind, counts, heaps) { if (kind==='u16') return 2; if(kind==='u32')return 4; if(kind==='str')return heaps&1?4:2;if(kind==='guid')return heaps&2?4:2;if(kind==='blob')return heaps&4?4:2;if(/^t\d+$/.test(kind))return (counts[+kind.slice(1)]??0)<65536?2:4;const [bits,refs]=coded[kind];return Math.max(...refs.map(t=>counts[t]??0))<(1<<(16-bits))?2:4; }
