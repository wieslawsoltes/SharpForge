import {frameworkType} from '@sharpforge/framework';
import {ManagedFault,isReference} from './heap.js';
const MAX=1_000_000;
const fail=(type,message)=>{throw new ManagedFault(type,message);};
const integer=(n,min=0,max=MAX)=>{if(!Number.isInteger(n)||n<min||n>max)fail('ArgumentOutOfRangeException','Value is outside the supported range');return n;};
export function bclScalar(p,value){
  if(isReference(value)){const r=p.heap.get(value);if(r.kind==='box')return bclScalar(p,r.data[0]);if(r.kind==='string')return r.data;}
  return p.native(value);
}
function typeOf(p,value){if(isReference(value)){const r=p.heap.get(value);return r.kind==='box'?r.type:r.kind==='string'?'string':r.type;}return typeof value==='boolean'?'bool':typeof value==='number'?'double':'object';}
function text(p,value,type){const n=bclScalar(p,value);if(n==null)return '';if(type==='bool'||type==='System.Boolean')return n?'True':'False';if(typeof n==='boolean')return n?'True':'False';if(typeof n==='number')return Number.isNaN(n)?'NaN':n===Infinity?'Infinity':n===-Infinity?'-Infinity':String(n);if(typeof n==='string')return n;return p.vm.format(value);}
function string(p,value,nullable=false){const n=bclScalar(p,value);if(n===null&&nullable)return null;if(typeof n!=='string')fail(n===null?'ArgumentNullException':'ArgumentException','A string is required');return n;}
function bounded(s){if(s.length>MAX)fail('OutOfMemoryException','BCL text limit exceeded');return s;}
// Exact binary64 -> fixed decimal rounding, midpoint-to-even (not JS toFixed's tie-away rule).
function fixedEven(value,digits){if(!Number.isFinite(value))return String(value);const negative=value<0||Object.is(value,-0),v=Math.abs(value),bytes=new DataView(new ArrayBuffer(8));bytes.setFloat64(0,v,false);const bits=bytes.getBigUint64(0,false),exponent=Number((bits>>52n)&2047n),fraction=bits&((1n<<52n)-1n);let numerator=(exponent?fraction+(1n<<52n):fraction)*10n**BigInt(digits),power=(exponent?exponent-1023:-1022)-52,denominator=1n;if(power>=0)numerator<<=BigInt(power);else denominator<<=BigInt(-power);let quotient=numerator/denominator;const remainder=numerator%denominator;if(remainder*2n>denominator||remainder*2n===denominator&&(quotient&1n))quotient++;let result=quotient.toString().padStart(digits+1,'0');if(digits)result=result.slice(0,-digits)+'.'+result.slice(-digits);return (negative?'-':'')+result;}
export function formatBclValue(p,value,format='',alignment=0,type=null){
  integer(alignment,-100000,100000);const v=bclScalar(p,value);let out=text(p,value,type??typeOf(p,value));
  if(v!==null&&typeof v==='number'&&format){const match=/^([dDxXfFnNeEgGpP])(\d{0,2})$/.exec(format);if(!match)fail('FormatException','Unsupported numeric format '+format);const code=match[1],precision=match[2]?Number(match[2]):null;if(precision!==null&&precision>99)fail('FormatException','Numeric precision limit');
    if(/[dDxX]/.test(code)){if(!Number.isInteger(v)||['double','System.Double'].includes(type??typeOf(p,value)))fail('FormatException','Integer format requires an integer type');const digits=/[xX]/.test(code)?(v<0?v>>>0:v).toString(16):String(Math.abs(v));out=digits.padStart(precision??1,'0');if(code==='X')out=out.toUpperCase();if(/[dD]/.test(code)&&v<0)out='-'+out;}
    if(/[fFnNpP]/.test(code)){const n=/[pP]/.test(code)?v*100:v;out=fixedEven(n,precision??2);if(/[nNpP]/.test(code)){const parts=out.split('.');parts[0]=parts[0].replace(/\B(?=(\d{3})+(?!\d))/g,',');out=parts.join('.');}if(/[pP]/.test(code))out+=' %';}
    if(/[eE]/.test(code)){out=v.toExponential(precision??6).replace(/e([+-])(\d+)$/,(_,sign,digits)=>(code==='E'?'E':'e')+sign+digits.padStart(3,'0'));}
    if(/[gG]/.test(code)&&precision)out=Number(v.toPrecision(precision)).toString();
  }
  if(alignment>0)out=out.padStart(alignment);else if(alignment<0)out=out.padEnd(-alignment);return bounded(out);
}
export function compositeFormat(p,format,args){
  let result='',i=0;while(i<format.length){const ch=format[i++];if(ch==='{'&&format[i]==='{'){result+='{';i++;continue;}if(ch==='}'&&format[i]==='}'){result+='}';i++;continue;}if(ch==='}')fail('FormatException','Unescaped closing format brace');if(ch!=='{'){result+=ch;continue;}
    const end=format.indexOf('}',i);if(end<0)fail('FormatException','Unclosed format item');const item=/^(\d+)(?:\s*,\s*(-?\d+))?(?::([^{}]*))?$/.exec(format.slice(i,end));if(!item||Number(item[1])>=args.length)fail('FormatException','Invalid format argument');result+=formatBclValue(p,args[Number(item[1])],item[3]??'',Number(item[2]??0));i=end+1;bounded(result);
  }return bounded(result);
}
function array(p,ref){const r=p.heap.get(ref);if(r.kind!=='array')fail('ArgumentException','Array required');return r.data;}
function makeArray(p,type,items){integer(items.length);return p.heap.allocate('array',type+'[]',[...items]);}
function equal(p,a,b){if(a===b)return true;const x=bclScalar(p,a),y=bclScalar(p,b);if(x===y||typeof x==='number'&&typeof y==='number'&&Number.isNaN(x)&&Number.isNaN(y))return true;return isReference(x)&&isReference(y)&&x.h===y.h&&x.g===y.g;}
function count(p,ref){return p.get(ref,'$count',0);}
function data(p,ref){const r=p.get(ref,'$data');return r?p.heap.get(r).data:[];}
function version(p,ref){return p.get(ref,'$version',0);}
function change(p,ref){p.set(ref,'$version',version(p,ref)+1);}
function reserve(p,ref,needed,slots=1){integer(needed);const old=data(p,ref),capacity=old.length/slots;if(needed<=capacity)return;const n=Math.min(MAX,Math.max(needed,capacity?capacity*2:4)),items=old.concat(Array(n*slots-old.length).fill(null));const r=makeArray(p,'object',items);p.heap.withRoots([r],()=>p.set(ref,'$data',r));}
function commitItems(p,ref,items,slots=1){const n=items.length/slots;integer(n);reserve(p,ref,n,slots);const old=data(p,ref),next=Array(old.length).fill(null);items.forEach((v,i)=>next[i]=v);p.heap.replaceData(p.get(ref,'$data'),next);p.set(ref,'$count',n);change(p,ref);}
function write(p,ref,index,value){const r=p.get(ref,'$data'),record=p.heap.get(r),oldValue=record.data[index];record.data[index]=value;p.vm.notifyWrite?.({kind:'array',handle:r.h,generation:r.g,index,oldValue,value});}
function queueItems(p,ref){const a=data(p,ref),head=p.get(ref,'$head',0),size=count(p,ref);return Array.from({length:size},(_,i)=>a[(head+i)%a.length]);}
function queueEnqueue(p,ref,value){const size=count(p,ref),a=data(p,ref);integer(size+1);if(size===a.length){const items=queueItems(p,ref);reserve(p,ref,size+1);const next=Array(data(p,ref).length).fill(null);items.forEach((v,i)=>next[i]=v);p.heap.replaceData(p.get(ref,'$data'),next);p.set(ref,'$head',0);}write(p,ref,(p.get(ref,'$head',0)+size)%data(p,ref).length,value);p.set(ref,'$count',size+1);change(p,ref);}
function append(p,ref,value){const n=count(p,ref);reserve(p,ref,n+1);write(p,ref,n,value);p.set(ref,'$count',n+1);change(p,ref);}
function keyOf(p,value){const v=bclScalar(p,value);if(v===null)return 'null';if(isReference(v))return 'r:'+v.h+':'+v.g;return typeof v+':'+String(v);}
function indexMap(p,ref,slots=1){const record=p.record(ref),v=version(p,ref);p.bclIndexes??=new WeakMap();let cache=p.bclIndexes.get(record);if(cache?.version!==v){const index=new Map(),items=data(p,ref);for(let i=0;i<count(p,ref);i++)index.set(keyOf(p,items[i*slots]),i);cache={version:v,index};p.bclIndexes.set(record,cache);}return cache.index;}
function bufferText(p,ref){return bounded(data(p,ref).slice(0,count(p,ref)).map(v=>string(p,v)).join(''));}
function setBuffer(p,ref,value){bounded(value);const r=p.heap.string(value);p.heap.withRoots([r],()=>commitItems(p,ref,value?[r]:[]));p.set(ref,'$length',value.length);p.set(ref,'$capacity',Math.max(value.length,p.get(ref,'$capacity',16)));}
function appendText(p,ref,value){bounded(value);const length=p.get(ref,'$length',0)+value.length;if(length>MAX)fail('OutOfMemoryException','StringBuilder text limit');if(value){const r=p.heap.string(value);p.heap.withRoots([r],()=>append(p,ref,r));}p.set(ref,'$length',length);p.set(ref,'$capacity',Math.max(length,p.get(ref,'$capacity',16)));return ref;}

/** All state is heap-owned and therefore GC-visible and included in debugger snapshots. */
export function invokeBcl(p,d,args){
  const t=frameworkType(d.owner),family=t?.family;if(t?.kind!=='bcl')return {handled:false};
  const result=value=>({handled:true,value}),ref=d.isStatic||d.kind==='constructor'?null:args[0],values=ref===null?args:args.slice(1),n=values.map(v=>bclScalar(p,v)),m=d.name;
  if(family==='format'&&m==='BoxValue'){if(!['int','double','bool'].includes(n[1]))fail('InvalidOperationException','Unknown primitive box');return result(p.heap.allocate('box',n[1],[p.managed(n[0],n[1])]));}
  if(family==='format')return result(p.heap.string(formatBclValue(p,values[0],n[1]??'',n[2],n[3])));
  if(family==='math'){
    if(d.kind==='get')return result(p.managed(t.properties[d.property].value,'double'));
    let v;if(m==='Clamp'){if(n[1]>n[2])fail('ArgumentException','Minimum exceeds maximum');v=Math.min(n[2],Math.max(n[1],n[0]));}else v=Math[m==='Truncate'?'trunc':m.toLowerCase()](...n);return result(p.managed(v,d.result));
  }
  if(family==='string'){
    const s=d.isStatic?null:(ref===null?fail('NullReferenceException','String receiver is null'):string(p,ref));let out;
    switch(m){
      case 'get_Empty':out='';break;case 'get_Length':out=s.length;break;case 'ToString':out=s;break;
      case 'IsNullOrEmpty':out=n[0]===null||n[0]==='';break;case 'IsNullOrWhiteSpace':out=n[0]===null||/^\s*$/.test(n[0]);break;
      case 'Concat':out=d.parameters[0].endsWith('[]')?array(p,values[0]).map(v=>text(p,v)).join(''):n.map(v=>v??'').join('');break;
      case 'Join':out=array(p,values[1]).map(v=>text(p,v,d.parameters[1].slice(0,-2))).join(n[0]??'');break;
      case 'Equals':out=n[0]===n[1];break;case 'CompareOrdinal':out=n[0]===n[1]?0:n[0]===null?-1:n[1]===null?1:n[0]<n[1]?-1:1;break;
      case 'Format':out=compositeFormat(p,string(p,values[0]),d.parameters.at(-1)==='object[]'?array(p,values[1]):values.slice(1));break;
      case 'Substring':{const i=integer(n[0],0,s.length),len=values.length===1?s.length-i:integer(n[1],0,s.length-i);out=s.slice(i,i+len);break;}
      case 'Contains':out=s.includes(string(p,values[0]));break;
      case 'StartsWith':out=s.startsWith(string(p,values[0]));break;case 'EndsWith':out=s.endsWith(string(p,values[0]));break;
      case 'IndexOf':out=s.indexOf(string(p,values[0]),values.length===2?integer(n[1],0,s.length):0);break;case 'LastIndexOf':out=s.lastIndexOf(string(p,values[0]));break;
      case 'Trim':out=s.trim();break;case 'TrimStart':out=s.trimStart();break;case 'TrimEnd':out=s.trimEnd();break;
      case 'ToUpper':case 'ToUpperInvariant':out=s.toUpperCase();break;case 'ToLower':case 'ToLowerInvariant':out=s.toLowerCase();break;
      case 'Replace':{const old=string(p,values[0]);if(!old)fail('ArgumentException','Old value cannot be empty');out=s.split(old).join(n[1]??'');break;}
      case 'Split':{const separator=string(p,values[0],true),limit=n.length===2?integer(n[1]):MAX;let parts;if(!limit)parts=[];else if(limit===1)parts=[s];else if(separator==='')parts=[s];else{parts=separator===null?s.split(/\s/):s.split(separator);if(parts.length>limit&&separator!==null)parts=[...parts.slice(0,limit-1),parts.slice(limit-1).join(separator)];else if(parts.length>limit)fail('NotSupportedException','Whitespace Split with a bounded count is not supported');}const refs=[];return result(p.heap.withRoots(refs,()=>{for(const value of parts){const r=p.heap.string(value);refs.push(r);p.heap.pins.push(r);}return makeArray(p,'string',refs);}));}
      case 'PadLeft':case 'PadRight':out=m==='PadLeft'?s.padStart(integer(n[0])):s.padEnd(integer(n[0]));break;
      case 'Remove':{const i=integer(n[0],0,s.length),len=n.length===1?s.length-i:integer(n[1],0,s.length-i);out=s.slice(0,i)+s.slice(i+len);break;}
      case 'Insert':{const i=integer(n[0],0,s.length);out=s.slice(0,i)+string(p,values[1])+s.slice(i);break;}
      default:fail('MissingMethodException',m);
    }return result(p.managed(typeof out==='string'?bounded(out):out,d.result));
  }
  if(d.kind==='constructor'){
    if(n.length===1&&typeof n[0]==='number')integer(n[0]);if(family==='builder'&&n.length===2)integer(n[1]);
    const r=p.make(d.owner,{'$count':0,'$version':0});p.heap.pins.push(r);
    if(family==='builder'){p.set(r,'$capacity',n.length===1&&typeof n[0]==='number'?n[0]:n[1]??16);p.set(r,'$length',0);if(typeof n[0]==='string')appendText(p,r,n[0]);}
    else if(d.parameters[0]?.endsWith('[]')){const a=array(p,values[0]);commitItems(p,r,family==='HashSet'?a.filter((x,i)=>a.findIndex(y=>equal(p,x,y))===i):a);}
    else if(n[0])reserve(p,r,n[0],family==='Dictionary'?2:1);
    return result(r);
  }
  p.record(ref);
  if(family==='builder'){
    switch(m){
      case 'get_Length':return result(p.get(ref,'$length',0));case 'get_Capacity':return result(p.get(ref,'$capacity',16));case 'get_MaxCapacity':return result(MAX);
      case 'set_Capacity':integer(n[0],p.get(ref,'$length',0));p.set(ref,'$capacity',n[0]);return result(null);
      case 'set_Length':{const len=integer(n[0]),s=bufferText(p,ref);setBuffer(p,ref,len>s.length?s+'\0'.repeat(len-s.length):s.slice(0,len));return result(null);}
      case 'Append':return result(appendText(p,ref,text(p,values[0],d.parameters[0])));
      case 'AppendLine':return result(appendText(p,ref,(values.length?text(p,values[0]):'')+'\n'));
      case 'AppendFormat':return result(appendText(p,ref,compositeFormat(p,string(p,values[0]),values.slice(1))));
      case 'Clear':setBuffer(p,ref,'');return result(ref);
      case 'EnsureCapacity':integer(n[0]);p.set(ref,'$capacity',Math.max(n[0],p.get(ref,'$capacity',16)));return result(p.get(ref,'$capacity'));
      case 'ToString':{const s=bufferText(p,ref),i=values.length?integer(n[0],0,s.length):0,len=values.length?integer(n[1],0,s.length-i):s.length;return result(p.heap.string(s.slice(i,i+len)));}
      case 'Insert':{const s=bufferText(p,ref),i=integer(n[0],0,s.length);setBuffer(p,ref,s.slice(0,i)+(n[1]??'')+s.slice(i));return result(ref);}
      case 'Remove':{const s=bufferText(p,ref),i=integer(n[0],0,s.length),len=integer(n[1],0,s.length-i);setBuffer(p,ref,s.slice(0,i)+s.slice(i+len));return result(ref);}
      case 'Replace':{const old=string(p,values[0]);if(!old)fail('ArgumentException','Old value cannot be empty');setBuffer(p,ref,bufferText(p,ref).split(old).join(n[1]??''));return result(ref);}
      default:fail('MissingMethodException',m);
    }
  }
  if(family==='enumerator'){
    if(m==='Dispose'){p.set(ref,'$owner',null);return result(null);}
    const owner=p.get(ref,'$owner');if(!owner)fail('ObjectDisposedException','Enumerator is disposed');if(version(p,owner)!==p.get(ref,'$version'))fail('InvalidOperationException','Collection was modified during enumeration');
    if(m==='MoveNext'){const i=p.get(ref,'$index',-1)+1;p.set(ref,'$index',i);return result(p.managed(i<count(p,owner),'bool'));}
    if(m==='get_Current'){const i=p.get(ref,'$index',-1);if(i<0||i>=count(p,owner))fail('InvalidOperationException','Enumerator is not positioned on an item');const type=frameworkType(p.record(owner).type),index=type.family==='Stack'?count(p,owner)-1-i:type.family==='Queue'?(p.get(owner,'$head',0)+i)%data(p,owner).length:i;return result(data(p,owner)[index]);}
  }
  const size=count(p,ref),slots=family==='Dictionary'?2:1;
  if(m==='get_Count')return result(size);
  if(m==='get_Capacity')return result(data(p,ref).length);
  if(m==='set_Capacity'){integer(n[0],size);const next=data(p,ref).slice(0,n[0]);while(next.length<n[0])next.push(null);const r=makeArray(p,'object',next);p.heap.withRoots([r],()=>p.set(ref,'$data',r));return result(null);}
  if(m==='Clear'){if(size)commitItems(p,ref,[],slots);if(family==='Queue')p.set(ref,'$head',0);return result(null);}
  if(m==='GetEnumerator')return result(p.make(d.result,{'$owner':ref,'$index':-1,'$version':version(p,ref)}));
  if(m==='ToArray')return result(makeArray(p,t.element,family==='Queue'?queueItems(p,ref):family==='Stack'?data(p,ref).slice(0,size).reverse():data(p,ref).slice(0,size)));
  if(family==='Dictionary'){
    if(m==='get_Keys'||m==='get_Values')return result(makeArray(p,m==='get_Keys'?t.key:t.element,Array.from({length:size},(_,i)=>data(p,ref)[i*2+(m==='get_Keys'?0:1)])));
    if(m==='ContainsValue')return result(p.managed(Array.from({length:size},(_,i)=>data(p,ref)[i*2+1]).some(v=>equal(p,v,values[0])),'bool'));
    if(values[0]===null)fail('ArgumentNullException','Dictionary key cannot be null');const map=indexMap(p,ref,2),key=keyOf(p,values[0]),index=map.get(key);
    if(m==='ContainsKey')return result(p.managed(index!==undefined,'bool'));
    if(m==='get_Item'){if(index===undefined)fail('KeyNotFoundException','The given key was not present');return result(data(p,ref)[index*2+1]);}
    if(m==='Remove'){if(index===undefined)return result(p.managed(false,'bool'));const a=data(p,ref).slice(0,size*2);a.splice(index*2,2);commitItems(p,ref,a,2);return result(p.managed(true,'bool'));}
    if(m==='Add'||m==='TryAdd'||m==='set_Item'){if(index!==undefined){if(m==='Add')fail('ArgumentException','An item with the same key already exists');if(m==='TryAdd')return result(p.managed(false,'bool'));write(p,ref,index*2+1,values[1]);change(p,ref);}else{reserve(p,ref,size+1,2);write(p,ref,size*2,values[0]);write(p,ref,size*2+1,values[1]);p.set(ref,'$count',size+1);change(p,ref);map.set(key,size);}p.bclIndexes.set(p.record(ref),{version:version(p,ref),index:map});return result(m==='TryAdd'?p.managed(true,'bool'):null);}
  }
  if(m==='Contains'||m==='IndexOf'){const at=family==='HashSet'?indexMap(p,ref).get(keyOf(p,values[0]))??-1:(family==='Queue'?queueItems(p,ref):data(p,ref).slice(0,size)).findIndex(v=>equal(p,v,values[0]));return result(m==='Contains'?p.managed(at>=0,'bool'):at);}
  if(m==='get_Item'){return result(data(p,ref)[integer(n[0],0,size-1)]);}
  if(m==='set_Item'){const i=integer(n[0],0,size-1);write(p,ref,i,values[1]);change(p,ref);return result(null);}
  if(m==='Add'||m==='Enqueue'||m==='Push'){if(family==='Queue'){queueEnqueue(p,ref,values[0]);return result(null);}const map=family==='HashSet'?indexMap(p,ref):null,key=map?keyOf(p,values[0]):null;if(map?.has(key))return result(p.managed(false,'bool'));append(p,ref,values[0]);if(map){map.set(key,size);p.bclIndexes.set(p.record(ref),{version:version(p,ref),index:map});}return result(family==='HashSet'?p.managed(true,'bool'):null);}
  if(m==='Peek'||m==='Dequeue'||m==='Pop'){if(!size)fail('InvalidOperationException','Collection is empty');const i=family==='Stack'?size-1:p.get(ref,'$head',0),value=data(p,ref)[i];if(m!=='Peek'){p.heap.withRoots([value],()=>{write(p,ref,i,null);p.set(ref,'$count',size-1);if(family==='Queue')p.set(ref,'$head',size===1?0:(i+1)%data(p,ref).length);change(p,ref);});}return result(value);}
  const a=data(p,ref).slice(0,size);
  switch(m){
    case 'AddRange':{const extra=array(p,values[0]);integer(a.length+extra.length);for(const v of extra)a.push(v);break;}
    case 'Insert':a.splice(integer(n[0],0,size),0,values[1]);break;
    case 'RemoveAt':a.splice(integer(n[0],0,size-1),1);break;
    case 'RemoveRange':a.splice(integer(n[0],0,size),integer(n[1],0,size-n[0]));break;
    case 'Remove':{const i=a.findIndex(v=>equal(p,v,values[0]));if(i<0)return result(p.managed(false,'bool'));a.splice(i,1);commitItems(p,ref,a);return result(p.managed(true,'bool'));}
    case 'Reverse':a.reverse();break;
    case 'Sort':a.sort((x,y)=>{const u=bclScalar(p,x),v=bclScalar(p,y);if(u===v)return 0;if(u===null)return -1;if(v===null)return 1;if(typeof u==='number'&&typeof v==='number')return Number.isNaN(u)?-1:Number.isNaN(v)?1:u-v;if(typeof u==='string'&&typeof v==='string'||typeof u==='boolean'&&typeof v==='boolean')return u<v?-1:1;fail('InvalidOperationException','Default comparer is unavailable for this object type');});break;
    case 'UnionWith':case 'IntersectWith':case 'ExceptWith':{const other=new Set(array(p,values[0]).map(v=>keyOf(p,v))),seen=new Set(a.map(v=>keyOf(p,v)));if(m==='UnionWith'){for(const v of array(p,values[0]))if(!seen.has(keyOf(p,v))){seen.add(keyOf(p,v));a.push(v);}}else for(let i=a.length-1;i>=0;i--)if(other.has(keyOf(p,a[i]))===(m==='ExceptWith'))a.splice(i,1);break;}
    default:fail('MissingMethodException',`${d.owner}.${m}`);
  }
  commitItems(p,ref,a);return result(null);
}
