import {registerRuntimeNumerics} from './contributions/runtime-numerics.js';
import {createRegistry,ABI_VERSION} from './registry.js';
import {contributionManifest,idReservations} from './contributions/manifest.js';
export {ABI_VERSION,XAML,CONTROLS,MEDIA,TASK,THREAD,createRegistry} from './registry.js';
export {colorValues} from './contributions/core-xaml.js';
export {contributionManifest,areaReservations,idReservations} from './contributions/manifest.js';
const registry=createRegistry({reservations:idReservations});
registry.registerAll(contributionManifest);
registry.register({name:'A05',register:registerRuntimeNumerics});
export const types=registry.types;
export const contracts=registry.contracts;
export const canonicalType=registry.canonicalType;
export const frameworkType=registry.frameworkType;
export const frameworkAssignable=registry.frameworkAssignable;
export const taskResult=registry.taskResult;
const memberIndex=registry.memberIndex;
export function findContracts(owner, name, isStatic) {
  owner=canonicalType(owner);const result=[],seen=new Set();
  while(owner&&!seen.has(owner)){seen.add(owner);result.push(...(memberIndex.get(owner+'::'+name)??[]).filter(d=>isStatic===undefined||d.isStatic===isStatic));owner=types.get(owner)?.base;}
  return result;
}
export function contractForMember(d) {
  if(!d?.signature)return null;const owner=canonicalType(d.owner);
  return findContracts(owner,d.name,d.signature.isStatic).find(c=>c.parameters.length===d.signature.parameters.length&&c.parameters.every((t,i)=>t===canonicalType(d.signature.parameters[i]))&&(c.kind==='constructor'?'void':c.result)===canonicalType(d.signature.returnType))??null;
}
export function propertiesFor(type) {
  const list=[];const seen=new Set();while(types.has(type)&&!seen.has(type)){seen.add(type);list.unshift(types.get(type));type=types.get(type).base;}
  return Object.assign({},...list.map(t=>t.properties));
}
export function eventsFor(type){const result={};const seen=new Set();while(types.has(type)&&!seen.has(type)){seen.add(type);Object.assign(result,types.get(type).events);type=types.get(type).base;}return result;}
export function enumValue(path) {
  const dot=path?.lastIndexOf('.')??-1;if(dot<0)return null;const t=frameworkType(path.slice(0,dot)),name=path.slice(dot+1);
  return t?.kind==='enum'&&Object.hasOwn(t.values,name)?{type:t.name,value:t.values[name]}:null;
}
export const enumTypes=Object.freeze([...types.values()].filter(t=>t.kind==='enum').map(t=>t.name));
export const frameworkManifest=Object.freeze({version:ABI_VERSION,types:[...types.values()].map(t=>({...t})),members:contracts});

export {AnimationClock,prepareTimeline,timelinePosition,easing} from './animation-clock.js';
