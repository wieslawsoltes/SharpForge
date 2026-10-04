import {createSimdEngine} from '@sharpforge/compute';
import {frameworkType} from '@sharpforge/framework';
import {ManagedFault} from './heap.js';
import {invokeParallelNumeric} from './numeric-parallel.js';
function array(p,ref){const r=p.heap.get(ref);if(r.kind!=='array')throw new ManagedFault('ArgumentException','An array is required');return r.data;}
function range(n,min,max){if(!Number.isInteger(n)||n<min||n>max)throw new ManagedFault('ArgumentOutOfRangeException','Index is outside the available range');return n;}
export function invokeNumeric(p,d,args){
  const type=frameworkType(d.owner);if(type?.kind!=='numeric')return {handled:false};const result=value=>({handled:true,value}),ref=d.isStatic||d.kind==='constructor'?null:args[0],values=ref===null?args:args.slice(1);
  p.numeric??=createSimdEngine(p.options.compute??{});
  if(type.family==='parallel'){
    return result(invokeParallelNumeric(p,d,values,array));
  }
  const vector=(name,data)=>{const info=frameworkType(name),values={};for(let i=0;i<info.lanes;i++)values['$'+i]=p.managed(data[i],info.element);return p.make(name,values);};
  const read=ref=>{const info=frameworkType(p.record(ref).type),C=info.element==='int'?Int32Array:Float64Array;return C.from({length:info.lanes},(_,i)=>p.native(p.get(ref,'$'+i)));};
  if(type.family==='vectorStatic'){
    if(d.kind==='get')return result(p.managed(p.numeric.isHardwareAccelerated,'bool'));const a=read(values[0]),b=values.length>1?read(values[1]):null;if(['EqualsAll','EqualsAny'].includes(d.operation))return result(p.managed(a[d.operation==='EqualsAll'?'every':'some']((x,i)=>x===b[i]),'bool'));const out=p.numeric.execute(d.operation,a,b);return result(typeof out==='number'?p.managed(out,d.result):vector(d.result,out));
  }
  if(d.kind==='constructor'){let data;if(d.parameters[0].endsWith('[]')){const a=array(p,values[0]),start=values.length===2?range(p.native(values[1]),0,a.length-type.lanes):0;if(a.length-start<type.lanes)throw new ManagedFault('ArgumentException','Insufficient vector lanes');data=a.slice(start,start+type.lanes).map(v=>p.native(v));}else data=Array(type.lanes).fill(p.native(values[0]));return result(vector(d.owner,data));}
  if(d.isStatic){if(d.property==='Count')return result(type.lanes);return result(vector(d.owner,Array(type.lanes).fill(d.property==='One'?1:0)));}
  if(d.name==='get_Item')return result(p.get(ref,'$'+range(p.native(values[0]),0,type.lanes-1)));
  if(d.name==='CopyTo'){const a=array(p,values[0]),offset=values.length===2?p.native(values[1]):0;range(offset,0,a.length-type.lanes);const handle=values[0];for(let i=0;i<type.lanes;i++){const oldValue=a[offset+i],value=p.get(ref,'$'+i);p.heap.writeElement(handle,offset+i,value);p.vm.notifyWrite({kind:'array',handle:handle.h,generation:handle.g,index:offset+i,value,oldValue});}return result(null);}
  if(d.name==='Equals'){const a=read(ref),b=read(values[0]);return result(p.managed(a.every((x,i)=>x===b[i]||Number.isNaN(x)&&Number.isNaN(b[i])),'bool'));}
  throw new ManagedFault('MissingMethodException',d.owner+'.'+d.name);
}
