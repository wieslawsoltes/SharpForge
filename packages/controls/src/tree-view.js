import {setTreeRowAttributes} from './tree-row.js';
import {TreeModel} from './tree-model.js';
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
let treeId=0;
/** Fixed-row-height virtualization with ARIA tree semantics and independent focus/selection. */
export class TreeView {
 constructor(element,{model=new TreeModel(),label='Tree',rowHeight=24,overscan=6,onOpen=()=>{},onSelect=()=>{},onContextMenu=()=>{},onCommand=()=>{},onDrop=null,onExpand=null,onError=()=>{}}={}){
  Object.assign(this,{element,model,rowHeight,overscan,onOpen,onSelect,onContextMenu,onCommand,onDrop,onExpand,onError});this.id='sf-tree-'+(++treeId);this.typeText='';this.typeTime=0;this.disposed=false;
  element.classList.add('sf-tree');element.setAttribute('role','tree');element.setAttribute('aria-label',label);element.setAttribute('aria-multiselectable','true');element.tabIndex=0;
  const doc=element.ownerDocument;this.canvas=doc.createElement('div');this.canvas.className='sf-tree-canvas';this.canvas.setAttribute('role','presentation');element.replaceChildren(this.canvas);
  this.handlers={scroll:()=>this.render(),keydown:e=>this.keydown(e),click:e=>this.click(e),dblclick:e=>{const r=this.row(e);if(r){e.preventDefault();this.open(r.node);}},contextmenu:e=>this.context(e),dragstart:e=>this.dragStart(e),dragover:e=>this.dragOver(e),dragleave:e=>{if(!element.contains(e.relatedTarget))this.clearDrop();},drop:e=>this.drop(e),dragend:()=>this.clearDrop()};
  for(const [event,handler]of Object.entries(this.handlers))element.addEventListener(event,handler);
  this.unsubscribe=model.subscribe(()=>{this.render();});this.resize=new ResizeObserver(()=>{if(!this.disposed)this.render();});this.resize.observe(element);this.render();
 }
 row(e){const row=e.target.closest?.('[data-tree-id]');return row&&this.element.contains(row)?{element:row,node:this.model.nodes.get(row.dataset.treeId)}:null;}
 render(){
  if(this.disposed)return;const rows=this.model.rows(),height=this.element.clientHeight||300,first=Math.max(0,Math.floor(this.element.scrollTop/this.rowHeight)-this.overscan),last=Math.min(rows.length,first+Math.ceil(height/this.rowHeight)+this.overscan*2);
  this.canvas.style.height=rows.length*this.rowHeight+'px';this.canvas.style.minHeight='100%';
  // Preserve row elements across selection/focus updates. Replacing the clicked DOM
  // node between the two clicks suppresses native dblclick and disrupts drag/focus.
  const window=rows.slice(first,last),existing=new Map([...this.canvas.children].filter(el=>el.dataset.treeId).map(el=>[el.dataset.treeId,el])),retained=new Set();
  for(let i=0;i<window.length;i++){
   const r=window[i],n=r.node,selected=this.model.selected.has(n.id),focus=this.model.focused===n.id,branch=this.model.isBranch(n.id),domId=this.id+'-'+(first+i),icon=n.icon??(branch?'▰':'◇');
   const el=existing.get(n.id)??this.element.ownerDocument.createElement('div');retained.add(el);
   el.id=domId;el.className=`sf-tree-row ${selected?'selected':''} ${focus?'focused':''} ${n.excluded?'excluded':''} ${n.startup?'startup':''}`;
   setTreeRowAttributes(el,r,selected);
   if(branch)el.setAttribute('aria-expanded',String(r.expanded));else el.removeAttribute('aria-expanded');
   if(n.path)el.dataset.file=n.path;else delete el.dataset.file;
   el.draggable=!!this.onDrop&&n.draggable!==false;
   el.style.cssText=`top:${(first+i)*this.rowHeight}px;height:${this.rowHeight}px;padding-left:${(r.level-1)*16+3}px`;
   const content=`<span class="sf-tree-toggle" aria-hidden="true">${branch?(r.expanded?'▾':'▸'):''}</span><span class="sf-tree-icon ${escape(n.kind??'item')}" aria-hidden="true">${escape(icon)}</span><span class="sf-tree-label">${escape(n.label)}</span>${n.badge?`<span class="sf-tree-badge">${escape(n.badge)}</span>`:''}${n.dirty?'<span class="sf-tree-dirty" title="Unsaved changes">●</span>':''}`;
   if(el.sfTreeContent!==content){el.innerHTML=content;el.sfTreeContent=content;}
   if(this.canvas.children[i]!==el)this.canvas.insertBefore(el,this.canvas.children[i]??null);
  }
  for(const el of [...this.canvas.children])if(!retained.has(el))el.remove();
  if(!rows.length){const empty=this.element.ownerDocument.createElement('div');empty.className='sf-tree-empty';empty.setAttribute('role','status');empty.textContent='No matching items';this.canvas.append(empty);}
  const focusedIndex=rows.findIndex(r=>r.id===this.model.focused);if(focusedIndex>=first&&focusedIndex<last)this.element.setAttribute('aria-activedescendant',this.id+'-'+focusedIndex);else this.element.removeAttribute('aria-activedescendant');
  this.rendered={first,last,total:rows.length,count:window.length};
 }
 ensureVisible(id=this.model.focused){const index=this.model.rows().findIndex(r=>r.id===id);if(index<0)return;const top=index*this.rowHeight,bottom=top+this.rowHeight,height=this.element.clientHeight||300;if(top<this.element.scrollTop)this.element.scrollTop=top;else if(bottom>this.element.scrollTop+height)this.element.scrollTop=bottom-height;this.render();}
 focus(id=this.model.focused){if(id)this.model.reveal(id,{select:false});this.ensureVisible(id);this.element.focus({preventScroll:true});}
 click(e){const r=this.row(e);if(!r?.node)return;this.element.focus({preventScroll:true});if(e.target.closest('.sf-tree-toggle')&&this.model.isBranch(r.node.id)){this.expand(r.node.id,!this.model.expanded.has(r.node.id));return;}this.model.select(r.node.id,{toggle:e.ctrlKey||e.metaKey,range:e.shiftKey,add:e.shiftKey&&(e.ctrlKey||e.metaKey)});this.onSelect(this.selection(),r.node,e);}
 async expand(id,value){this.model.expand(id,value);try{if(value)await this.onExpand?.(this.model.nodes.get(id));}catch(error){this.onError(error);}}
 open(node){if(node.kind==='folder'||node.kind==='solution-folder'||node.kind==='dependencies'||node.kind==='dependency-group')this.expand(node.id,!this.model.expanded.has(node.id));else this.onOpen(node);}
 selection(){return [...this.model.selected].map(id=>this.model.nodes.get(id)).filter(Boolean);}
 context(e){const r=this.row(e);if(!r?.node)return;e.preventDefault();e.stopPropagation();if(!this.model.selected.has(r.node.id))this.model.select(r.node.id);else {this.model.focused=r.node.id;this.model.notify();}this.onContextMenu({node:r.node,selection:this.selection(),event:e,anchor:this.element});}
 keydown(e){
  if(e.isComposing||e.altKey&&e.key!=='Enter'&&!(e.shiftKey&&e.key.toLowerCase()==='a'))return;const rows=this.model.rows();if(!rows.length)return;
  const mod=e.ctrlKey||e.metaKey;let index=Math.max(0,rows.findIndex(r=>r.id===this.model.focused)),next=index;const row=rows[index];
  if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();e.stopPropagation();this.ensureVisible();const el=[...this.canvas.children].find(el=>el.dataset.treeId===row.id);const rect=el?.getBoundingClientRect()??this.element.getBoundingClientRect();this.onContextMenu({node:row.node,selection:this.selection().length?this.selection():[row.node],event:e,anchor:el,x:rect.left+30,y:rect.bottom});return;}
  if(e.key==='ArrowDown')next=Math.min(rows.length-1,index+1);else if(e.key==='ArrowUp')next=Math.max(0,index-1);else if(e.key==='Home')next=0;else if(e.key==='End')next=rows.length-1;else if(e.key==='PageDown')next=Math.min(rows.length-1,index+Math.max(1,Math.floor(this.element.clientHeight/this.rowHeight)));else if(e.key==='PageUp')next=Math.max(0,index-Math.max(1,Math.floor(this.element.clientHeight/this.rowHeight)));
  else if(e.key==='ArrowRight'){if(this.model.isBranch(row.id)&&!row.expanded)this.expand(row.id,true);else if(row.node.children.length)next=index+1;}
  else if(e.key==='ArrowLeft'){if(row.expanded&&this.model.isBranch(row.id))this.expand(row.id,false);else{const parent=this.model.parents.get(row.id);if(parent)next=rows.findIndex(r=>r.id===parent);}}
  else if(e.key==='*'){for(const r of rows)if(this.model.parents.get(r.id)===this.model.parents.get(row.id))this.model.expand(r.id,true);}
  else if(e.key==='Enter'&&!e.altKey){this.open(row.node);}
  else if(e.key==='Backspace'){const parent=this.model.parents.get(row.id);if(parent)next=rows.findIndex(r=>r.id===parent);}
  else if(mod&&e.key.toLowerCase()==='z'){this.onCommand('undo',row.node,this.selection());}
  else if((mod&&e.shiftKey||e.altKey&&e.shiftKey)&&e.key.toLowerCase()==='a'){this.onCommand(e.altKey?'add-existing':'new-file',row.node,this.selection());}
  else if(e.key===' '){this.model.select(row.id,{toggle:mod,range:e.shiftKey});this.onSelect(this.selection(),row.node,e);}
  else if(mod&&e.key.toLowerCase()==='a'){this.model.selected=new Set(rows.map(r=>r.id));this.model.notify();this.onSelect(this.selection(),row.node,e);}
  else if(['F2','Delete','Backspace'].includes(e.key)||e.altKey&&e.key==='Enter'||mod&&['c','x','v'].includes(e.key.toLowerCase())){this.onCommand(e.key==='F2'?'rename':e.key==='Delete'?'delete':e.key==='Backspace'?'parent':e.altKey?'properties':({c:'copy',x:'cut',v:'paste'})[e.key.toLowerCase()],row.node,this.selection());}
  else if(!mod&&!e.altKey&&e.key.length===1){const now=Date.now();this.typeText=now-this.typeTime>800?e.key:this.typeText+e.key;this.typeTime=now;const query=this.typeText.toLocaleLowerCase();let found=-1;for(let i=1;i<=rows.length;i++){const at=(index+i)%rows.length;if(rows[at].node.label.toLocaleLowerCase().startsWith(query)){found=at;break;}}if(found>=0)next=found;}
  else return;
  e.preventDefault();e.stopPropagation();if(next!==index){this.model.select(rows[next].id,{range:e.shiftKey,focusOnly:mod&&!e.shiftKey,add:mod&&e.shiftKey});this.onSelect(this.selection(),rows[next].node,e);}this.ensureVisible();
 }
 dragStart(e){const r=this.row(e);if(!this.onDrop||!r||r.node.draggable===false){e.preventDefault();return;}if(!this.model.selected.has(r.node.id))this.model.select(r.node.id);const ids=this.model.selectionRoots();e.dataTransfer.setData('application/x-sharpforge-tree',JSON.stringify({tree:this.id,ids}));e.dataTransfer.effectAllowed='copyMove';}
 dragOver(e){const r=this.row(e);if(!r||!this.onDrop||r.node.dropTarget===false||!this.model.isBranch(r.node.id)||!e.dataTransfer.types.includes('application/x-sharpforge-tree'))return;e.preventDefault();e.dataTransfer.dropEffect=e.ctrlKey||e.metaKey?'copy':'move';if(this.dropId!==r.node.id){this.clearDrop();this.dropId=r.node.id;r.element.classList.add('drop-target');this.hoverTimer=setTimeout(()=>{if(this.dropId)this.expand(this.dropId,true);},700);}}
 clearDrop(){clearTimeout(this.hoverTimer);this.dropId=null;for(const el of this.canvas.querySelectorAll('.drop-target'))el.classList.remove('drop-target');}
 async drop(e){const r=this.row(e);this.clearDrop();if(!r||!this.onDrop)return;e.preventDefault();try{const text=e.dataTransfer.getData('application/x-sharpforge-tree');if(text.length>1_000_000)throw new Error('Tree drag payload exceeds limit');const data=JSON.parse(text);if(data.tree!==this.id||!Array.isArray(data.ids))throw new Error('Items must come from the same explorer');await this.onDrop(data.ids.map(id=>this.model.nodes.get(id)).filter(Boolean),r.node,{copy:e.ctrlKey||e.metaKey});}catch(error){this.onError(error);}}
 dispose(){this.disposed=true;clearTimeout(this.hoverTimer);this.unsubscribe();this.resize.disconnect();for(const [event,handler]of Object.entries(this.handlers))this.element.removeEventListener(event,handler);this.element.replaceChildren();}
}
