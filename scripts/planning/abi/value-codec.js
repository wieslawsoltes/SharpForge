/** Portable value ABI v1 reference codec; deliberately independent of the runtime. */
export const ABI_VERSION = 1;
export const TAGS = Object.freeze(Object.fromEntries(['null','bool','i8','u8','i16','u16','i32','u32','char','f32','i64','u64','nint','f64','decimal','ref','struct'].map((name,tag)=>[name,tag])));
export class AbiError extends Error { constructor(code,message){super(message);this.name='AbiError';this.code=code;} }
const fail=(code,message)=>{throw new AbiError(code,message);};
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
const ranges={i8:[-128,127],u8:[0,255],i16:[-32768,32767],u16:[0,65535],i32:[-2147483648,2147483647],u32:[0,4294967295],char:[0,65535]};
const signed=new Set(['i8','i16','i32']);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const strictKeys=(obj,keys)=>Object.keys(obj).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(obj,k));
export function validateValue(v,depth=0){
  if(depth>64)fail('ABI_LIMIT','Value nesting exceeds 64');
  if(!v||typeof v!=='object'||!Object.hasOwn(TAGS,v.kind))fail('ABI_TAG','Unknown value tag');
  if(!strictKeys(v,v.kind==='null'?['kind']:['kind','value']))fail('ABI_VALUE','Malformed value record');
  const x=v.value;
  if(ranges[v.kind]&&!integer(x,...ranges[v.kind]))fail('ABI_RANGE',v.kind+' outside range');
  if(v.kind==='bool'&&typeof x!=='boolean')fail('ABI_VALUE','Boolean required');
  if(['f32','f64'].includes(v.kind)&&!(typeof x==='number'&&Number.isFinite(x)||['NaN','Infinity','-Infinity','-0'].includes(x)))fail('ABI_VALUE','Use explicit nonfinite float spelling');
  if(['i64','u64','nint'].includes(v.kind)){
    if(typeof x!=='string'||! /^(0|-?[1-9][0-9]*)$/.test(x))fail('ABI_VALUE','64-bit integer requires canonical decimal string');
    if(x.length>20)fail('ABI_RANGE','64-bit integer outside range');const n=BigInt(x),unsigned=v.kind==='u64';if(n<(unsigned?0n:-(1n<<63n))||n>(unsigned?(1n<<64n)-1n:(1n<<63n)-1n))fail('ABI_RANGE','64-bit integer outside range');
  }
  if(v.kind==='decimal'&&(!x||!strictKeys(x,['coefficient','scale','negative'])||typeof x.coefficient!=='string'||! /^(0|[1-9][0-9]*)$/.test(x.coefficient)||x.coefficient.length>29||BigInt(x.coefficient)>=(1n<<96n)||!integer(x.scale,0,28)||typeof x.negative!=='boolean'))fail('ABI_RANGE','Invalid decimal');
  if(v.kind==='ref'&&(!x||!strictKeys(x,['h','g'])||!integer(x.h,1,0xffffffff)||!integer(x.g,1,0xffffffff)))fail('ABI_HANDLE','Invalid handle');
  if(v.kind==='struct'&&(!x||!strictKeys(x,['type','fields'])||typeof x.type!=='string'||!x.type||!Array.isArray(x.fields)))fail('ABI_VALUE','Invalid struct');
  if(v.kind==='struct')for(const field of x.fields)validateValue(field,depth+1);
  return v;
}
function normalize(v){validateValue(v);if(v.kind==='struct')return {kind:v.kind,value:{type:v.value.type,fields:v.value.fields.map(normalize)}};if(v.kind==='f32'||v.kind==='f64'){const n=typeof v.value==='string'?v.value==='-0'?-0:Number(v.value):v.value;const f=v.kind==='f32'?Math.fround(n):n;return {kind:v.kind,value:Number.isNaN(f)?'NaN':Object.is(f,-0)?'-0':Number.isFinite(f)?f:String(f)};}return v;}
export function validateEnvelope(doc){
  if(doc?.abiVersion!==ABI_VERSION)fail('ABI_VERSION','Unsupported value ABI version');
  if(!strictKeys(doc,['abiVersion','epoch','slots','handles'])||!integer(doc.epoch,1,0xffffffff)||!Array.isArray(doc.slots)||!Array.isArray(doc.handles))fail('ABI_VALUE','Malformed envelope');
  if(doc.slots.length>1_000_000||doc.handles.length>1_000_000)fail('ABI_LIMIT','Value count exceeds limit');
  const records=new Map();for(const h of doc.handles){
    if(!h||!strictKeys(h,['h','g','kind','type','data'])||!integer(h.h,1,0xffffffff)||!integer(h.g,1,0xffffffff)||!['string','array','object'].includes(h.kind)||typeof h.type!=='string'||!h.type)fail('ABI_HANDLE','Malformed heap record');
    if(records.has(h.h))fail('ABI_HANDLE','Duplicate handle index');records.set(h.h,h);
    if(h.kind==='string'?typeof h.data!=='string':!Array.isArray(h.data))fail('ABI_HANDLE','Invalid record data');
    if(h.data.length>1_000_000)fail('ABI_LIMIT','Heap record length exceeds limit');
  }
  const check=v=>{validateValue(v);if(v.kind==='ref'&&records.get(v.value.h)?.g!==v.value.g)fail('ABI_STALE_HANDLE','Unknown or stale handle');if(v.kind==='struct')v.value.fields.forEach(check);};
  // Missing array entries have no value tag; do not let array iteration skip them.
  for(const value of doc.slots)check(value);
  for(const h of doc.handles)if(h.kind!=='string')for(const value of h.data)check(value);
  return doc;
}
export function encode(doc){
  validateEnvelope(doc);const extension=[];
  const words=doc.slots.map(raw=>{const v=normalize(raw),tag=TAGS[v.kind];let payload=0n;
    if(v.kind==='bool')payload=v.value?1n:0n;
    else if(ranges[v.kind])payload=BigInt.asUintN(56,BigInt(v.value));
    else if(v.kind==='f32'){const b=new DataView(new ArrayBuffer(4));b.setFloat32(0,v.value==='-0'?-0:Number(v.value),true);payload=BigInt(v.value==='NaN'?0x7fc00000:b.getUint32(0,true));}
    else if(v.kind!=='null'){payload=BigInt(extension.length);extension.push(v);}
    return payload<<8n|BigInt(tag);
  });
  const payload=JSON.stringify(canonical({extension,handles:doc.handles.map(h=>h.kind==='string'?h:{...h,data:h.data.map(normalize)})}));const bytes=32+words.length*8+payload.length*2;if(bytes>64*1024*1024)fail('ABI_LIMIT','Buffer exceeds 64 MiB');
  const buffer=new ArrayBuffer(bytes),view=new DataView(buffer);view.setUint32(0,0x42414653,true);view.setUint16(4,ABI_VERSION,true);view.setUint8(6,64);view.setUint32(8,doc.epoch,true);view.setUint32(12,words.length,true);view.setUint32(16,doc.handles.length,true);view.setUint32(20,payload.length*2,true);
  words.forEach((w,i)=>view.setBigUint64(32+i*8,w,true));for(let i=0;i<payload.length;i++)view.setUint16(32+words.length*8+i*2,payload.charCodeAt(i),true);return buffer;
}
export function decode(buffer){
  if(!(buffer instanceof ArrayBuffer))fail('ABI_BUFFER','ArrayBuffer required');if(buffer.byteLength<32)fail('ABI_TRUNCATED','Truncated header');if(buffer.byteLength>64*1024*1024)fail('ABI_LIMIT','Buffer exceeds 64 MiB');
  const view=new DataView(buffer);if(view.getUint32(0,true)!==0x42414653)fail('ABI_MAGIC','Invalid magic');if(view.getUint16(4,true)!==ABI_VERSION)fail('ABI_VERSION','Unsupported value ABI version');
  if(view.getUint8(6)!==64||view.getUint8(7)||view.getUint32(24,true)||view.getUint32(28,true))fail('ABI_HEADER','Unknown flags or pointer width');
  const count=view.getUint32(12,true),size=view.getUint32(20,true),start=32+count*8;if(size%2||start+size!==buffer.byteLength)fail('ABI_TRUNCATED','Truncated buffer or trailing bytes');
  const units=new Uint16Array(size/2);for(let i=0;i<units.length;i++)units[i]=view.getUint16(start+i*2,true);let str='';for(let i=0;i<units.length;i+=8192)str+=String.fromCharCode(...units.subarray(i,i+8192));let payload;try{payload=JSON.parse(str);}catch{fail('ABI_PAYLOAD','Malformed payload');}
  if(!payload||!strictKeys(payload,['extension','handles'])||!Array.isArray(payload.extension)||!Array.isArray(payload.handles)||payload.handles.length!==view.getUint32(16,true))fail('ABI_PAYLOAD','Malformed tables');
  const names=Object.keys(TAGS),slots=[];let nextExtension=0;
  for(let i=0;i<count;i++){const word=view.getBigUint64(32+i*8,true),kind=names[Number(word&255n)],p=word>>8n;if(!kind)fail('ABI_TAG','Unknown tag');let value;
    if(kind==='null'){if(p)fail('ABI_VALUE','Nonzero null');slots.push({kind});continue;}
    if(kind==='bool'){if(p>1n)fail('ABI_VALUE','Invalid bool bits');value=!!p;}
    else if(ranges[kind])value=Number(signed.has(kind)?BigInt.asIntN(56,p):p);
    else if(kind==='f32'){if(p>0xffffffffn)fail('ABI_VALUE','Nonzero float padding');const b=new DataView(new ArrayBuffer(4));b.setUint32(0,Number(p),true);value=normalize({kind,value:Number.isNaN(b.getFloat32(0,true))?'NaN':Object.is(b.getFloat32(0,true),-0)?'-0':Number.isFinite(b.getFloat32(0,true))?b.getFloat32(0,true):String(b.getFloat32(0,true))}).value;}
    else {if(p!==BigInt(nextExtension++))fail('ABI_PAYLOAD','Noncanonical extension index');const e=payload.extension[Number(p)];if(e?.kind!==kind)fail('ABI_PAYLOAD','Extension tag mismatch');value=e.value;}
    slots.push({kind,value});
  }
  if(nextExtension!==payload.extension.length)fail('ABI_PAYLOAD','Unused extension');
  const doc=validateEnvelope({abiVersion:ABI_VERSION,epoch:view.getUint32(8,true),slots,handles:payload.handles});
  // Fail closed for noncanonical encodings (including alternate NaN payloads).
  const canonicalBytes=new Uint8Array(encode(doc)),bytes=new Uint8Array(buffer);if(canonicalBytes.some((v,i)=>v!==bytes[i]))fail('ABI_CANONICAL','Noncanonical encoding');return doc;
}
let nextEpoch=1;
export class HandleLeaseTable {
  constructor(epoch=nextEpoch++){if(!integer(epoch,1,0xffffffff))fail('ABI_HANDLE','Invalid epoch');this.epoch=epoch;this.values=new Map();this.generations=new Map();this.leases=new Map();this.nextLease=1;this.nextIndex=1;this.closed=false;}
  allocate(value){if(this.closed)fail('ABI_DISPOSED','Table disposed');const h=this.nextIndex++;if(h>0xffffffff)fail('ABI_LIMIT','Handle index exhausted');const ref=Object.freeze({epoch:this.epoch,h,g:1});this.values.set(h,value);this.generations.set(h,1);return ref;}
  get(ref){if(this.closed)fail('ABI_DISPOSED','Table disposed');if(ref?.epoch!==this.epoch||!this.values.has(ref.h)||this.generations.get(ref.h)!==ref.g)fail('ABI_STALE_HANDLE','Stale or foreign handle');return this.values.get(ref.h);}
  retain(ref,{weak=false}={}){
    // A lease owns one tuple, independent of later caller edits or roots() exposure.
    const identity=Object.freeze({epoch:ref?.epoch,h:ref?.h,g:ref?.g});this.get(identity);
    const lease=Object.freeze({owner:this,id:this.nextLease++});this.leases.set(lease.id,{ref:identity,weak});return lease;
  }
  release(lease){return lease?.owner===this&&this.leases.delete(lease.id);}
  roots(){return [...this.leases.values()].filter(l=>!l.weak).map(l=>l.ref);}
  collect(live=[]){const retained=new Set([...live,...this.roots()].map(r=>{this.get(r);return r.h;}));for(const h of this.values.keys())if(!retained.has(h))this.values.delete(h);}
  dereference(lease){if(lease?.owner!==this||!this.leases.has(lease.id))return null;try{return this.get(this.leases.get(lease.id).ref);}catch(e){if(e.code==='ABI_STALE_HANDLE')return null;throw e;}}
  dispose(){this.closed=true;this.values.clear();this.leases.clear();}
}
