import {createSimdEngine,ComputePool} from '@sharpforge/compute';
import {frameworkType,taskResult} from '@sharpforge/framework';
import {ManagedFault} from './heap.js';
import {numericArrayResult,copyVectorArray,numericArrayData as array,numericArrayRange as range} from './execution/numeric-array-storage.js';
export function invokeNumeric(p,d,args){
  const type=frameworkType(d.owner);if(type?.kind!=='numeric')return {handled:false};const result=value=>({handled:true,value}),ref=d.isStatic||d.kind==='constructor'?null:args[0],values=ref===null?args:args.slice(1);
  p.numeric??=createSimdEngine(p.options.compute??{});
  if(type.family==='parallel'){
    const a=new Float64Array(array(p,values[0]).map(v=>p.native(v))),b=values.length>1?new Float64Array(array(p,values[1]).map(v=>p.native(v))):null;
    p.computePool??=new ComputePool(p.options.compute??{});const target=taskResult(d.result);
    return result(p.hostOperations.start(target,signal=>p.computePool.execute(d.operation,a,b,{signal}),v=>numericArrayResult(p,v),values,'compute'));
  }
  const vector=(name,data)=>{const info=frameworkType(name),values={};for(let i=0;i<info.lanes;i++)values['$'+i]=p.managed(data[i],info.element);return p.make(name,values);};
  const read=ref=>{const info=frameworkType(p.record(ref).type),C=info.element==='int'?Int32Array:Float64Array;return C.from({length:info.lanes},(_,i)=>p.native(p.get(ref,'$'+i)));};
  if(type.family==='vectorStatic'){
    if(d.kind==='get')return result(p.managed(p.numeric.isHardwareAccelerated,'bool'));const a=read(values[0]),b=values.length>1?read(values[1]):null;if(['EqualsAll','EqualsAny'].includes(d.operation))return result(p.managed(a[d.operation==='EqualsAll'?'every':'some']((x,i)=>x===b[i]),'bool'));const out=p.numeric.execute(d.operation,a,b);return result(typeof out==='number'?p.managed(out,d.result):vector(d.result,out));
  }
  if(d.kind==='constructor'){let data;if(d.parameters[0].endsWith('[]')){const a=array(p,values[0]),start=values.length===2?range(p.native(values[1]),0,a.length-type.lanes):0;if(a.length-start<type.lanes)throw new ManagedFault('ArgumentException','Insufficient vector lanes');data=a.slice(start,start+type.lanes).map(v=>p.native(v));}else data=Array(type.lanes).fill(p.native(values[0]));return result(vector(d.owner,data));}
  if(d.isStatic){if(d.property==='Count')return result(type.lanes);return result(vector(d.owner,Array(type.lanes).fill(d.property==='One'?1:0)));}
  if(d.name==='get_Item')return result(p.get(ref,'$'+range(p.native(values[0]),0,type.lanes-1)));
  if(d.name==='CopyTo')return result(copyVectorArray(p,ref,values[0],values.length===2?p.native(values[1]):0,type.lanes));
  if(d.name==='Equals'){const a=read(ref),b=read(values[0]);return result(p.managed(a.every((x,i)=>x===b[i]||Number.isNaN(x)&&Number.isNaN(b[i])),'bool'));}
  throw new ManagedFault('MissingMethodException',d.owner+'.'+d.name);
}
