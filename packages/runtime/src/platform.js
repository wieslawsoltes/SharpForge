import {managedScene} from './ui/scene.js';
import {invokeManagedCollection,replaceManagedItems} from './ui/collection-operations.js';
import {changeManagedEventSubscription} from './ui/event-subscriptions.js';
import {managedDelegatesEqual} from './ui/delegate-identity.js';
import {dispatchManagedEvent,emitManagedEvent} from './ui/events.js';
import {parentManagedVisual,managedVisualLifecycle,trackManagedTreeCommand} from './ui/tree-services.js';
import {exportManagedRenderingValue} from './ui/value-dependencies.js';
import {activateManagedWindow,closeManagedWindow,exitManagedApplication} from './ui/application-services.js';
import {withStyleTransaction} from './ui/style-transaction.js';
import {deliverUICommand,dispatchPrivateInput,exportPublicProperties} from './ui/private-input.js';
import {ManagedUIContext} from './ui/context.js';
import {uiObjectStorage,frameworkDefinition,managedUIProperties} from './ui/object-storage.js';
import {readManagedUIProperty} from './ui/property-read.js';
import {validateObjectProperty,setObjectProperty} from './ui/object-properties.js';
import {managedPropertyFault} from './ui/property-errors.js';
import {initializeBclHost,invokeBclPlatform} from './bcl-adapter.js';
import {constructBoundDelegate} from './execution/delegate-targets.js';
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
  constructor(vm,options={}){this.vm=vm;this.heap=vm.heap;initializeBclHost(this);this.options=options;this.windows=new Map();this.application=null;this.singletons=new Map();this.styleDepth=0;this.sequence=0;this.pending=[];this.transaction=null;this.maxCommands=options.maxUICommands??10000;this.animations=createManagedAnimationClock(this);this.hostOperations=new HostOperations(this);this.ui=new ManagedUIContext(this);}
  *roots(){yield* this.ui.roots();yield* this.hostOperations.roots();yield* this.animations.roots();yield this.application;yield* this.singletons.values();yield* this.windows.values();for(const p of this.pending)yield p;}
  record(ref){return uiObjectStorage(this,ref).record;}
  propertyIndex(record){
    this.propertyIndexes??=new WeakMap();let cached=this.propertyIndexes.get(record);
    if(!cached||cached.data!==record.data||cached.length!==record.data.length){const index=new Map();for(let i=0;i<record.data.length;i+=2)index.set(record.data[i],i);cached={data:record.data,length:record.data.length,index};this.propertyIndexes.set(record,cached);}return cached.index;
  }
  get(ref,key,fallback=null){const r=uiObjectStorage(this,ref,{allowObject:key.startsWith('$')}).record,at=this.propertyIndex(r).get(key);return at===undefined?fallback:r.data[at+1];}
  set(ref,key,value){
    const storage=uiObjectStorage(this,ref,{allowObject:key.startsWith('$')});this.ui?.journal?.captureReference(storage.reference);
    if(!this.ui?.applyingProperties&&!this.animations.applying&&this.animations.bases.size&&this.animations.bases.has(this.animations.key(ref,key))){this.animations.setBase(ref,key,this.native(value));return value;}
    const r=storage.record,at=this.propertyIndex(r).get(key),index=at===undefined?r.data.length:at,old=at===undefined?null:r.data[index+1];
    // Existing slots have fixed size; mutate once, retaining GC/write-barrier bookkeeping.
    // Snapshots own copies, and restore replaces records, invalidating the WeakMap naturally.
    if(at===undefined)this.heap.replaceData(storage.reference,[...r.data,key,value]);else{r.data[index+1]=value;this.heap.mutationRevision++;}
    this.vm.notifyWrite?.({kind:'field',handle:ref.h,generation:ref.g,index:index+1,value,oldValue:old,property:key});return value;
  }
  native(v){if(v?.byref)return this.native(this.vm.dereference(v));return this.vm.value(v);}
  managed(v,type){if(v===null||v===undefined)return null;if(type==='string')return this.heap.string(String(v));if(this.vm.inspector){if(type==='double')return {float:'r8',value:Number(v)};if(type==='bool')return v?1:0;}return v;}
  make(type,values={},kind='host'){const data=[];return this.heap.withRoots(Object.values(values),()=>{for(const [k,v]of Object.entries(values)){data.push(k,v);if(isReference(v))this.heap.pins.push(v);}const reference=this.heap.allocate(kind,type,data);return this.ui?.construction.retain(reference)??reference;});}
  command(command){if(this.ui?.objectTree)trackManagedTreeCommand(this.ui,command);if(command.op==='set'&&this.animations){const [h,g]=String(command.id).split(':').map(Number),ref={h,g},prop=['Left','Top'].includes(command.property)?'$'+command.property:command.property;if(this.animations.bases.has(this.animations.key(ref,prop)))command={...command,value:this.exportValue(this.get(ref,prop))};}const value={...command,sequence:++this.sequence};if(this.transaction){if(this.transaction.length>=this.maxCommands)throw new ManagedFault('ExecutionLimitException','UI transaction command limit exceeded');this.transaction.push(value);}else deliverUICommand(this,value);}
  beginTransaction(){if(this.transaction)throw new ManagedFault('InvalidOperationException','Nested platform transaction');const t=[];this.transaction=t;return t;}
  commitTransaction(t){if(!t)return;if(this.transaction!==t)throw new ManagedFault('InvalidOperationException','Invalid UI transaction');this.transaction=null;for(const c of t)deliverUICommand(this,c);}
  rollbackTransaction(t){if(t&&this.transaction===t)this.transaction=null;}
  runtimeInfo(){return {externalRevision:this.hostOperations.revision,pendingExternal:this.hostOperations.active.size,reverseBarrier:this.hostOperations.active.size?'External operation pending':this.hostOperations.revision?'History cannot cross earlier external operations':null,simd:this.numeric?{...this.numeric.metrics}:{backend:'not initialized'},compute:this.computePool?{...this.computePool.stats,workers:this.computePool.size,slots:this.computePool.slots.map(s=>s?.info??null)}:null,network:this.httpTransport?{policy:this.httpTransport.policy.describe(),...this.httpTransport.stats,active:this.httpTransport.active.size,queued:this.httpTransport.queue.length}:{enabled:false,requests:0}};}
  snapshot(){return {ui:this.ui.snapshot(),animations:this.animations.snapshot(),singletons:[...this.singletons],windows:[...this.windows],application:this.application,sequence:this.sequence};}
  restore(s){if(!s)return;this.ui.restore(s.ui);this.animations.restore(s.animations);this.windows=new Map(s.windows);this.singletons=new Map(s.singletons??[]);this.application=s.application;this.sequence=Math.max(this.sequence,s.sequence);if(!this.transaction&&this.options.onUICommand)this.command({op:'reset',snapshot:this.scene()});}
  singleton(name,create){if(!this.singletons.has(name))this.singletons.set(name,create());return this.singletons.get(name);}
  unsetValue(){return this.singleton('UnsetValue',()=>this.make(XAML+'DependencyProperty',{Name:this.managed('UnsetValue','string')}));}
  styleMutation(callback){return withStyleTransaction(this,callback);}
  delegate(type,method,receiver){return this.make(type,{method,receiver},'delegate');}
  delegateEquals(a,b){return managedDelegatesEqual(this,a,b);}
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
      if(d.result===XAML+'DependencyProperty'&&d.property.endsWith('Property'))return this.ui.properties.token(d.owner,d.property.slice(0,-8));
      if(d.owner==='Microsoft.UI.Colors')return this.color(colorValues[d.property]);
      if(d.owner===XAML+'GridLength'&&d.property==='Auto')return this.construct(XAML+'GridLength',[0,0]);
      if(d.owner===XAML+'Application'&&d.property==='Current')return this.application;
      if(d.owner===TASK||taskResult(d.owner)!==null||d.owner===THREAD)return this.vm.scheduler.invoke(d,[]);
    }
    if(ref?.byref)ref=this.vm.dereference(ref);
    if(taskResult(d.owner)!==null||d.owner===THREAD)return this.vm.scheduler.invoke(d,[ref]);
    return readManagedUIProperty(this,ref,d);
  }
  validateProperty(ref,key,value){return validateObjectProperty(this,ref,key,value);}
  setProperty(ref,d,value){return setObjectProperty(this,ref,d,value);}
  isElement(ref){return isReference(ref)&&this.ui.properties.assignable(XAML+'UIElement',this.heap.get(ref).type);}
  parent(child,owner){return this.ui.setVisualParent(child,owner);}
  items(ref){const data=this.get(ref,'$items');return data?this.heap.get(data).data:[];}
  replaceItems(ref,items){return replaceManagedItems(this,ref,items);}
  collection(ref,name,args){return invokeManagedCollection(this,ref,name,args);}
  color(css){const hex=css.replace('#',''),n=parseInt(hex,16);return this.make('Windows.UI.Color',{A:hex.length===8?n&255:255,R:hex.length===8?n>>>24:n>>>16&255,G:hex.length===8?n>>>16&255:n>>>8&255,B:hex.length===8?n>>>8&255:n&255});}
  advanceAnimations(delta){return advanceManagedAnimations(this,delta);}
  invoke(d,args){try{return this.heap.withRoots(args,()=>{
    // Closed ABI dispatch: a collection call must not probe every added subsystem.
    // Resolve only once and keep the common BCL path independent of networking/SIMD.
    const handled=invokeBclPlatform(this,d,args,frameworkType(d.owner));
    if(handled?.handled)return handled.value;
    const extension=this.ui.invoke(d,args);if(extension.handled)return extension.value;
    const animated=invokeAnimation(this,d,args);if(animated.handled)return animated.value;
    if(d.owner===TASK||taskResult(d.owner)!==null||d.owner===THREAD||d.owner==='SharpForge.Runtime.Async')return this.vm.scheduler.invoke(d,args);
    if(d.kind==='constructor')return this.construct(d.owner,args);
    let ref=d.isStatic?null:args[0],values=d.isStatic?args:args.slice(1);if(ref?.byref)ref=this.vm.dereference(ref);
    if(d.kind==='get')return this.getProperty(ref,d);
    if(d.kind==='set')return this.setProperty(ref,d,values[0]);
    if(d.kind==='eventAdd'||d.kind==='eventRemove')return changeManagedEventSubscription(this,ref,d,values[0]);
    if(d.kind==='attachedSet'||d.kind==='attachedGet')return this.ui.invokeAttached(d,args);
    if(frameworkType(d.owner)?.kind==='collection')return this.collection(ref,d.name,values);
    if(d.owner==='Windows.UI.Color'&&d.name==='FromArgb'){const [A,R,G,B]=args.map(v=>this.native(v));if([A,R,G,B].some(v=>!Number.isInteger(v)||v<0||v>255))throw new ManagedFault('ArgumentOutOfRangeException','ARGB channels must be bytes');return this.make(d.owner,{A,R,G,B});}
    if(d.owner===CONTROLS+'MenuFlyout'){if(d.name==='ShowAt'){this.command({op:'flyout',id:identity(ref),anchor:identity(values[0]),show:true});return null;}if(d.name==='Hide'){this.command({op:'flyout',id:identity(ref),show:false});return null;}}
    if(d.owner===XAML+'Window'){if(d.name==='Activate'){activateManagedWindow(this.ui,ref);return null;}if(d.name==='Close'){closeManagedWindow(this.ui,ref);return null;}}
    if(d.owner===XAML+'Application'&&d.name==='Exit'){exitManagedApplication(this.ui);return null;}
    if(d.name==='Focus'){this.command({op:'focus',id:identity(ref)});return this.managed(true,'bool');}
    if(d.name==='FindName'){const name=this.native(values[0]),seen=new Set(),queue=[ref];while(queue.length){const item=queue.pop(),id=identity(item);if(seen.has(id))continue;seen.add(id);if(this.native(this.get(item,'Name'))===name)return item;for(const [key,value]of this.propertyEntries(item))if(isReference(value)&&!key.startsWith('$')){if(this.isElement(value))queue.push(value);else if(this.heap.get(value).kind==='collection')queue.push(...this.items(value).filter(isReference));}}return null;}
    if(d.owner==='SharpForge.UI.DrawingSurface'){const instructions=this.get(ref,'$drawing'),old=instructions?JSON.parse(this.native(instructions)):[];const commands=d.name==='Clear'?[]:[...old,{op:d.name,args:values.map(v=>this.exportValue(v))}];if(commands.length>10000)throw new ManagedFault('ExecutionLimitException','Drawing command limit');const str=this.heap.string(JSON.stringify(commands));this.heap.withRoots([str],()=>this.set(ref,'$drawing',str));this.command({op:'draw',id:identity(ref),commands});return null;}
    if(frameworkType(d.owner)?.kind==='delegate'&&d.name==='Invoke'){const bound=this.ui.bindingServices.events.invokeDelegate(ref,values);return bound.handled?bound.value:this.vm.scheduler.callDelegate(ref,values);}
    const styled=invokeStyling(this,d,args);if(styled.handled)return styled.value;
    throw new ManagedFault('MissingMethodException',`Framework operation ${d.owner}::${d.name} is unavailable`);
  });}catch(error){throw managedPropertyFault(error);}}
  propertyEntries(ref){const data=this.record(ref).data;return Array.from({length:data.length/2},(_,i)=>[data[2*i],data[2*i+1]]);}
  exportValue(value,depth=0){if(depth>16)throw new ManagedFault('ExecutionLimitException','Framework value nesting limit');if(!isReference(value))return this.native(value);const r=this.heap.get(value);if(r.kind==='string')return r.data;if(r.kind==='box')return this.exportValue(r.data[0],depth+1);const rendered=this.ui&&exportManagedRenderingValue(this.ui,value);if(rendered?.handled)return rendered.value;const t=frameworkType(r.type);if(t?.kind==='value'||r.type===MEDIA+'SolidColorBrush'){const p={};for(const[k,v]of this.propertyEntries(value))if(!k.startsWith('$'))p[k]=this.exportValue(v,depth+1);return {valueType:r.type,...p};}return {$ref:identity(value)};}
  exportProperties(ref){return exportPublicProperties(this,ref);}
  scene(){return managedScene(this);}
  updateLayout(changes){if(!Array.isArray(changes)||changes.length>10000)throw new RangeError('Layout update limit');const visible=new Set(this.scene().nodes.map(n=>n.id));for(const c of changes){if(!visible.has(c.id)||!Number.isFinite(c.width)||!Number.isFinite(c.height)||c.width<0||c.height<0||c.width>100000||c.height>100000)throw new TypeError('Invalid visual layout measurement');}for(const c of changes){const [h,g]=c.id.split(':').map(Number),ref=Object.freeze({h,g});for(const [name,value]of [['ActualWidth',c.width],['ActualHeight',c.height]])if(Object.hasOwn(managedUIProperties(this,this.record(ref).type),name))this.ui.properties.setReadOnly(ref,name,this.managed(value,'double'));}return changes.length;}
  closeAll(){this.ui.dispose();this.hostOperations.dispose();this.httpTransport?.dispose();this.computePool?.dispose();this.windows.clear();this.pending=[];this.command({op:'reset',snapshot:{version:1,windows:[],nodes:[]}});}
  dispatchPrivateInput(id,property,value){return dispatchPrivateInput(this,id,property,value);}
  dispatchEvent(id,event,payload={}){return dispatchManagedEvent(this,id,event,payload);}
  raiseLifecycle(ref,event){return managedVisualLifecycle(this.ui,ref,event);}
  enqueueEvent(ref,event,payload={}){return emitManagedEvent(this.ui,ref,event,payload,{enqueue:true});}

}
