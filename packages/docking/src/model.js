/** Framework-neutral docking model. All changes are validated, transactional and undoable. */
const clone=value=>JSON.parse(JSON.stringify(value));
const sides=['left','right','top','bottom'];
export const createGroup=(id,panels=[],kind='tool')=>({type:'group',id,kind,panels:[...panels],active:panels[0]??null});
export const createSplit=(id,axis,first,second,ratio=.5)=>({type:'split',id,axis,ratio,first,second});
export function walkLayout(node,visit,parent=null){if(!node)return;visit(node,parent);if(node.type==='split'){walkLayout(node.first,visit,node);walkLayout(node.second,visit,node);}}
export class DockLayout {
  constructor(panels=[],layout=null,{historyLimit=50,keepEmptyDocuments=true}={}){
    this.panels=new Map();this.listeners=new Set();this.undoStack=[];this.redoStack=[];this.historyLimit=historyLimit;this.keepEmptyDocuments=keepEmptyDocuments;this.serial=0;
    for(const panel of panels)this.register(panel);
    this.state=layout?clone(layout):{version:1,root:createGroup('documents',[],'document'),floating:[],autoHide:{left:[],right:[],top:[],bottom:[]},closed:[...this.panels.keys()],activePanel:null};
    this.validate(this.state);
  }
  register(panel){if(!panel||typeof panel.id!=='string'||!panel.id||panel.id.length>1024||this.panels.has(panel.id))throw new Error('Panel identifier must be unique');this.panels.set(panel.id,{title:panel.id,kind:'tool',closable:true,...panel});if(this.state)this.state.closed.push(panel.id);return panel.id;}
  unregister(id){this.require(id);this.change('unregister',()=>{this.detach(id);this.state.closed=this.state.closed.filter(x=>x!==id);this.panels.delete(id);if(this.state.activePanel===id)this.state.activePanel=null;});this.undoStack=[];this.redoStack=[];}
  require(id){const panel=this.panels.get(id);if(!panel)throw new Error(`Unknown docking panel '${id}'`);return panel;}
  id(prefix){const ids=new Set();this.visit(n=>ids.add(n.id));for(const f of this.state.floating)ids.add(f.id);let id;do{id=`${prefix}-${++this.serial}`;}while(ids.has(id));return id;}
  visit(visitor){walkLayout(this.state.root,visitor);for(const floating of this.state.floating)walkLayout(floating.root,visitor);}
  groups(){const all=[];this.visit(n=>{if(n.type==='group')all.push(n);});return all;}
  group(id){return this.groups().find(g=>g.id===id);}
  locate(id){for(const group of this.groups()){const index=group.panels.indexOf(id);if(index>=0)return {kind:'group',group,index};}for(const side of sides)if(this.state.autoHide[side].includes(id))return {kind:'autoHide',side};return {kind:'closed'};}
  subscribe(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  notify(type){for(const listener of this.listeners)listener({type,layout:this});}
  snapshot(){return clone(this.state);}
  serialize(){return JSON.stringify(this.state);}
  validate(state){
    if(state?.version!==1||!Array.isArray(state.floating)||state.floating.length>64||!Array.isArray(state.closed))throw new Error('Invalid docking layout');
    const nodes=new Set(),placed=new Set();let count=0;
    const panel=id=>{if(typeof id!=='string'||!this.panels.has(id)||placed.has(id))throw new Error(`Unknown or duplicate panel '${id}' in layout`);placed.add(id);};
    const node=(n,depth=0)=>{if(!n||depth>32||++count>512||typeof n.id!=='string'||!n.id||nodes.has(n.id))throw new Error('Invalid or duplicate docking node');nodes.add(n.id);
      if(n.type==='group'){if(!['tool','document'].includes(n.kind)||!Array.isArray(n.panels))throw new Error('Invalid docking group');n.panels.forEach(panel);if(n.active!==null&&!n.panels.includes(n.active))throw new Error('Active panel is not in its group');if(n.panels.length&&!n.active)throw new Error('Nonempty group needs an active panel');}
      else if(n.type==='split'){if(!['horizontal','vertical'].includes(n.axis)||!Number.isFinite(n.ratio)||n.ratio<.05||n.ratio>.95)throw new Error('Invalid split ratio');node(n.first,depth+1);node(n.second,depth+1);}else throw new Error('Unknown docking node type');
    };
    node(state.root);
    for(const f of state.floating){if(typeof f.id!=='string'||nodes.has(f.id))throw new Error('Invalid floating identifier');nodes.add(f.id);for(const k of ['x','y','width','height'])if(!Number.isFinite(f[k]))throw new Error('Invalid floating bounds');if(f.width<160||f.height<100||Math.abs(f.x)>100000||Math.abs(f.y)>100000||f.width>20000||f.height>20000)throw new Error('Floating bounds outside limits');node(f.root);}
    for(const side of sides){if(!Array.isArray(state.autoHide?.[side]))throw new Error('Invalid auto-hide shelf');state.autoHide[side].forEach(panel);}state.closed.forEach(panel);
    if(placed.size!==this.panels.size)throw new Error('Layout must place or close every registered panel');
    if(state.activePanel!==null&&!this.panels.has(state.activePanel))throw new Error('Invalid active panel');return true;
  }
  change(type,action,{history=true}={}){const previous=this.snapshot();try{action();this.normalize();this.validate(this.state);}catch(error){this.state=previous;throw error;}if(JSON.stringify(previous)===this.serialize())return false;if(history){this.undoStack.push(previous);if(this.undoStack.length>this.historyLimit)this.undoStack.shift();this.redoStack=[];}this.notify(type);return true;}
  normalize(){
    const trim=n=>{if(n.type==='group'){if(!n.panels.includes(n.active))n.active=n.panels[0]??null;return n.panels.length||n.kind==='document'&&this.keepEmptyDocuments?n:null;}n.first=trim(n.first);n.second=trim(n.second);return n.first&&n.second?n:n.first??n.second;};
    this.state.root=trim(this.state.root)??createGroup(this.id('documents'),[],'document');
    this.state.floating=this.state.floating.map(f=>({...f,root:trim(f.root)})).filter(f=>f.root);
  }
  detach(id){for(const group of this.groups()){const i=group.panels.indexOf(id);if(i>=0){group.panels.splice(i,1);if(group.active===id)group.active=group.panels[Math.min(i,group.panels.length-1)]??null;}}for(const side of sides)this.state.autoHide[side]=this.state.autoHide[side].filter(x=>x!==id);this.state.closed=this.state.closed.filter(x=>x!==id);}
  replaceNode(id,replacement){let replaced=false;const replace=n=>{if(n.id===id){replaced=true;return replacement;}if(n.type==='split'){n.first=replace(n.first);n.second=replace(n.second);}return n;};this.state.root=replace(this.state.root);for(const f of this.state.floating)f.root=replace(f.root);if(!replaced)throw new Error('Dock target no longer exists');}
  activate(id){this.require(id);const where=this.locate(id);if(where.kind==='closed')return this.open(id);return this.change('activate',()=>{if(where.group)where.group.active=id;this.state.activePanel=id;},{history:false});}
  open(id,target=null){this.require(id);const where=this.locate(id);if(where.kind==='group')return this.activate(id);const group=target?this.group(target):this.groups().find(g=>g.kind===this.panels.get(id).kind)??this.groups()[0];if(!group)throw new Error('No docking group');return this.dock(id,group.id,'center');}
  close(id){if(!this.require(id).closable)throw new Error('This panel cannot be closed');return this.change('close',()=>{this.detach(id);this.state.closed.push(id);if(this.state.activePanel===id)this.state.activePanel=null;});}
  dock(id,targetId,side='center',index=null){
    const panel=this.require(id);if(!['center',...sides].includes(side))throw new Error('Invalid dock direction');
    const target=this.group(targetId);if(!target)throw new Error('Unknown dock group');
    return this.change('dock',()=>{this.detach(id);if(side==='center'){const at=index===null?target.panels.length:Math.max(0,Math.min(target.panels.length,index));target.panels.splice(at,0,id);target.active=id;}
      else {const group=createGroup(this.id('group'),[id],panel.kind),first=['left','top'].includes(side);const split=createSplit(this.id('split'),['left','right'].includes(side)?'horizontal':'vertical',first?group:target,first?target:group,.5);this.replaceNode(target.id,split);}this.state.activePanel=id;});
  }
  dockRoot(id,side){this.require(id);if(!sides.includes(side))throw new Error('Invalid root direction');return this.change('dock',()=>{this.detach(id);const group=createGroup(this.id('group'),[id],this.panels.get(id).kind),first=['left','top'].includes(side);this.state.root=createSplit(this.id('split'),['left','right'].includes(side)?'horizontal':'vertical',first?group:this.state.root,first?this.state.root:group,first?.23:.77);this.state.activePanel=id;});}
  float(id,bounds={}){const panel=this.require(id);return this.change('float',()=>{this.detach(id);this.state.floating.push({id:this.id('float'),x:80,y:70,width:640,height:400,...bounds,root:createGroup(this.id('group'),[id],panel.kind)});this.state.activePanel=id;});}
  autoHide(id,side='left'){if(this.require(id).kind==='document')throw new Error('Documents cannot auto-hide');if(!sides.includes(side))throw new Error('Invalid auto-hide side');return this.change('autoHide',()=>{this.detach(id);this.state.autoHide[side].push(id);this.state.activePanel=id;});}
  resize(id,ratio,{history=true}={}){if(!Number.isFinite(ratio))throw new Error('Invalid split ratio');let target;this.visit(n=>{if(n.id===id)target=n;});if(target?.type!=='split')throw new Error('Not a split');return this.change('resize',()=>target.ratio=Math.max(.05,Math.min(.95,ratio)),{history});}
  bounds(id,bounds,{history=true}={}){const f=this.state.floating.find(x=>x.id===id);if(!f)throw new Error('Unknown floating group');return this.change('bounds',()=>{for(const key of ['x','y','width','height'])if(bounds[key]!==undefined)f[key]=bounds[key];},{history});}
  restore(serialized){const next=typeof serialized==='string'?JSON.parse(serialized):clone(serialized);this.validate(next);return this.change('restore',()=>{this.state=next;});}
  undo(){if(!this.undoStack.length)return false;const next=this.undoStack.pop();this.validate(next);this.redoStack.push(this.snapshot());this.state=next;this.notify('undo');return true;}
  redo(){if(!this.redoStack.length)return false;const next=this.redoStack.pop();this.validate(next);this.undoStack.push(this.snapshot());this.state=next;this.notify('redo');return true;}
}
