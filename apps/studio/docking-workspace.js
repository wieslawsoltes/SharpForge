import {storage,storageKeys} from './settings/storage.js';
import {toolDefinitions} from './tools/definitions.js';
export {toolDefinitions} from './tools/definitions.js';
import { DockLayout, DockHost, createGroup, createSplit } from '../../packages/docking/src/index.js';

export function defaultDockLayout(){
  const documents=createGroup('documents',[],'document'),bottom=createGroup('tools-bottom',['output','problems','debug','watch','stack','breakpoints','bytecode','disassembly','assembly']);
  const root=createSplit('split-left','horizontal',createSplit('split-bottom','vertical',documents,bottom,.72),createSplit('split-right','vertical',createGroup('tools-left',['solution','outline']),createGroup('tools-right',['properties','diagnostics','project']),.68),.77);
  const placed=new Set(['solution','outline','properties','diagnostics','project',...bottom.panels]);
  return {version:1,root,floating:[],autoHide:{left:[],right:[],top:[],bottom:[]},closed:toolDefinitions.map(p=>p.id).filter(id=>!placed.has(id)),activePanel:'output'};
}
export class StudioDocking {
  constructor({createDocument,onActivate,onError,onClose}){
    const root=document.querySelector('#workspace'),solution=document.querySelector('#solution'),diagnostics=document.querySelector('#diagnostic-tools'),breadcrumb=document.querySelector('.editor-breadcrumb');
    this.content=new Map([['solution',solution],['diagnostics',diagnostics]]);this.createDocument=createDocument;this.onActivate=onActivate;
    // The document breadcrumb describes the focused editor across all split groups.
    root.before(breadcrumb);breadcrumb.classList.add('workspace-breadcrumb');
    const count=document.querySelector('#error-count');const summary=document.querySelector('#inline-diagnostics');if(count)breadcrumb.append(count);if(summary)summary.title='Live compiler diagnostics';
    solution.querySelector('.window-title')?.remove();diagnostics.querySelector('.window-title')?.remove();
    root.replaceChildren();root.classList.add('docked-workspace');
    for(const panel of toolDefinitions)if(!this.content.has(panel.id)){const element=document.createElement('div');element.className='panel-content dock-tool-content';element.dataset.tool=panel.id;this.content.set(panel.id,element);}
    for(const [id,content] of this.content){content.dataset.tool=id;}
    this.layout=new DockLayout(toolDefinitions,defaultDockLayout());
    this.host=new DockHost(root,this.layout,{resolveContent:id=>this.resolve(id),onActivate,onError,onClose});
    this.layout.subscribe(()=>{try{storage.setItem(storageKeys.docking,this.layout.serialize());}catch{}});
    this.pendingRestore=null;try{this.pendingRestore=storage.getItem(storageKeys.docking);}catch{}
    this.mobile=false;this.media=matchMedia('(max-width: 700px)');this.mediaListener=()=>this.adapt();this.media.addEventListener('change',this.mediaListener);
  }
  resolve(id){if(this.content.has(id))return this.content.get(id);const element=this.createDocument(id.slice(7));this.content.set(id,element);return element;}
  sync(files,tabs,active){
    const ids=new Set(files.map(f=>'source:'+f.uri));
    for(const id of [...this.layout.panels.keys()])if(id.startsWith('source:')&&!ids.has(id)){if(this.host.popouts.has(id))this.host.returnPopout(id);this.host.contents.get(id)?.remove();this.host.contents.delete(id);this.content.delete(id);this.layout.unregister(id);}
    for(const file of files){const id='source:'+file.uri;if(!this.layout.panels.has(id))this.layout.register({id,title:file.uri.split('/').at(-1),description:file.uri,kind:'document'});}
    for(const uri of tabs){const id='source:'+uri;if(ids.has(id)&&this.layout.locate(id).kind==='closed'){const group=this.layout.groups().find(g=>g.kind==='document');this.layout.open(id,group?.id);}}
    if(this.pendingRestore){const snapshot=this.pendingRestore;this.pendingRestore=null;try{this.layout.restore(snapshot);}catch{/* Workspace source identities changed. Retain a valid default layout. */}}
    if(active&&this.layout.panels.has('source:'+active))this.layout.open('source:'+active);
    if(files.some(f=>!this.host.contents.has('source:'+f.uri)&&tabs.includes(f.uri)))this.host.render();
    this.adapt();
  }
  activate(id){this.adapt();if(this.layout.locate(id).kind==='closed'&&['msbuild','msbuild-inspector','project-source'].includes(id)){const preferred=id==='project-source'?'documents':'tools-bottom',group=this.layout.groups().find(g=>g.id===preferred);if(group)this.layout.open(id,group.id);}
    if(this.layout.locate(id).kind==='autoHide'){this.host.autoPanel=id;this.host.render();}else this.layout.open(id);this.onActivate(id);}
  title(id,title){const p=this.layout.panels.get(id);if(!p||p.title===title)return;p.title=title;for(const tab of document.querySelectorAll(`[data-dock-tab="${CSS.escape(id)}"]`))tab.textContent=title;}
  reset(preset='coding'){
    const defaults=defaultDockLayout(),docs=[...this.layout.panels.keys()].filter(id=>id.startsWith('source:'));let documentGroup;const walk=n=>{if(n.type==='group'&&n.id==='documents')documentGroup=n;else if(n.type==='split'){walk(n.first);walk(n.second);}};walk(defaults.root);documentGroup.panels=docs;documentGroup.active=docs[0]??null;
    if(preset==='build'){const bottom=createGroup('tools-bottom',['msbuild-inspector','problems','output']),right=createGroup('tools-right',['msbuild','project']);documentGroup.panels.push('project-source');defaults.root=createSplit('split-left','horizontal',createGroup('tools-left',['solution','outline']),createSplit('split-right','horizontal',createSplit('split-bottom','vertical',documentGroup,bottom,.65),right,.60),.16);const placed=new Set([...docs,'project-source','solution','outline',...bottom.panels,...right.panels]);defaults.closed=toolDefinitions.map(p=>p.id).filter(id=>!placed.has(id));defaults.activePanel='msbuild';}
    if(preset==='designer'){
      const toolbox=createGroup('design-left',['designer-toolbox','solution']);
      const outline=createGroup('design-outline',['designer-tree']);
      const surface=createGroup('design-surface',['designer',...docs,'designer-source'],'document');
      const properties=createGroup('design-properties',['designer-properties','designer-layout','designer-styles']);
      defaults.root=createSplit('design-columns','horizontal',createSplit('design-left-stack','vertical',toolbox,outline,.50),createSplit('design-main','horizontal',surface,properties,.73),.16);
      const placed=new Set(['designer-toolbox','solution','designer-tree','designer','designer-source','designer-properties','designer-layout','designer-styles',...docs]);
      defaults.closed=toolDefinitions.map(p=>p.id).filter(id=>!placed.has(id));defaults.activePanel='designer';
    }
    this.layout.restore(defaults);if(preset==='debug'){this.layout.dock('debug','tools-right','center');this.layout.dock('watch','tools-right','bottom');this.layout.open('stack');}if(preset==='winui'){this.layout.dock('winui','documents','right');this.layout.open('winui');this.layout.open('visual-tree');}if(preset==='decompile'){this.layout.dock('assembly','documents','center');this.layout.open('assembly');}this.mobile=false;this.adapt();
  }
  adapt(){
    if(this.media.matches&&!this.mobile){this.desktopSnapshot=this.layout.snapshot();this.mobile=true;for(const id of ['solution','outline'])if(this.layout.locate(id).kind==='group')this.layout.autoHide(id,'left');for(const id of ['diagnostics','project'])if(this.layout.locate(id).kind==='group')this.layout.autoHide(id,'right');}
    else if(!this.media.matches&&this.mobile){this.mobile=false;if(this.desktopSnapshot)try{this.layout.restore(this.desktopSnapshot);}catch{}}
  }
  dispose(){this.media.removeEventListener('change',this.mediaListener);this.host.dispose();}
}
