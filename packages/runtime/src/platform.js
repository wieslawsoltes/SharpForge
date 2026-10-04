import {initializeBclHost,invokeBclPlatform} from './bcl-adapter.js';
import {boundDelegatesEqual,constructBoundDelegate} from './execution/delegate-targets.js';
import {HostOperations} from './host-operations.js';
import {invokeAnimation,createManagedAnimationClock,advanceManagedAnimations} from './animation.js';
import {refreshStyle,refreshStyles,applyTemplate,updateBindings,invokeStyling} from './styling.js';
import {canonicalType,frameworkType,propertiesFor,eventsFor,frameworkAssignable,colorValues,XAML,CONTROLS,MEDIA,TASK,THREAD,taskResult} from '@sharpforge/framework';
import {ManagedFault,isReference} from './heap.js';
export const SUSPENDED = Object.freeze({sharpforgeSuspended:true});
const identity=r=>`${r.h}:${r.g}`;
const equal=(a,b)=>a===b||isReference(a)&&isReference(b)&&a.h===b.h&&a.g===b.g;
/** A data-only boundary between managed execution and the browser. No DOM or host eval. */
export class ManagedPlatform {
  constructor(vm,options={}){this.vm=vm;this.heap=vm.heap;initializeBclHost(this);this.options=options;this.windows=new Map();this.application=null;this.singletons=new Map();this.styleDepth=0;this.sequence=0;this.pending=[];this.transaction=null;this.maxCommands=options.maxUICommands??10000;this.animations=createManagedAnimationClock(this);this.hostOperations=new HostOperations(this);}
  *roots(){yield* this.hostOperations.roots();yield* this.animations.roots();yield this.application;yield* this.singletons.values();yield* this.windows.values();for(const p of this.pending)yield p;}
  record(ref){const r=this.heap.get(ref);if(!['host','delegate','collection','task','thread'].includes(r.kind))throw new ManagedFault('InvalidCastException','A managed framework object is required');return r;}
  propertyIndex(record){
    this.propertyIndexes??=new WeakMap();let cached=this.propertyIndexes.get(record);
    if(!cached||cached.data!==record.data||cached.length!==record.data.length){const index=new Map();for(let i=0;i<record.data.length;i+=2)index.set(record.data[i],i);cached={data:record.data,length:record.data.length,index};this.propertyIndexes.set(record,cached);}return cached.index;
  }
  get(ref,key,fallback=null){const r=this.record(ref),at=this.propertyIndex(r).get(key);return at===undefined?fallback:r.data[at+1];}
  set(ref,key,value){
    if(!this.animations.applying&&this.animations.bases.size&&this.animations.bases.has(this.animations.key(ref,key))){this.animations.setBase(ref,key,this.native(value));return value;}
    const r=this.record(ref),at=this.propertyIndex(r).get(key),index=at===undefined?r.data.length:at,old=at===undefined?null:r.data[index+1];
    // Existing slots have fixed size; mutate once, retaining GC/write-barrier bookkeeping.
    // Snapshots own copies, and restore replaces records, invalidating the WeakMap naturally.
    if(at===undefined)this.heap.replaceData(ref,[...r.data,key,value]);else{r.data[index+1]=value;this.heap.mutationRevision++;}
    this.vm.notifyWrite?.({kind:'field',handle:ref.h,generation:ref.g,index:index+1,value,oldValue:old,property:key});return value;
  }
  native(v){if(v?.byref)return this.native(this.vm.dereference(v));return this.vm.value(v);}
  managed(v,type){if(v===null||v===undefined)return null;if(type==='string')return this.heap.string(String(v));if(this.vm.inspector){if(type==='double')return {float:'r8',value:Number(v)};if(type==='bool')return v?1:0;}return v;}
  make(type,values={},kind='host'){const data=[];return this.heap.withRoots(Object.values(values),()=>{for(const [k,v]of Object.entries(values)){data.push(k,v);if(isReference(v))this.heap.pins.push(v);}return this.heap.allocate(kind,type,data);});}
  command(command){if(command.op==='set'&&this.animations){const [h,g]=String(command.id).split(':').map(Number),ref={h,g},prop=['Left','Top'].includes(command.property)?'$'+command.property:command.property;if(this.animations.bases.has(this.animations.key(ref,prop)))command={...command,value:this.exportValue(this.get(ref,prop))};}const value={...command,sequence:++this.sequence};if(this.transaction){if(this.transaction.length>=this.maxCommands)throw new ManagedFault('ExecutionLimitException','UI transaction command limit exceeded');this.transaction.push(value);}else this.options.onUICommand?.(value);}
  beginTransaction(){if(this.transaction)throw new ManagedFault('InvalidOperationException','Nested platform transaction');const t=[];this.transaction=t;return t;}
  commitTransaction(t){if(!t)return;if(this.transaction!==t)throw new ManagedFault('InvalidOperationException','Invalid UI transaction');this.transaction=null;for(const c of t)this.options.onUICommand?.(c);}
  rollbackTransaction(t){if(t&&this.transaction===t)this.transaction=null;}
  runtimeInfo(){return {externalRevision:this.hostOperations.revision,pendingExternal:this.hostOperations.active.size,reverseBarrier:this.hostOperations.active.size?'External operation pending':this.hostOperations.revision?'History cannot cross earlier external operations':null,simd:this.numeric?{...this.numeric.metrics}:{backend:'not initialized'},compute:this.computePool?{...this.computePool.stats,workers:this.computePool.size,slots:this.computePool.slots.map(s=>s?.info??null)}:null,network:this.httpTransport?{policy:this.httpTransport.policy.describe(),...this.httpTransport.stats,active:this.httpTransport.active.size,queued:this.httpTransport.queue.length}:{enabled:false,requests:0}};}
  snapshot(){return {animations:this.animations.snapshot(),singletons:[...this.singletons],windows:[...this.windows],application:this.application,sequence:this.sequence};}
  restore(s){if(!s)return;this.animations.restore(s.animations);this.windows=new Map(s.windows);this.singletons=new Map(s.singletons??[]);this.application=s.application;this.sequence=Math.max(this.sequence,s.sequence);if(!this.transaction&&this.options.onUICommand)this.command({op:'reset',snapshot:this.scene()});}
  singleton(name,create){if(!this.singletons.has(name))this.singletons.set(name,create());return this.singletons.get(name);}
  unsetValue(){return this.singleton('UnsetValue',()=>this.make(XAML+'DependencyProperty',{Name:this.managed('UnsetValue','string')}));}
  styleMutation(callback){if(this.styleDepth)return callback();const heap=this.heap.snapshot(),platform=this.snapshot(),pending=this.vm.pendingWrite,existing=this.transaction,offset=existing?.length??0,t=existing??this.beginTransaction();this.styleDepth++;
    try{const result=callback();if(!existing)this.commitTransaction(t);return result;}catch(error){this.heap.restore(heap);this.restore(platform);this.vm.pendingWrite=pending;if(existing)existing.length=offset;else this.rollbackTransaction(t);throw error;}finally{this.styleDepth--;}}
  delegate(type,method,receiver){return this.make(type,{method,receiver},'delegate');}
  delegateEquals(a,b){return boundDelegatesEqual(this.vm,a,b);}
  construct(type,args){
    const t=frameworkType(type);if(!t)throw new ManagedFault('TypeLoadException',`Unknown framework type ${type}`);
    if(t.kind==='delegate')return constructBoundDelegate(this.vm,type,args[0],args[1]);
    if(type===THREAD)return this.vm.scheduler.createThread(args[0]);
    const values={};const ps=propertiesFor(type);for(const [key,p]of Object.entries(ps))if(!p.isStatic&&p.value!==null){values[key]=this.managed(p.value,p.type);if(isReference(values[key]))this.heap.pins.push(values[key]);}
    const n=args.map(v=>this.native(v));
    if(type===XAML+'Thickness'||type===XAML+'CornerRadius'){const slots=t.slots;slots.forEach((key,i)=>values[key]=this.managed(args.length===1?n[0]:n[i],'double'));}
    if(type===XAML+'GridLength'){if(!Number.isFinite(n[0])||n[0]<0)throw new ManagedFault('ArgumentException','GridLength must be finite and nonnegative');values.Value=this.managed(n[0],'double');values.GridUnitType=n[1]??1;}
    if(type===MEDIA+'SolidColorBrush')values.Color=args[0]??null;
    if(type===XAML+'Setter'&&args.length){values.Property=args[0];values.Value=args[1];}
    if(type===XAML+'Style'&&args.length)values.TargetTypeName=args[0];
    const ref=this.make(type,values);this.heap.pins.push(ref);
    if(t.kind==='application'){if(this.application)throw new ManagedFault('InvalidOperationException','An application already exists');this.application=ref;}
    this.command({op:'create',id:identity(ref),type,properties:this.exportProperties(ref)});return ref;
  }
  getProperty(ref,d){
    if(d.isStatic){
      if(d.owner===XAML+'DependencyProperty'&&d.property==='UnsetValue')return this.unsetValue();
      if(d.result===XAML+'DependencyProperty'&&d.property.endsWith('Property'))return this.singleton(d.owner+'::'+d.property,()=>this.make(XAML+'DependencyProperty',{Name:this.managed(d.property.slice(0,-8),'string'),Owner:this.managed(d.owner,'string')}));
      if(d.owner==='Microsoft.UI.Colors')return this.color(colorValues[d.property]);
      if(d.owner===XAML+'GridLength'&&d.property==='Auto')return this.construct(XAML+'GridLength',[0,0]);
      if(d.owner===XAML+'Application'&&d.property==='Current')return this.application;
      if(d.owner===TASK||taskResult(d.owner)!==null||d.owner===THREAD)return this.vm.scheduler.invoke(d,[]);
    }
    if(ref?.byref)ref=this.vm.dereference(ref);
    if(taskResult(d.owner)!==null||d.owner===THREAD)return this.vm.scheduler.invoke(d,[ref]);
    const r=this.record(ref);if(d.property==='Count'&&r.kind==='collection')return this.items(ref).length;
    let value=this.get(ref,d.property,undefined);
    if(value==null&&frameworkType(d.result)?.kind==='collection'){value=this.make(d.result,{},'collection');this.heap.withRoots([value],()=>this.set(ref,d.property,value));this.set(value,'$owner',ref);this.set(value,'$property',d.property);}
    return value??null;
  }
  validateProperty(ref,key,value){const p=propertiesFor(this.record(ref).type)[key];if(!p||p.readOnly)throw new ManagedFault('InvalidOperationException',`Property '${key}' is not writable`);const v=this.native(value);
    if(p.type==='double'&&(typeof v!=='number'||!Number.isFinite(v)&&!(['Width','Height','MaxWidth','MaxHeight','ItemWidth','ItemHeight'].includes(key)&&Number.isNaN(v))))throw new ManagedFault('ArgumentException','Finite numeric property required');
    if(p.type==='int'&&(!Number.isInteger(v)||v< -2147483648||v>2147483647))throw new ManagedFault('ArgumentException','Int32 property required');
    if(p.type==='bool'&&typeof v!=='boolean'&&!(this.vm.inspector&&(v===0||v===1)))throw new ManagedFault('ArgumentException','Boolean property required');
    if(p.type==='string'&&v!==null&&typeof v!=='string')throw new ManagedFault('ArgumentException','String property required');
    const target=frameworkType(p.type);if(target&&target.kind!=='enum'&&value!==null&&(!isReference(value)||!frameworkAssignable(p.type,this.heap.get(value).type)))throw new ManagedFault('ArgumentException',`Property '${key}' requires ${p.type}`);
    if(key==='SpeedRatio'&&(v<=0||v>1000))throw new ManagedFault('ArgumentOutOfRangeException','SpeedRatio must be positive');
    if(key==='MaximumRowsOrColumns'&&(v<0||v>10000))throw new ManagedFault('ArgumentOutOfRangeException','MaximumRowsOrColumns is out of range');
    if(['Opacity'].includes(key)&&(!Number.isFinite(v)||v<0||v>1))throw new ManagedFault('ArgumentOutOfRangeException','Opacity must be between zero and one');
    if(['Width','Height','MinWidth','MinHeight','MaxWidth','MaxHeight','FontSize','Spacing','RowSpacing','ColumnSpacing','ItemWidth','ItemHeight'].includes(key)&&v<0)throw new ManagedFault('ArgumentOutOfRangeException',`${key} cannot be negative`);
    if(frameworkType(p.type)?.kind==='enum'&&!Object.values(frameworkType(p.type).values).includes(v))throw new ManagedFault('ArgumentOutOfRangeException',`Invalid ${p.type}`);
  }
  setProperty(ref,d,value){if(ref?.byref)ref=this.vm.dereference(ref);if(d.owner===THREAD)return this.vm.scheduler.invoke(d,[ref,value]);this.validateProperty(ref,d.property,value);
    if(!this.styleDepth&&(['Style','Template'].includes(d.property)||['style','setter','template'].includes(frameworkType(this.record(ref).type)?.kind)||this.animations.bases.has(this.animations.key(ref,d.property))))return this.styleMutation(()=>this.setProperty(ref,d,value));
    const old=this.get(ref,d.property);if(['Child','Content'].includes(d.property)&&!equal(old,value)){if(isReference(value)&&this.isElement(value))this.parent(value,ref);if(isReference(old)&&this.isElement(old))this.set(old,'$parent',null);}
    this.set(ref,'$local:'+d.property,true);this.set(ref,d.property,value);if(d.property==='Style')refreshStyle(this,ref);if(d.property==='Template')applyTemplate(this,ref);updateBindings(this,ref);if(['style','setter'].includes(frameworkType(this.record(ref).type)?.kind))refreshStyles(this);this.command({op:'set',id:identity(ref),property:d.property,value:this.exportValue(value)});
    // Brushes and value objects are exported by value. Refresh their live consumers.
    if(frameworkType(this.record(ref).type)?.kind==='value'||this.record(ref).type===MEDIA+'SolidColorBrush')this.command({op:'reset',snapshot:this.scene()});
    if(d.property==='SelectedIndex'){const list=this.get(ref,this.record(ref).type===CONTROLS+'NavigationView'?'MenuItems':this.record(ref).type===CONTROLS+'TabView'?'TabItems':'Items'),items=list?this.items(list):[],index=this.native(value);this.set(ref,'SelectedItem',index>=0&&index<items.length?items[index]:null);}
    return null;
  }
  isElement(ref){let type=this.heap.get(ref).type;const seen=new Set();while(frameworkType(type)&&!seen.has(type)){if(type===XAML+'UIElement')return true;seen.add(type);type=frameworkType(type).base;}return false;}
  parent(child,owner){const previous=this.get(child,'$parent');if(previous&&!equal(previous,owner))throw new ManagedFault('InvalidOperationException','UIElement already belongs to another parent');let at=owner;for(let n=0;at&&n<1024;n++){if(equal(at,child))throw new ManagedFault('InvalidOperationException','Visual tree cycle');at=this.get(at,'$parent');}this.set(child,'$parent',owner);}
  items(ref){const data=this.get(ref,'$items');return data?this.heap.get(data).data:[];}
  replaceItems(ref,items){if(items.length>10000)throw new ManagedFault('OutOfMemoryException','UI collection item limit exceeded');const data=this.heap.allocate('array','object[]',[...items]);this.heap.withRoots([data],()=>this.set(ref,'$items',data));const owner=this.get(ref,'$owner');if(owner)this.command({op:'collection',id:identity(owner),property:this.get(ref,'$property'),items:items.map(v=>this.exportValue(v))});}
  collection(ref,name,args){if(!this.styleDepth&&this.record(ref).type===XAML+'SetterBaseCollection'&&name!=='get_Item')return this.styleMutation(()=>this.collection(ref,name,args));const items=[...this.items(ref)],owner=this.get(ref,'$owner');let index,removed=[];
    if(name==='get_Item'){index=Number(this.native(args[0]));if(!Number.isInteger(index)||index<0||index>=items.length)throw new ManagedFault('ArgumentOutOfRangeException','Collection index');return items[index];}
    if(name==='Add'||name==='Insert'){index=name==='Add'?items.length:Number(this.native(args[0]));const value=args.at(-1);if(!Number.isInteger(index)||index<0||index>items.length)throw new ManagedFault('ArgumentOutOfRangeException','Collection index');if(owner&&isReference(value)&&this.isElement(value)){if(items.some(x=>equal(x,value)))throw new ManagedFault('InvalidOperationException','Duplicate UIElement');this.parent(value,owner);}items.splice(index,0,value);}
    else if(name==='Clear')removed=items.splice(0);
    else if(name==='Remove'||name==='RemoveAt'){index=name==='Remove'?items.findIndex(x=>equal(x,args[0])):Number(this.native(args[0]));if(index<0&&name==='Remove')return this.managed(false,'bool');if(!Number.isInteger(index)||index<0||index>=items.length)throw new ManagedFault('ArgumentOutOfRangeException','Collection index');removed=items.splice(index,1);}
    else throw new ManagedFault('MissingMethodException',name);
    for(const value of removed)if(isReference(value)&&this.isElement(value))this.set(value,'$parent',null);
    this.replaceItems(ref,items);if(this.record(ref).type===XAML+'SetterBaseCollection')refreshStyles(this);return name==='Remove'?this.managed(true,'bool'):null;
  }
  color(css){const hex=css.replace('#',''),n=parseInt(hex,16);return this.make('Windows.UI.Color',{A:hex.length===8?n&255:255,R:hex.length===8?n>>>24:n>>>16&255,G:hex.length===8?n>>>16&255:n>>>8&255,B:hex.length===8?n>>>8&255:n&255});}
  advanceAnimations(delta){return advanceManagedAnimations(this,delta);}
  invoke(d,args){return this.heap.withRoots(args,()=>{
    // Closed ABI dispatch: a collection call must not probe every added subsystem.
    // Resolve only once and keep the common BCL path independent of networking/SIMD.
    const handled=invokeBclPlatform(this,d,args,frameworkType(d.owner));
    if(handled?.handled)return handled.value;
    const animated=invokeAnimation(this,d,args);if(animated.handled)return animated.value;
    if(d.owner===TASK||taskResult(d.owner)!==null||d.owner===THREAD||d.owner==='SharpForge.Runtime.Async')return this.vm.scheduler.invoke(d,args);
    if(d.kind==='constructor')return this.construct(d.owner,args);
    let ref=d.isStatic?null:args[0],values=d.isStatic?args:args.slice(1);if(ref?.byref)ref=this.vm.dereference(ref);
    if(d.kind==='get')return this.getProperty(ref,d);
    if(d.kind==='set')return this.setProperty(ref,d,values[0]);
    if(d.kind==='eventAdd'||d.kind==='eventRemove'){const key='$event:'+d.event,previous=this.get(ref,key),list=previous?[...this.heap.get(previous).data]:[],handler=values[0];if(handler===null)return null;this.record(handler);if(d.kind==='eventAdd')list.push(handler);else {const index=list.findLastIndex(x=>this.delegateEquals(x,handler));if(index>=0)list.splice(index,1);}if(list.length>1024)throw new ManagedFault('ExecutionLimitException','Event subscriber limit');const data=this.heap.allocate('array','object[]',list);this.heap.withRoots([data],()=>this.set(ref,key,data));this.command({op:'event',id:identity(ref),event:d.event,enabled:list.length>0});return null;}
    if(d.kind==='attachedSet'){ref=args[0];const n=Number(this.native(args[1]));if(!Number.isFinite(n)||['Row','Column'].includes(d.property)&&(!Number.isInteger(n)||n<0)||d.property.endsWith('Span')&&(!Number.isInteger(n)||n<1))throw new ManagedFault('ArgumentOutOfRangeException','Invalid attached layout value');this.set(ref,'$'+d.property,args[1]);this.command({op:'set',id:identity(ref),property:d.property,value:n});return null;}
    if(d.kind==='attachedGet')return this.get(args[0],'$'+d.property,d.property.endsWith('Span')?1:0);
    if(frameworkType(d.owner)?.kind==='collection')return this.collection(ref,d.name,values);
    if(d.owner==='Windows.UI.Color'&&d.name==='FromArgb'){const [A,R,G,B]=args.map(v=>this.native(v));if([A,R,G,B].some(v=>!Number.isInteger(v)||v<0||v>255))throw new ManagedFault('ArgumentOutOfRangeException','ARGB channels must be bytes');return this.make(d.owner,{A,R,G,B});}
    if(d.owner===CONTROLS+'MenuFlyout'){if(d.name==='ShowAt'){this.command({op:'flyout',id:identity(ref),anchor:identity(values[0]),show:true});return null;}if(d.name==='Hide'){this.command({op:'flyout',id:identity(ref),show:false});return null;}}
    if(d.owner===XAML+'Window'){if(d.name==='Activate'){this.windows.set(identity(ref),ref);this.set(ref,'$active',true);this.command({op:'activate',id:identity(ref),snapshot:this.scene()});this.raiseLifecycle(ref,'Loaded');return null;}if(d.name==='Close'){this.raiseLifecycle(ref,'Unloaded');this.enqueueEvent(ref,'Closed');this.windows.delete(identity(ref));this.set(ref,'$active',false);this.command({op:'close',id:identity(ref)});return null;}}
    if(d.owner===XAML+'Application'&&d.name==='Exit'){this.windows.clear();this.command({op:'reset',snapshot:this.scene()});return null;}
    if(d.name==='Focus'){this.command({op:'focus',id:identity(ref)});return this.managed(true,'bool');}
    if(d.name==='FindName'){const name=this.native(values[0]),seen=new Set(),queue=[ref];while(queue.length){const item=queue.pop(),id=identity(item);if(seen.has(id))continue;seen.add(id);if(this.native(this.get(item,'Name'))===name)return item;for(const [key,value]of this.propertyEntries(item))if(isReference(value)&&!key.startsWith('$')){if(this.isElement(value))queue.push(value);else if(this.heap.get(value).kind==='collection')queue.push(...this.items(value).filter(isReference));}}return null;}
    if(d.owner==='SharpForge.UI.DrawingSurface'){const instructions=this.get(ref,'$drawing'),old=instructions?JSON.parse(this.native(instructions)):[];const commands=d.name==='Clear'?[]:[...old,{op:d.name,args:values.map(v=>this.exportValue(v))}];if(commands.length>10000)throw new ManagedFault('ExecutionLimitException','Drawing command limit');const str=this.heap.string(JSON.stringify(commands));this.heap.withRoots([str],()=>this.set(ref,'$drawing',str));this.command({op:'draw',id:identity(ref),commands});return null;}
    if(frameworkType(d.owner)?.kind==='delegate'&&d.name==='Invoke')return this.vm.scheduler.callDelegate(ref,values);
    const styled=invokeStyling(this,d,args);if(styled.handled)return styled.value;
    throw new ManagedFault('MissingMethodException',`Framework operation ${d.owner}::${d.name} is unavailable`);
  });}
  propertyEntries(ref){const data=this.record(ref).data;return Array.from({length:data.length/2},(_,i)=>[data[2*i],data[2*i+1]]);}
  exportValue(value,depth=0){if(depth>16)throw new ManagedFault('ExecutionLimitException','Framework value nesting limit');if(!isReference(value))return this.native(value);const r=this.heap.get(value);if(r.kind==='string')return r.data;if(r.kind==='box')return this.exportValue(r.data[0],depth+1);const t=frameworkType(r.type);if(t?.kind==='value'||r.type===MEDIA+'SolidColorBrush'){const p={};for(const[k,v]of this.propertyEntries(value))if(!k.startsWith('$'))p[k]=this.exportValue(v,depth+1);return {valueType:r.type,...p};}return {$ref:identity(value)};}
  exportProperties(ref){const p={};for(const[k,v]of this.propertyEntries(ref))if(!k.startsWith('$'))p[k]=this.exportValue(v);return p;}
  scene(){const nodes=[],seen=new Set(),queue=[...this.windows.values()];let count=0;while(queue.length){const ref=queue.shift();if(!isReference(ref))continue;const id=identity(ref);if(seen.has(id))continue;seen.add(id);if(++count>10000)throw new ManagedFault('ExecutionLimitException','UI scene limit');const r=this.heap.get(ref);if(r.kind==='string'||r.kind==='delegate')continue;if(r.kind==='box'){if(isReference(r.data[0]))queue.push(r.data[0]);continue;}if(r.kind==='collection'){for(const v of this.items(ref))if(isReference(v))queue.push(v);continue;}if(!frameworkType(r.type))continue;const node={id,type:r.type,properties:this.exportProperties(ref),localProperties:[...this.propertyEntries(ref)].filter(([key,value])=>key.startsWith('$local:')&&value).map(([key])=>key.slice(7)),events:[],collections:{}};const templateRoot=this.get(ref,'$templateRoot'),templateOwner=this.get(ref,'$templateOwner'),bindings=this.get(ref,'$bindings');if(templateRoot){node.templateRoot=identity(templateRoot);queue.push(templateRoot);}if(templateOwner)node.templateOwner=identity(templateOwner);if(bindings)node.templateBindings=Object.fromEntries(Object.entries(JSON.parse(this.native(bindings))).filter(([name])=>!this.get(ref,'$local:'+name,false)));for(const[k,v]of this.propertyEntries(ref)){if(k.startsWith('$event:')){if(v&&this.heap.get(v).data.length)node.events.push(k.slice(7));continue;}if(k==='$drawing'&&v)node.drawing=JSON.parse(this.native(v));if(['$Row','$Column','$RowSpan','$ColumnSpan','$WrapRowSpan','$WrapColumnSpan','$Left','$Top','$ZIndex'].includes(k)){node.properties[k.slice(1)]=this.native(v);node.localProperties.push(k.slice(1));}if(k.startsWith('$'))continue;if(isReference(v)){const vr=this.heap.get(v);if(vr.kind==='collection')node.collections[k]=this.items(v).map(x=>this.exportValue(x));queue.push(v);}}
      nodes.push(node);
    }return {version:1,windows:[...this.windows.keys()],nodes};}
  updateLayout(changes){if(!Array.isArray(changes)||changes.length>10000)throw new RangeError('Layout update limit');const visible=new Set(this.scene().nodes.map(n=>n.id));for(const c of changes){if(!visible.has(c.id)||!Number.isFinite(c.width)||!Number.isFinite(c.height)||c.width<0||c.height<0||c.width>100000||c.height>100000)throw new TypeError('Invalid visual layout measurement');}for(const c of changes){const [h,g]=c.id.split(':').map(Number),ref=Object.freeze({h,g});for(const [name,value]of [['ActualWidth',c.width],['ActualHeight',c.height]])if(Object.hasOwn(propertiesFor(this.record(ref).type),name))this.set(ref,name,this.managed(value,'double'));}return changes.length;}
  closeAll(){this.hostOperations.dispose();this.httpTransport?.dispose();this.computePool?.dispose();this.windows.clear();this.pending=[];this.command({op:'reset',snapshot:{version:1,windows:[],nodes:[]}});}
  dispatchEvent(id,event,payload={}){if(typeof id!=='string'||typeof event!=='string'||!payload||typeof payload!=='object')throw new TypeError('Invalid UI event');const [h,g]=id.split(':').map(Number),ref=Object.freeze({h,g}),r=this.record(ref),known=eventsFor(r.type);if(!Object.hasOwn(known,event))throw new ManagedFault('InvalidOperationException','Unregistered event');const visible=this.scene().nodes.some(n=>n.id===id);if(!visible)throw new ManagedFault('InvalidOperationException','Event target is not in an active visual tree');if(this.native(this.get(ref,'IsEnabled',true))===false||this.native(this.get(ref,'IsEnabled',true))===0||this.native(this.get(ref,'IsHitTestVisible',true))===false||this.native(this.get(ref,'IsHitTestVisible',true))===0)return [];
    if((r.type===CONTROLS+'InfoBar'&&event==='Closed')||(r.type===CONTROLS+'ContentDialog'&&event.endsWith('ButtonClick')))this.set(ref,'IsOpen',this.managed(false,'bool'));
    const inputKeys={TextChanged:'Text',PasswordChanged:'Password',Toggled:'IsOn',Checked:'IsChecked',Unchecked:'IsChecked',ValueChanged:'Value',SelectionChanged:'SelectedIndex',Expanding:'IsExpanded',Collapsed:'IsExpanded',DateChanged:'Date',TimeChanged:'Time'};
    if(inputKeys[event]&&Object.hasOwn(payload,'value')){const key=inputKeys[event],p=propertiesFor(r.type)[key];if(p){let value=payload.value;if(p.type==='string'){if(typeof value!=='string'||value.length>1000000)throw new ManagedFault('ArgumentException','Invalid input text');}else if(p.type==='bool'){if(typeof value!=='boolean')throw new ManagedFault('ArgumentException','Invalid toggle value');}else if(typeof value!=='number'||!Number.isFinite(value)||p.type==='int'&&!Number.isInteger(value))throw new ManagedFault('ArgumentException','Invalid numeric input');if(key==='Text'&&this.native(this.get(ref,'MaxLength',0))>0)value=value.slice(0,this.native(this.get(ref,'MaxLength')));if(key==='Value')value=Math.max(this.native(this.get(ref,'Minimum',0)),Math.min(value,this.native(this.get(ref,'Maximum',100))));if(key==='SelectedIndex'){const list=this.get(ref,r.type===CONTROLS+'NavigationView'?'MenuItems':r.type===CONTROLS+'TabView'?'TabItems':'Items'),items=list?this.items(list):[];if(value< -1||value>=items.length)throw new ManagedFault('ArgumentOutOfRangeException','Selection index is outside the items');}const v=this.managed(value,p.type);this.heap.withRoots([v],()=>{this.validateProperty(ref,key,v);this.set(ref,'$local:'+key,true);this.set(ref,key,v);updateBindings(this,ref);if(key==='SelectedIndex'){const list=this.get(ref,r.type===CONTROLS+'NavigationView'?'MenuItems':r.type===CONTROLS+'TabView'?'TabItems':'Items');const items=list?this.items(list):[];if(value< -1||value>=items.length)throw new ManagedFault('ArgumentOutOfRangeException','Selection index is outside the items');this.set(ref,'SelectedItem',value===-1?null:items[value]);}});}}
    return this.enqueueEvent(ref,event);
  }
  raiseLifecycle(ref,event){const visit=(current,seen=new Set())=>{if(!isReference(current)||seen.has(identity(current)))return;seen.add(identity(current));const r=this.heap.get(current);if(!frameworkType(r.type))return;if(eventsFor(r.type)[event])this.enqueueEvent(current,event);for(const [key,value]of this.propertyEntries(current)){if(key.startsWith('$')||!isReference(value))continue;const entry=this.heap.get(value);if(entry.kind==='collection'){for(const child of this.items(value))if(isReference(child))visit(child,seen);}else if(this.isElement(value))visit(value,seen);}};visit(ref);}
  enqueueEvent(ref,event){
    const r=this.record(ref),list=this.get(ref,'$event:'+event),handlers=list?[...this.heap.get(list).data]:[];const ids=[];this.heap.withRoots([ref,...handlers],()=>{const args=this.make(XAML+'RoutedEventArgs',{OriginalSource:ref,Handled:false});this.heap.pins.push(args);for(const handler of handlers)ids.push(this.vm.scheduler.enqueue(handler,[ref,args],{name:r.type.split('.').at(-1)+'.'+event,kind:'ui'}));});return ids;
  }

}
