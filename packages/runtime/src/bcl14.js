import {frameworkType} from '@sharpforge/framework';
import {ManagedFault,isReference} from './heap.js';
const fail=(t,m)=>{throw new ManagedFault(t,m);};
const bounds=(value,min,max)=>{if(!Number.isInteger(value)||value<min||value>max)fail('ArgumentOutOfRangeException','Array range is invalid');return value;};
export function invokeBcl14(p,d,args){
 const t=frameworkType(d.owner);if(t?.kind!=='bcl14')return {handled:false};const result=value=>({handled:true,value}),n=args.map(v=>p.native(v));
 if(t.family==='array'){
  if(!args[0])fail('ArgumentNullException','Source array is required');const src=p.heap.get(args[0]);if(src.kind!=='array')fail('ArgumentException','Source must be an array');
  const write=(ref,record,i,value)=>{const oldValue=record.data[i];record.data[i]=value;p.vm.notifyWrite({kind:'array',handle:ref.h,generation:ref.g,index:i,value,oldValue});};
  if(d.name==='Copy'){const full=args.length===5,si=full?n[1]:0,di=full?n[3]:0,count=full?n[4]:n[2],destRef=args[full?2:1];if(!destRef)fail('ArgumentNullException','Destination array is required');const dest=p.heap.get(destRef);if(dest.kind!=='array'||dest.type!==src.type)fail('ArrayTypeMismatchException','Array element types must agree');bounds(si,0,src.data.length);bounds(di,0,dest.data.length);bounds(count,0,Math.min(src.data.length-si,dest.data.length-di));const values=src.data.slice(si,si+count);for(let i=0;i<count;i++)write(destRef,dest,di+i,values[i]);return result(null);}
  if(d.name==='Fill'||d.name==='Clear'){const fill=d.name==='Fill',start=fill?(args.length===4?n[2]:0):n[1],count=fill?(args.length===4?n[3]:src.data.length):n[2];bounds(start,0,src.data.length);bounds(count,0,src.data.length-start);const element=src.type.slice(0,-2),value=fill?args[1]:['int','double'].includes(element)?p.managed(0,element):element==='bool'?p.managed(false,'bool'):null;for(let i=start;i<start+count;i++)write(args[0],src,i,value);return result(null);}
  const equal=(a,b)=>{const x=p.native(a),y=p.native(b);return x===y||typeof x==='number'&&typeof y==='number'&&Number.isNaN(x)&&Number.isNaN(y)||isReference(x)&&isReference(y)&&x.h===y.h&&x.g===y.g;};
  if(d.name==='IndexOf')return result(src.data.findIndex(v=>equal(v,args[1])));if(d.name==='LastIndexOf'){for(let i=src.data.length-1;i>=0;i--)if(equal(src.data[i],args[1]))return result(i);return result(-1);}
  if(d.name==='BinarySearch'){if(n[1]!==null&&typeof n[1]==='object'||src.data.some(v=>{const x=p.native(v);return x!==null&&typeof x==='object';}))fail('InvalidOperationException','Binary search requires registered comparable primitive elements');let lo=0,hi=src.data.length-1;const value=n[1];while(lo<=hi){const mid=(lo+hi)>>>1,x=p.native(src.data[mid]);if(equal(src.data[mid],args[1]))return result(mid);const less=x===null||typeof x==='number'&&Number.isNaN(x)?true:value===null||typeof value==='number'&&Number.isNaN(value)?false:x<value;if(less)lo=mid+1;else hi=mid-1;}return result(~lo);}
 }
 if(t.family==='random'){
  function create(seed){let subtraction=seed===-2147483648?2147483647:Math.abs(seed),mj=161803398-subtraction,mk=1,a=Array(56).fill(0);a[55]=mj;for(let i=1;i<55;i++){const ii=(21*i)%55;a[ii]=mk;mk=mj-mk;if(mk<0)mk+=2147483647;mj=a[ii];}for(let k=1;k<5;k++)for(let i=1;i<56;i++){a[i]-=a[1+(i+30)%55];if(a[i]<0)a[i]+=2147483647;}const data=p.heap.allocate('array','int[]',a);return p.heap.withRoots([data],()=>p.make(d.owner,{'$data':data,'$i':0,'$j':21}));}
  if(d.kind==='constructor')return result(create(args.length?n[0]:Date.now()|0));
  if(d.isStatic)return result(p.singleton('Random.Shared',()=>create(Date.now()|0)));
  const ref=args[0],r=p.heap.get(p.get(ref,'$data'));
  function sample(){let i=p.get(ref,'$i')+1,j=p.get(ref,'$j')+1;if(i>=56)i=1;if(j>=56)j=1;let value=r.data[i]-r.data[j];if(value===2147483647)value--;if(value<0)value+=2147483647;r.data[i]=value;p.set(ref,'$i',i);p.set(ref,'$j',j);return value;}
  if(d.name==='NextDouble')return result(p.managed(sample()/2147483647,'double'));
  if(args.length===1)return result(sample());const min=args.length===2?0:n[1],max=args.length===2?n[1]:n[2];if(min>max||max<0&&args.length===2)fail('ArgumentOutOfRangeException','Invalid random range');const span=max-min;let value;if(span<=2147483647)value=sample()/2147483647;else{let r=sample();if(sample()%2===0)r=-r;value=(r+2147483646)/4294967293;}return result(Math.floor(value*span)+min);
 }
 throw new ManagedFault('MissingMethodException',d.owner+'.'+d.name);
}
