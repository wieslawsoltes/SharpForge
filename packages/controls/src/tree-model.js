/** Framework-independent tree state. IDs are stable identities, never DOM selectors. */
export class TreeModel {
  constructor(nodes=[], {maxNodes=200000,maxDepth=128}={}) {
    this.maxNodes=maxNodes;this.maxDepth=maxDepth;this.expanded=new Set();this.selected=new Set();
    this.focused=null;this.anchor=null;this.query='';this.listeners=new Set();this.revision=0;this.setNodes(nodes);
  }
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  notify(){this.revision++;this.cachedRows=null;for(const fn of this.listeners)fn(this);}
  setNodes(roots){
    if(!Array.isArray(roots))throw new TypeError('Tree roots must be an array');
    const nodes=new Map(),parents=new Map();
    const visit=(items,parent,depth)=>items.map(raw=>{
      if(depth>this.maxDepth||nodes.size>=this.maxNodes)throw new RangeError('Tree size/depth limit exceeded');
      if(!raw||typeof raw.id!=='string'||!raw.id||raw.id.length>8192||nodes.has(raw.id))throw new Error('Tree IDs must be unique nonempty strings');
      if(raw.children!==undefined&&!Array.isArray(raw.children))throw new TypeError('Tree children must be an array');
      const node={...raw,label:String(raw.label??raw.id),children:[]};nodes.set(node.id,node);parents.set(node.id,parent);
      node.children=visit(raw.children??[],node.id,depth+1);return node;
    });
    const next=visit(roots,null,1); // Validate before replacing any state.
    this.roots=next;this.nodes=nodes;this.parents=parents;
    this.expanded=new Set([...this.expanded].filter(id=>nodes.has(id)));
    for(const n of nodes.values())if(n.defaultExpanded&&!this.seen?.has(n.id))this.expanded.add(n.id);
    this.seen=new Set([...(this.seen??[]),...nodes.keys()]);if(this.seen.size>this.maxNodes*2)this.seen=new Set(nodes.keys());
    this.selected=new Set([...this.selected].filter(id=>nodes.has(id)));
    if(!nodes.has(this.focused))this.focused=next[0]?.id??null;
    if(!nodes.has(this.anchor))this.anchor=this.focused;this.notify();
  }
  isBranch(id){const node=this.nodes.get(id);return !!node&&(node.children.length>0||node.branch===true);}
  ancestors(id){const path=[];for(let p=this.parents.get(id);p!==null&&p!==undefined;p=this.parents.get(p))path.push(p);return path;}
  setFilter(query){query=String(query??'').slice(0,2048).trim().toLocaleLowerCase();if(query===this.query)return;this.query=query;this.notify();const rows=this.rows();if(!rows.some(r=>r.id===this.focused)){this.focused=rows[0]?.id??null;this.notify();}}
  rows(){
    if(this.cachedRows)return this.cachedRows;
    const query=this.query,visible=query?new Set():null,matches=query?new Set():null;
    if(query)for(const n of this.nodes.values())if((n.label+' '+(n.searchText??'')).toLocaleLowerCase().includes(query)){matches.add(n.id);visible.add(n.id);for(const a of this.ancestors(n.id))visible.add(a);}
    const rows=[];const walk=(items,level)=>{
      const included=visible?items.filter(n=>visible.has(n.id)):items;
      included.forEach((node,i)=>{rows.push({id:node.id,node,level,pos:i+1,size:included.length,expanded:query?true:this.expanded.has(node.id),match:matches?.has(node.id)??false});
        if(query||this.expanded.has(node.id))walk(node.children,level+1);
      });
    };walk(this.roots,1);return this.cachedRows=rows;
  }
  expand(id,value=true){if(!this.isBranch(id))return;if(value)this.expanded.add(id);else this.expanded.delete(id);this.notify();}
  expandAll(value=true,id=null){const visit=n=>{if(this.isBranch(n.id)){if(value)this.expanded.add(n.id);else this.expanded.delete(n.id);}n.children.forEach(visit);};(id?[this.nodes.get(id)].filter(Boolean):this.roots).forEach(visit);this.notify();}
  reveal(id,{select=true}={}){if(!this.nodes.has(id))return false;for(const a of this.ancestors(id))this.expanded.add(a);if(select){this.selected=new Set([id]);this.anchor=id;}this.focused=id;this.notify();return true;}
  select(id,{toggle=false,range=false,focusOnly=false,add=false}={}){
    if(!this.nodes.has(id))return;
    this.focused=id;
    if(!focusOnly){
      if(range&&this.anchor){const ids=this.rows().map(r=>r.id),a=ids.indexOf(this.anchor),b=ids.indexOf(id);if(a>=0&&b>=0){if(!add)this.selected.clear();for(const n of ids.slice(Math.min(a,b),Math.max(a,b)+1))this.selected.add(n);}else this.selected=new Set([id]);}
      else if(toggle){if(this.selected.has(id))this.selected.delete(id);else this.selected.add(id);this.anchor=id;}
      else {this.selected=new Set([id]);this.anchor=id;}
    }
    this.notify();
  }
  selectionRoots(){return [...this.selected].filter(id=>!this.ancestors(id).some(p=>this.selected.has(p)));}
  move(ids,parentId,beforeId=null){
    if(!Array.isArray(ids)||new Set(ids).size!==ids.length)throw new Error('Invalid tree move');
    const selected=new Set(ids);for(const id of ids){if(!this.nodes.has(id)||id===parentId||this.ancestors(parentId).includes(id))throw new Error('Cannot move a tree node into itself or its descendants');}
    if(parentId!==null&&!this.nodes.has(parentId))throw new Error('Destination not found');
    const rootIds=ids.filter(id=>!this.ancestors(id).some(a=>selected.has(a)));
    const destination=parentId===null?this.roots:this.nodes.get(parentId).children;
    if(beforeId!==null&&(!destination.some(n=>n.id===beforeId)||selected.has(beforeId)))throw new Error('Invalid insertion point');
    const moving=rootIds.map(id=>this.nodes.get(id));
    for(const id of rootIds){const parent=this.parents.get(id),items=parent===null?this.roots:this.nodes.get(parent).children;items.splice(items.findIndex(n=>n.id===id),1);this.parents.set(id,parentId);}
    destination.splice(beforeId===null?destination.length:destination.findIndex(n=>n.id===beforeId),0,...moving);if(parentId)this.expanded.add(parentId);this.notify();
  }
  snapshot(){return {version:1,expanded:[...this.expanded],selected:[...this.selected],focused:this.focused,anchor:this.anchor};}
  restore(value){if(value?.version!==1||!Array.isArray(value.expanded)||!Array.isArray(value.selected))throw new Error('Invalid tree state');this.expanded=new Set(value.expanded.filter(id=>this.nodes.has(id)));this.selected=new Set(value.selected.filter(id=>this.nodes.has(id)));this.focused=this.nodes.has(value.focused)?value.focused:this.roots[0]?.id??null;this.anchor=this.nodes.has(value.anchor)?value.anchor:this.focused;this.notify();}
}
