/** Standard single-disk ZIP (stored / deflate). All input is untrusted data. */
import {inflateRaw} from './deflate.js';
import {portablePath} from './path-policy.js';
export * from './path-policy.js';
export * from './text-encoding.js';
export * from './deflate.js';
export const ZIP_LIMITS=Object.freeze({maxEntries:20000,maxFileBytes:64*1024*1024,maxTotalBytes:128*1024*1024,maxArchiveBytes:160*1024*1024,maxPathLength:1024,maxDepth:48});
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
// The standard IBM437 upper half (not a locale-dependent platform decoder).
const ibm437='ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function limitOptions(options={}){const limits={...ZIP_LIMITS,...options};for(const k of Object.keys(ZIP_LIMITS))if(!Number.isSafeInteger(limits[k])||limits[k]<1||limits[k]>0x7fffffff)throw new Error('Invalid archive limit: '+k);return limits;}
function view(bytes){return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
function verifyNames(entries,limits){const paths=new Map(),identities=new Map();for(const e of entries){const key=e.path.normalize('NFC').toLowerCase();if(paths.has(key))throw new Error('Duplicate or case-colliding path: '+e.path);paths.set(key,e.directory);}
 for(const e of entries){let spelling=e.path;while(spelling){const key=spelling.normalize('NFC').toLowerCase(),old=identities.get(key);if(old&&old!==spelling)throw new Error('Case-colliding parent path: '+spelling);identities.set(key,spelling);const slash=spelling.lastIndexOf('/');spelling=slash<0?'':spelling.slice(0,slash);}const parts=e.path.normalize('NFC').toLowerCase().split('/');parts.pop();while(parts.length){const p=parts.join('/');if(paths.has(p)&&paths.get(p)===false)throw new Error('File/directory path collision: '+e.path);parts.pop();}}
 if(entries.length>limits.maxEntries)throw new Error('Archive entry limit exceeded');
}
function extraFields(bytes){const fields=new Map(),v=view(bytes);let p=0;while(p<bytes.length){if(p+4>bytes.length)throw new Error('Truncated ZIP extra field');const id=v.getUint16(p,true),n=v.getUint16(p+2,true);p+=4;if(p+n>bytes.length||fields.has(id))throw new Error('Invalid or duplicate ZIP extra field');fields.set(id,bytes.subarray(p,p+n));p+=n;}if(fields.has(1))throw new Error('ZIP64 is not supported; use a standard archive under the documented limits');return fields;}
/** Validate the complete directory and all CRCs before returning any file. Never extracts to disk. */
export function readZip(input,options={}){
 const limits=limitOptions(options),bytes=input instanceof Uint8Array?input:input instanceof ArrayBuffer?new Uint8Array(input):null;
 if(!bytes||bytes.length<22||bytes.length>limits.maxArchiveBytes)throw new Error('Invalid or oversized ZIP archive');const v=view(bytes);
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===bytes.length){end=i;break;}
 if(end<0)throw new Error('ZIP end directory was not found');const count=v.getUint16(end+10,true),size=v.getUint32(end+12,true),start=v.getUint32(end+16,true);
 if(count===65535||size===0xffffffff||start===0xffffffff)throw new Error('ZIP64 archives are not supported');
 if(v.getUint16(end+4,true)||v.getUint16(end+6,true)||v.getUint16(end+8,true)!==count)throw new Error('Multi-disk ZIP archives are not supported');
 if(count>limits.maxEntries||start+size!==end||start>end)throw new Error('Invalid ZIP central directory or entry limit');
 let p=start,total=0;const entries=[],ranges=[];
 for(let i=0;i<count;i++){
  if(p+46>end||v.getUint32(p,true)!==0x02014b50)throw new Error('Invalid ZIP central entry');
  const made=v.getUint16(p+4,true),need=v.getUint16(p+6,true),flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),crc=v.getUint32(p+16,true),compressed=v.getUint32(p+20,true),length=v.getUint32(p+24,true),nl=v.getUint16(p+28,true),xl=v.getUint16(p+30,true),cl=v.getUint16(p+32,true),disk=v.getUint16(p+34,true),attrs=v.getUint32(p+38,true),local=v.getUint32(p+42,true);
  if(!nl||p+46+nl+xl+cl>end||compressed===0xffffffff||length===0xffffffff||local===0xffffffff)throw new Error('Truncated or ZIP64 central entry');
  if(need>20||disk||flags&~(0x800|8|6)||flags&1)throw new Error('Encrypted or unsupported ZIP features');if(![0,8].includes(method))throw new Error('Unsupported ZIP compression method '+method);
  const mode=attrs>>>16,unix=(made>>>8)===3;if(unix&&(mode&0xf000)&&![0x4000,0x8000].includes(mode&0xf000))throw new Error('Links and special files are not accepted');
  const raw=bytes.subarray(p+46,p+46+nl),extra=extraFields(bytes.subarray(p+46+nl,p+46+nl+xl));let name=flags&0x800?decoder.decode(raw):Array.from(raw,b=>b<128?String.fromCharCode(b):ibm437[b-128]).join('');
  const unicode=extra.get(0x7075);if(unicode){if(unicode.length<5||unicode[0]!==1||view(unicode).getUint32(1,true)!==crc32(raw))throw new Error('Invalid Unicode ZIP path field');const decoded=decoder.decode(unicode.subarray(5));if(flags&0x800&&decoded!==name)throw new Error('Conflicting ZIP Unicode names');name=decoded;}
  const directory=/[\\/]$/.test(name)||unix&&(mode&0xf000)===0x4000||!!(attrs&16),path=portablePath(name,{...limits,directory});
  if(length>limits.maxFileBytes||(total+=length)>limits.maxTotalBytes||directory&&length!==0)throw new Error('Uncompressed archive size limit exceeded or nonempty directory');
  if(local+30>start||v.getUint32(local,true)!==0x04034b50)throw new Error('Invalid ZIP local header');const lf=v.getUint16(local+6,true),lm=v.getUint16(local+8,true),ln=v.getUint16(local+26,true),lx=v.getUint16(local+28,true),data=local+30+ln+lx;
  if(lf!==flags||lm!==method||ln!==nl||data+compressed>start||data>start||!raw.every((b,j)=>bytes[local+30+j]===b))throw new Error('Central/local ZIP header mismatch');
  extraFields(bytes.subarray(local+30+ln,data));
  if(!(flags&8)&&(v.getUint32(local+14,true)!==crc||v.getUint32(local+18,true)!==compressed||v.getUint32(local+22,true)!==length))throw new Error('Central/local ZIP size or CRC mismatch');
  let last=data+compressed;
  if(flags&8){const valid=d=>d+12<=start&&v.getUint32(d,true)===crc&&v.getUint32(d+4,true)===compressed&&v.getUint32(d+8,true)===length;let d=last;if(valid(d)){/* Unsigned descriptor, including CRC equal to the optional signature. */}else if(d+4<=start&&v.getUint32(d,true)===0x08074b50&&valid(d+4))d+=4;else throw new Error('Invalid ZIP data descriptor');last=d+12;}
  ranges.push([local,last]);entries.push({path,directory,length,compressed,method,crc,data});p+=46+nl+xl+cl;
 }
 if(p!==end)throw new Error('ZIP central-directory length mismatch');verifyNames(entries,limits);ranges.sort((a,b)=>a[0]-b[0]);for(let i=1;i<ranges.length;i++)if(ranges[i][0]<ranges[i-1][1])throw new Error('Overlapping ZIP entries');
 return entries.map(e=>{const compressed=bytes.subarray(e.data,e.data+e.compressed),output=e.method===0?compressed.slice():inflateRaw(compressed,e.length,limits.maxFileBytes);if(output.length!==e.length||crc32(output)!==e.crc)throw new Error('ZIP data CRC/length mismatch: '+e.path);return {path:e.path,directory:e.directory,bytes:output};});
}
/** Deterministic UTF-8 ZIP writer. STORED keeps export portable and synchronous; readers accept DEFLATE too. */
export function writeZip(files,options={}){
 const limits=limitOptions(options);if(!Array.isArray(files))throw new Error('ZIP entries must be an array');let total=0;
 const entries=files.map(f=>{const directory=!!f.directory,path=portablePath(f.path,{...limits,directory}),bytes=directory?new Uint8Array():f.bytes instanceof Uint8Array?f.bytes:typeof f.text==='string'?encoder.encode(f.text):null;if(!bytes)throw new Error('Missing ZIP bytes: '+path);if(bytes.length>limits.maxFileBytes||(total+=bytes.length)>limits.maxTotalBytes)throw new Error('Archive size limit exceeded');const name=encoder.encode(path+(directory?'/':''));if(name.length>65535)throw new Error('ZIP path exceeds encoding limit');return {path,directory,bytes,name,crc:crc32(bytes)};}).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 verifyNames(entries,limits);let localSize=0,centralSize=0;for(const e of entries){e.offset=localSize;localSize+=30+e.name.length+e.bytes.length;centralSize+=46+e.name.length;}const length=localSize+centralSize+22;if(length>limits.maxArchiveBytes||entries.length>=65535)throw new Error('ZIP output limit exceeded');const out=new Uint8Array(length),v=view(out);let p=0;
 for(const e of entries){v.setUint32(p,0x04034b50,true);v.setUint16(p+4,20,true);v.setUint16(p+6,0x800,true);v.setUint16(p+12,33,true);v.setUint32(p+14,e.crc,true);v.setUint32(p+18,e.bytes.length,true);v.setUint32(p+22,e.bytes.length,true);v.setUint16(p+26,e.name.length,true);out.set(e.name,p+30);out.set(e.bytes,p+30+e.name.length);p+=30+e.name.length+e.bytes.length;}
 for(const e of entries){v.setUint32(p,0x02014b50,true);v.setUint16(p+4,0x314,true);v.setUint16(p+6,20,true);v.setUint16(p+8,0x800,true);v.setUint16(p+14,33,true);v.setUint32(p+16,e.crc,true);v.setUint32(p+20,e.bytes.length,true);v.setUint32(p+24,e.bytes.length,true);v.setUint16(p+28,e.name.length,true);v.setUint32(p+38,e.directory?0x41ed0010:0x81a40000,true);v.setUint32(p+42,e.offset,true);out.set(e.name,p+46);p+=46+e.name.length;}
 v.setUint32(p,0x06054b50,true);v.setUint16(p+8,entries.length,true);v.setUint16(p+10,entries.length,true);v.setUint32(p+12,centralSize,true);v.setUint32(p+16,localSize,true);return out;
}
