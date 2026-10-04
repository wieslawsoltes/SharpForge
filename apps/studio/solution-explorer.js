import {storage,storageKeys} from './settings/storage.js';
import {TreeModel,TreeView} from '../../packages/controls/src/index.js';
import {renderSolutionExplorer} from './solution-explorer-render.js';

/** View-only explorer. All changes go through the workspace command boundary. */
export class SolutionExplorer {
 constructor(element,{getData,onOpen,onCommand,onMenu,onProperties,onError}){
  Object.assign(this,{element,getData,onOpen,onCommand,onMenu,onProperties,onError});this.showAll=false;this.view='solution';this.track=true;this.scope=null;
  this.tree=element.querySelector('#file-tree');this.search=element.querySelector('#file-filter');this.search.placeholder='Search Solution Explorer (Ctrl+;)';
  this.search.setAttribute('aria-label','Search Solution Explorer');
  for(const item of element.querySelectorAll('.solution-heading,.project-heading,.dependency-row,.explorer-bottom'))item.hidden=true;
  const toolbar=element.ownerDocument.createElement('div');toolbar.className='explorer-toolbar';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','Solution Explorer');
  const button=(id,title,text,action)=>{const b=element.ownerDocument.createElement('button');b.type='button';b.title=title;b.setAttribute('aria-label',title);b.dataset.explorerAction=id;b.textContent=text;b.onclick=()=>this.safe(action);toolbar.append(b);return b;};
  button('home','Home — entire solution','⌂',()=>{this.scope=null;this.search.value='';this.render(true);});
  button('sync','Sync with Active Document','⇥',()=>this.reveal(this.getData().active,true));
  button('collapse','Collapse All','⊟',()=>{this.model.expandAll(false);this.tree.scrollTop=0;this.tree.focus();});
  button('refresh','Refresh workspace','↻',()=>this.onCommand('refresh',null,[]));
  this.allButton=button('show-all','Show All Files','▧',()=>{this.showAll=!this.showAll;this.render(true);});
  this.viewButton=button('view','Switch Solution / Folder View','▰',()=>{this.view=this.view==='solution'?'folders':'solution';this.scope=null;this.render(true);});
  button('add','Add new item','＋',()=>this.onCommand('new-file',this.selected()[0],this.selected()));
  button('options','Explorer options','⌄',()=>{const r=toolbar.getBoundingClientRect();this.onMenu({x:r.right-220,y:r.bottom,anchor:toolbar.lastChild,document:toolbar.ownerDocument,items:[{label:'Track Active Item',checked:this.track,action:()=>{this.track=!this.track;this.saveState();}},{label:'Show All Files',checked:this.showAll,action:()=>{this.showAll=!this.showAll;this.render(true);}},{label:'Solution view',radio:true,checked:this.view==='solution',action:()=>{this.view='solution';this.scope=null;this.render(true);}},{label:'Folder view',radio:true,checked:this.view==='folders',action:()=>{this.view='folders';this.scope=null;this.render(true);}},null,{label:'Expand All',action:()=>this.model.expandAll(true)},{label:'Collapse All',action:()=>this.model.expandAll(false)}]});});
  element.prepend(toolbar);this.toolbar=toolbar;
  this.caption=element.ownerDocument.createElement('div');this.caption.className='explorer-caption';this.caption.setAttribute('role','status');this.tree.before(this.caption);
  this.model=new TreeModel();this.model.subscribe(()=>this.saveState());
  this.control=new TreeView(this.tree,{model:this.model,label:'Solution Explorer',onOpen:node=>this.safe(()=>this.onOpen(node)),onSelect:(nodes,node,event)=>{this.onProperties?.(nodes);if(node&&['source','generated'].includes(node.kind)&&!event?.ctrlKey&&!event?.metaKey&&!event?.shiftKey&&event?.type==='click')this.safe(()=>this.onOpen(node,{preview:true}));},onContextMenu:({node,selection,event,anchor,x,y})=>this.context(node,selection,{clientX:x??event.clientX,clientY:y??event.clientY,currentTarget:this.tree,target:anchor??event.target}),onCommand:(command,node,nodes)=>this.safe(()=>this.onCommand(command,node,nodes)),onDrop:(nodes,target,{copy})=>this.onCommand(copy?'copy-to':'move-to',target,nodes),onError});
  this.search.oninput=()=>{this.model.setFilter(this.search.value);this.updateCaption();};this.search.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();this.search.value='';this.model.setFilter('');this.tree.focus();this.updateCaption();}else if(e.key==='ArrowDown'){e.preventDefault();this.tree.focus();}};
  this.element.addEventListener('contextmenu',e=>{if(!e.defaultPrevented&&!this.tree.contains(e.target)){e.preventDefault();e.stopPropagation();this.context(this.selected()[0]??this.model.roots[0],this.selected(),e);}});
  this.tree.addEventListener('contextmenu',e=>{if(e.target===this.tree||e.target.classList.contains('sf-tree-canvas')){e.preventDefault();e.stopPropagation();this.context(this.model.roots[0],[],e);}});
 }
 safe(action){return Promise.resolve().then(action).catch(error=>this.onError?.(error));}
 selected(){return this.model.selectionRoots().map(id=>this.model.nodes.get(id));}
 context(node,nodes,event){this.onCommand('context',node,nodes,event);}
 saveState(){if(!this.key||this.restoring)return;try{storage.setItem(storageKeys.explorer+this.key,JSON.stringify({version:1,tree:this.model.snapshot(),view:this.view,showAll:this.showAll,track:this.track}));}catch{}}
 render(force=false){return renderSolutionExplorer(this,force);}
 updateCaption(){const data=this.getData(),matches=this.model.query?this.model.rows().filter(r=>r.match).length:null;this.caption.textContent=(data.native?'Native disk workspace':'Browser workspace')+(this.scope?' · scoped':'')+(matches!==null?' · '+matches+' matches':'');this.caption.title=data.native?'File changes are conflict-checked on disk. Native build evaluation requires separate trust.':'File membership changes are saved in browser recovery. Export the workspace or use the native host for disk file operations.';}
 reveal(path,focus=false){const node=[...this.model.nodes.values()].find(n=>n.path===path&&n.kind==='source')??[...this.model.nodes.values()].find(n=>n.path===path&&!n.branch);if(!node)return false;if(this.model.query){this.search.value='';this.model.setFilter('');}this.model.reveal(node.id);this.onProperties?.([node]);this.control.ensureVisible();if(focus)this.tree.focus();return true;}
 scopeTo(node){this.scope=node.id;this.render(true);this.tree.focus();}
 snapshot(){return {...this.model.snapshot(),view:this.view,showAll:this.showAll,scope:this.scope,rows:this.model.rows().map(r=>({id:r.id,label:r.node.label,path:r.node.path,kind:r.node.kind,level:r.level})),rendered:this.control.rendered};}
}
