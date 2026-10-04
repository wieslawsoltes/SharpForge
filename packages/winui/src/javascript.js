import {createAnimationSystem} from './animation-system.js';
import {createStyleSystem} from './style-system.js';
import {createJavaScriptValues} from './javascript-values.js';
import {types,contracts,propertiesFor,eventsFor,frameworkType,frameworkAssignable,XAML,CONTROLS,enumTypes,colorValues} from '@sharpforge/framework';
import {WinUIHost} from './host.js';
/** Build code-first controls in JavaScript with the same supported type/property names as managed apps.
 * Each factory owns its objects, event handlers and renderer; no global application singleton. */
export function createWinUIApp(root, options={}) {
  let serial=0,disposed=false,application=null,animations=null;const objects=new Map(),classes=new Map(),namespaces={};
  const send=c=>{if(disposed)throw new Error('Application has been disposed');host.apply(c);};
  const alive=()=>{if(disposed)throw new Error('Application has been disposed');};
  const values=createJavaScriptValues({objects,send,alive});
  const value=v=>v?.$node?{$ref:v.$node.id}:values.export(v);
  const parent=new Map();
  function adopt(owner,v){if(!v?.$node||!frameworkAssignable(XAML+'UIElement',v.$node.type))return;if(v.$context!==objects)throw new Error('Control belongs to another application');const id=v.$node.id,previous=parent.get(id);if(previous&&previous!==owner.$node.id)throw new Error('A visual element already has a parent');let p=owner.$node.id;while(p){if(p===id)throw new Error('Visual parent cycle');p=parent.get(p);}parent.set(id,owner.$node.id);}
  function release(owner,v){if(v?.$node&&parent.get(v.$node.id)===owner.$node.id)parent.delete(v.$node.id);}
  function collection(owner,property){const items=[];let published=[];const update=()=>{send({op:'collection',id:owner.$node.id,property,items:items.map(value)});if(property==='Setters'){try{styles.refresh();published=[...items];}catch(error){items.splice(0,items.length,...published);send({op:'collection',id:owner.$node.id,property,items:items.map(value)});throw error;}}};return {
    get Count(){return items.length;},get_Item(i){if(!Number.isInteger(i)||i<0||i>=items.length)throw new RangeError('Collection index');return items[i];},
    Add(v){if(items.includes(v)&&v?.$node)throw new Error('Duplicate visual child');adopt(owner,v);items.push(v);update();},
    Insert(i,v){if(!Number.isInteger(i)||i<0||i>items.length)throw new RangeError('Collection index');if(items.includes(v)&&v?.$node)throw new Error('Duplicate visual child');adopt(owner,v);items.splice(i,0,v);update();},
    Remove(v){const i=items.indexOf(v);if(i<0)return false;this.RemoveAt(i);return true;},RemoveAt(i){const v=this.get_Item(i);items.splice(i,1);release(owner,v);update();},
    Clear(){for(const v of items)release(owner,v);items.length=0;update();},[Symbol.iterator](){return items[Symbol.iterator]();}
  };}
  const host=new WinUIHost(root,{...options,onEvent(id,event,payload){const o=objects.get(id);if(!o)return;const eventValue={OriginalSource:o,Handled:false,...payload};const prop={TextChanged:'Text',PasswordChanged:'Password',ValueChanged:'Value',SelectionChanged:'SelectedIndex',Checked:'IsChecked',Unchecked:'IsChecked',Toggled:'IsOn',DateChanged:'Date',TimeChanged:'Time'}[event];if(['Closed','PrimaryButtonClick','SecondaryButtonClick','CloseButtonClick'].includes(event)&&['InfoBar','ContentDialog'].includes(o.$node.type.split('.').at(-1)))o.$values.IsOpen=false;if(prop){o.$values[prop]=payload.value;o.$locals.add(prop);styles.bindings(o);}for(const handler of [...(o.$events[event]??[])])handler(o,eventValue);options.onEvent?.(id,event,payload);},onLayout(changes){for(const x of changes){const o=objects.get(x.id);if(o){o.$values.ActualWidth=x.width;o.$values.ActualHeight=x.height;}}options.onLayout?.(changes);}});
  const styles=createStyleSystem({objects,classes,send,host,value,animations:()=>animations});
  animations=createAnimationSystem({objects,styles,send,host,value,options});
  function add(path,v){const parts=path.split('.');let target=namespaces;for(const p of parts.slice(0,-1))target=target[p]??={};target[parts.at(-1)]=v;}
  function fromCss(css){const h=css.slice(1),n=parseInt(h,16);return h.length===8?[n&255,n>>>24,n>>>16&255,n>>>8&255]:[255,n>>>16&255,n>>>8&255,n&255];}
  const immutable=(type,args)=>values.construct(type,args);
  for(const [type,def]of types){if(def.kind==='enum'){add(type,Object.freeze({...def.values}));continue;}if(type.startsWith('System.')&&type!=='System.TimeSpan'||type.startsWith('SharpForge.Runtime.')||(['delegate','task','thread','collection'].includes(def.kind)&&!values.supports(type)))continue;
    if(def.kind==='static'){const object={};if(type==='Microsoft.UI.Colors')for(const[name,channels]of Object.entries(colorValues))Object.defineProperty(object,name,{get:()=>immutable('Windows.UI.Color',fromCss(channels))});add(type,object);continue;}
    const Type=class {
      constructor(...args){if(values.supports(type)||['value','brush'].includes(def.kind))return immutable(type,args);if(def.kind==='abstract')throw new TypeError(type+' is abstract');
        this.$context=objects;this.$node={id:'js:'+ ++serial,type};this.$values={};this.$locals=new Set();this.$events={};this.$collections={};objects.set(this.$node.id,this);
        for(const [property,definition] of Object.entries(propertiesFor(type)))if(!definition.isStatic)this.$values[property]=definition.value??null;
        if(type===XAML+'Setter'&&args.length){this.$values.Property=args[0];this.$values.Value=args[1];}if(type===XAML+'Style'&&args.length)this.$values.TargetTypeName=args[0];
        send({op:'create',...this.$node,properties:{...this.$values}});if(type===XAML+'Application')application=this;
      }
    };Object.defineProperty(Type,'name',{value:type.split('.').at(-1)});classes.set(type,Type);add(type,Type);
    for(const [property,definition] of Object.entries(propertiesFor(type))){const p={...definition,property,result:definition.type};if(p.isStatic){Object.defineProperty(Type,p.property,{get:()=>type==='System.TimeSpan'&&p.property==='Zero'?immutable(type,[0]):['Automatic','Forever'].includes(p.property)?Object.freeze({valueType:type,kind:p.property==='Forever'?'forever':'auto'}):p.property==='UnsetValue'?styles.unset:p.property.endsWith('Property')?styles.dp((()=>{let t=frameworkType(type);while(t&&!Object.hasOwn(t.properties,p.property))t=frameworkType(t.base);return t?.name??type;})(),p.property.slice(0,-8)):p.property==='Current'?application:p.property==='Auto'?immutable(XAML+'GridLength',[1,0]):null});continue;}
      Object.defineProperty(Type.prototype,p.property,{get(){if(frameworkType(p.result)?.kind==='collection')return this.$collections[p.property]??=collection(this,p.property);return this.$values[p.property];},set:p.readOnly?undefined:function(v){value(v);styles.validate(this,p.property,v);if(['Content','Child'].includes(p.property)&&v!==this.$values[p.property]){adopt(this,v);release(this,this.$values[p.property]);}styles.set(this,p.property,v);send({op:'set',id:this.$node.id,property:p.property,value:value(this.$values[p.property])});}});
    }
    for(const name of Object.keys(eventsFor(type))){Object.defineProperty(Type.prototype,name,{get(){return {add:handler=>this['add_'+name](handler),remove:handler=>this['remove_'+name](handler)};}});
      Type.prototype['add_'+name]=function(handler){if(typeof handler!=='function')throw new TypeError('Event handler must be a function');(this.$events[name]??=[]).push(handler);send({op:'event',id:this.$node.id,event:name,enabled:true});};
      Type.prototype['remove_'+name]=function(handler){const list=this.$events[name]??[],i=list.lastIndexOf(handler);if(i>=0)list.splice(i,1);send({op:'event',id:this.$node.id,event:name,enabled:!!list.length});};
    }
  }
  for(const [name,Type]of classes){const base=classes.get(frameworkType(name)?.base);if(base)Object.setPrototypeOf(Type.prototype,base.prototype);}
  for(const c of contracts){const Type=classes.get(c.owner);if(!Type||['get','set','constructor','eventAdd','eventRemove'].includes(c.kind))continue;
    const target=c.isStatic?Type:Type.prototype;if(Object.hasOwn(target,c.name))continue;
    target[c.name]=function(...args){const animated=animations.invoke(this,c,args);if(animated.handled)return animated.value;if(!c.isStatic){const styled=styles.invoke(this,c.name,args);if(styled.handled)return styled.value;}if(c.kind==='attachedSet'){const [o,v]=args;if(!o?.$node||o.$context!==objects)throw new TypeError('Attached property needs an application element');if(typeof v!=='number'||!Number.isFinite(v)||/Span$/.test(c.property)&&(!Number.isInteger(v)||v<1)||['Row','Column'].includes(c.property)&&(!Number.isInteger(v)||v<0))throw new RangeError('Invalid attached property');const k=['Left','Top'].includes(c.property)?'$'+c.property:c.property;if(!animations.setBase(o,k,v)){o.$values[k]=v;send({op:'set',id:o.$node.id,property:c.property,value:v});}return;}
      if(c.kind==='attachedGet')return args[0].$values[['Left','Top'].includes(c.property)?'$'+c.property:c.property]??(/Span$/.test(c.property)?1:0);
      if(c.name==='Activate'){send({op:'activate',id:this.$node.id});return;}
      if(c.name==='Close'){send({op:'close',id:this.$node.id});for(const h of this.$events.Closed??[])h(this,{OriginalSource:this});return;}
      if(c.name==='Exit'){for(const o of objects.values())if(o.$node.type===XAML+'Window')o.Close();return;}
      if(c.name==='Focus'){send({op:'focus',id:this.$node.id});return true;}
      if(c.name==='FindName'){const stack=[this],seen=new Set();while(stack.length){const o=stack.pop();if(seen.has(o))continue;seen.add(o);if(o.Name===args[0])return o;for(const v of Object.values(o.$values))if(v?.$node)stack.push(v);for(const list of Object.values(o.$collections))for(const child of list)if(child?.$node)stack.push(child);}return null;}
      if(c.owner===CONTROLS+'ContentDialog'&&['Show','Hide'].includes(c.name)){this.IsOpen=c.name==='Show';return;}
      if(c.name==='ShowAt'||c.name==='Hide'){send({op:'flyout',id:this.$node.id,anchor:args[0]?.$node.id,show:c.name==='ShowAt'});return;}
      if(['Clear','FillRectangle','DrawLine'].includes(c.name)){if(c.name==='Clear')this.$drawing=[];else (this.$drawing??=[]).push({op:c.name,args});send({op:'draw',id:this.$node.id,commands:[...(this.$drawing??[])]});return;}
      if(c.name==='FromArgb')return immutable('Windows.UI.Color',args);
      throw new Error('Unsupported JavaScript method '+c.owner+'::'+c.name);
    };
  }
  const timespan=classes.get('System.TimeSpan');if(timespan){timespan.FromMilliseconds=n=>immutable('System.TimeSpan',[n]);timespan.FromSeconds=n=>immutable('System.TimeSpan',[n*1000]);timespan.FromMinutes=n=>immutable('System.TimeSpan',[n*60000]);}
  const color=namespaces.Windows?.UI?.Color;if(color)color.FromArgb=(...args)=>immutable('Windows.UI.Color',args);
  const grid=classes.get(XAML+'GridLength');if(grid&&!Object.hasOwn(grid,'Auto'))Object.defineProperty(grid,'Auto',{get:()=>immutable(XAML+'GridLength',[1,0])});
  return {...namespaces,host,advanceAnimations:ms=>animations.advance(ms),animationState:id=>animations.clock.state(id?.$node?.id??id),flush:()=>host.flush(),settled:()=>host.settled(),setRenderer:mode=>host.setBackend(mode),dispose(){if(disposed)return;animations.dispose();disposed=true;host.dispose();objects.clear();}};
}
