import {propertiesFor,XAML,CONTROLS,frameworkAssignable} from '@sharpforge/framework';
import {childSlot,propertySchema,track,designControls} from '@sharpforge/designer';
import {clearProperty} from './styling.js';
import {assignDesignValue as assign,designManagedValue as valueFromData} from './design-values.js';
import {applyDesignCollection} from './design-collections.js';
import {setDesignChildren as setChildren} from './design-children.js';
const extendedDesignCommands = new Map([['collection', applyDesignCollection]]);
const key=r=>`${r.h}:${r.g}`;
const fail=m=>{throw new Error(m);};
function collection(p,ref,property){return p.getProperty(ref,{property,result:propertiesFor(p.record(ref).type)[property].type,owner:p.record(ref).type});}
function templateFromData(p,data){const template=p.construct(CONTROLS+'ControlTemplate',[]);p.heap.pins.push(template);const ids=new Set();let count=0;function part(data,depth=0){if(++count>500||depth>50||ids.has(data.id))fail('Template is cyclic or oversized');ids.add(data.id);if(!designControls.some(c=>c.type===data.type))fail('Invalid template control');const node=p.construct(data.type,[]);p.heap.pins.push(node);for(const [name,value]of Object.entries(data.properties??{}))assign(p,node,name,value);for(const [target,source]of Object.entries(data.bindings??{})){const to=propertiesFor(data.type)[target];if(!to||to.readOnly||typeof source!=='string')fail('Invalid template binding');}
    if(data.bindings){const json=p.heap.string(JSON.stringify(data.bindings));p.heap.pins.push(json);p.set(node,'$bindings',json);}if(data.children?.length)setChildren(p,node,data.children.map(n=>part(n,depth+1)));return node;}
  const root=part(data.root);p.set(template,'VisualTree',root);return template;}
/** Apply an explicit design delta to real managed objects; no application method is evaluated. */
export function applyDesignPatch(session,patch,{expectedRevision=session.designRevision??0}={}){
  const vm=session.vm,p=vm.platform;if(!['paused','waiting','terminated'].includes(vm.state))fail('Pause or wait for the UI event loop before applying a design');if(expectedRevision!==(session.designRevision??0))fail('Design revision changed; reattach the visual tree');if(patch?.version!==1||!Array.isArray(patch.commands)||patch.commands.length>5000||!patch.bindings||typeof patch.bindings!=='object')fail('Invalid design patch');
  const visible=new Map(p.scene().nodes.map(n=>[n.id,n])),refs=new Map(),identities=new Set();for(const [id,runtimeId]of Object.entries(patch.bindings)){if(typeof id!=='string'||typeof runtimeId!=='string'||!visible.has(runtimeId))fail('Design references an object outside the active visual tree');if(identities.has(runtimeId))fail('Duplicate aliases for the same live control');identities.add(runtimeId);const [h,g]=runtimeId.split(':').map(Number);refs.set(id,{h,g});}
  const snapshot=vm.snapshot(),oldState=vm.state,transaction=p.beginTransaction(),notify=vm.notifyWrite;
  try{return vm.heap.withRoots([...refs.values()],()=>{
    // Designer writes are atomic and do not produce midway debugger write stops.
    vm.notifyWrite=()=>{};
    for(const c of patch.commands)if(c.op==='create'){if(refs.has(c.id)||!/^[A-Za-z_][\w.:-]{0,127}$/.test(c.id)||!designControls.some(t=>t.type===c.type)||c.type===XAML+'Window')fail('Invalid live control creation');const ref=p.construct(c.type,[]);refs.set(c.id,ref);vm.heap.pins.push(ref);}
    const resolve=id=>refs.get(id)??fail('Unknown design object '+id);
    // Detach all moving children before reparenting, so a batch is order-independent.
    for(const c of patch.commands)if(c.op==='children'){const ref=resolve(c.id),slot=childSlot(p.record(ref).type);if(!Array.isArray(c.children))fail('Invalid child list');if(slot)setChildren(p,ref,[]);}
    for(const c of patch.commands){const ref=resolve(c.id);switch(c.op){
      case 'create':break;
      case 'set':assign(p,ref,c.property,c.value);break;
      case 'clear':if(propertySchema(p.record(ref).type)[c.property]?.attached)p.set(ref,'$'+c.property,c.property.endsWith('Span')?1:0);else clearProperty(p,ref,c.property);break;
      case 'children':setChildren(p,ref,c.children.map(resolve));break;
      case 'tracks':{if(p.record(ref).type!==CONTROLS+'Grid'||!['rows','columns'].includes(c.axis)||!Array.isArray(c.tracks)||c.tracks.length>64)fail('Invalid Grid tracks');const row=c.axis==='rows',property=row?'RowDefinitions':'ColumnDefinitions',member=row?'Height':'Width',list=collection(p,ref,property),tracks=[];for(const item of c.tracks){const t=p.construct(CONTROLS+(row?'RowDefinition':'ColumnDefinition'),[]);vm.heap.pins.push(t);const value=valueFromData(p,track(item),XAML+'GridLength');vm.heap.pins.push(value);p.set(t,member,value);tracks.push(t);}p.replaceItems(list,tracks);break;}
      case 'template':{if(!propertiesFor(p.record(ref).type).Template){if(c.template)fail('This control cannot have a template');break;}if(c.template&&!frameworkAssignable(c.template.targetType,p.record(ref).type))fail('Template target mismatch');if(c.template){const validate=(part,seen=new Set())=>{if(seen.has(part))fail('Template cycle');seen.add(part);for(const [key,source]of Object.entries(part.bindings??{})){const a=propertiesFor(part.type)[key],b=propertiesFor(p.record(ref).type)[source];if(!a||a.readOnly||!b||!(a.type===b.type||a.type==='object'))fail('Incompatible template binding');}(part.children??[]).forEach(n=>validate(n,seen));};validate(c.template.root);}const t=c.template?templateFromData(p,c.template):null;p.setProperty(ref,{owner:p.record(ref).type,property:'Template'},t);break;}
      case 'remove':{if(p.windows.has(key(ref)))fail('Cannot remove the live window');p.set(ref,'$parent',null);refs.delete(c.id);break;}
      default:{const handler=extendedDesignCommands.get(c.op);if(!handler)fail('Unknown design command '+c.op);handler(p,ref,c);}
    }}
    const scene=p.scene();session.designRevision=(session.designRevision??0)+1;session.history=[];session.historyBytes=0;vm.writeRevision++;p.command({op:'reset',snapshot:scene});p.commitTransaction(transaction);return {revision:session.designRevision,scene,bindings:Object.fromEntries([...refs].map(([id,ref])=>[id,key(ref)])),commands:patch.commands.length};
  });}catch(error){vm.restore(snapshot);vm.state=oldState;p.rollbackTransaction(transaction);throw error;}finally{vm.notifyWrite=notify;}
}
