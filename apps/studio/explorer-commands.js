import {decodeWorkspaceFile,encodeWorkspaceFile} from '../../packages/archive/src/index.js';
import {renameSolutionFolder,removeSolutionFolder,moveSolutionProject,addSolutionItem,removeSolutionProject,editNamedProjectItem,validateItemPath,editProjectMembership,addSolutionProject,addSolutionFolder,rewriteProjectPath,createCsproj,createSlnx,normalizePath,parseXml} from '../../packages/project-system/src/index.js';
const base=p=>p?.includes('/')?p.slice(0,p.lastIndexOf('/')):'';
const name=p=>p?.split('/').at(-1)??'';
const within=(p,root)=>p===root||p.startsWith(root+'/');
const mapped=(path,mappings)=>{const m=mappings.find(m=>within(path,m.from));return m?m.to+path.slice(m.from.length):path;};
const cloneRecords=records=>records.map(f=>({...f,bytes:f.bytes?.slice()}));
const xmlFile=p=>/\.(csproj|slnx|props|targets)$/i.test(p);

/** Selection-aware workspace commands shared by toolbar, menus, shortcuts and tree drop. */
export class ExplorerCommands {
 constructor(host){this.host=host;this.history=[];this.clipboard=null;this.busy=false;this.identity=null;}
 context(){const c=this.host.context();if(this.identity!==c.identity){this.identity=c.identity;this.history=[];this.clipboard=null;}return c;}
 editable(){const c=this.context();return c.readOnly?'Stop debugging before changing files':this.busy?'A file operation is in progress':c.native&&c.buildBusy?'Finish the native build before changing files':true;}
 nodes(node,selection=[]){return selection.length?selection:node?[node]:[];}
 files(nodes){return nodes.filter(n=>n.path&&!['project','project-file','solution','solution-folder','dependencies','dependency-group','package','reference','framework','analyzer','project-reference','generated','generated-group','symbol'].includes(n.kind));}
 folder(node){return node?.kind==='folder'?node.path:node?.kind==='project'?base(node.path):node?.project?base(node.project):node?.path?base(node.path):'';}
 menu(node,selection=[]){const nodes=this.nodes(node,selection),files=this.files(nodes),single=nodes.length===1,canChange=()=>this.editable(),change=()=>this.editable()===true&&files.length===nodes.length&&files.length>0,canProject=!!node?.project||node?.kind==='project',c=this.context();
  const action=(label,id,shortcut='',enabled=true)=>({label,shortcut,enabled,action:()=>this.run(id,node,nodes)});
  const items=[];
  if(single&&node?.kind==='source'||single&&['file','assembly','project-file','generated','project-reference','symbol'].includes(node?.kind))items.push(action(node.kind==='assembly'?'Open in Decompiler':'Open','open','Enter'));
  if(node?.kind==='source')items.push(action('Open in New Vertical Tab Group','split'),action('Open in Separate Window','popout'));
  if(node?.kind==='project'||node?.kind==='solution'){
   const nativeReady=()=>!c.native||!!c.nativeAvailable&&!!c.trusted&&!c.buildBusy?true:'Connect an available MSBuild engine and explicitly trust this workspace';
   items.push(action('Build','build','Ctrl+Shift+B',nativeReady),action('Rebuild','rebuild','',nativeReady),action('Clean','clean','',nativeReady));
   if(c.native)items.push(action('Restore Packages','restore','',nativeReady),action('Evaluate Project','evaluate','',nativeReady));
   if(node.kind==='project')items.push(action('Set as Startup Project','startup','',canChange),action('Edit Project File','edit-project','',!!node.path));else if(node.path)items.push(action('Edit Solution File','open'));
   items.push(null);
  }
  if(['solution','project','workspace','folder','solution-folder'].includes(node?.kind))items.push({label:'Add',enabled:canChange,children:[action('New Item…','new-file','Ctrl+Shift+A',canChange),action('Existing Item…','add-existing','Shift+Alt+A',canChange),action('New Folder…','new-folder','',canChange),null,action('New Project…','new-project','',canChange),action('Existing Project…','add-project','',()=>this.context().solutionPath?canChange():'Open a .slnx solution first'),action('Solution Folder…','solution-folder','',()=>this.context().solutionPath?canChange():'Open a .slnx solution first')]});
  if(node?.kind==='dependencies'||node?.kind==='project'||node?.kind==='dependency-group')items.push(action('Add Project Reference…','add-reference','',()=>node.project?canChange():'Open an SDK project first'));
  if(node?.kind==='project'&&node.path&&c.solutionPath)items.push(action('Move to Solution Folder…','project-folder','',canChange),action('Remove from Solution…','remove-project','',canChange));
  if(node?.kind==='solution-folder'&&node.solutionFolder)items.push(action('Rename Solution Folder…','rename-solution-folder','F2',canChange),action('Remove Solution Folder…','remove-solution-folder','Delete',canChange));
  if(['project-reference','package','reference','analyzer'].includes(node?.kind))items.push(action('Remove Reference…','remove-reference','Delete',canChange));
  if(['project','dependencies','dependency-group'].includes(node?.kind))items.push(action('Add Package Reference…','add-package','',()=>node.project?canChange():'Open an SDK project first'));
  if(files.length){items.push(null,action('Cut','cut','Ctrl+X',change),action('Copy','copy','Ctrl+C'),action('Paste','paste','Ctrl+V',()=>this.clipboard?canChange():'Copy or cut an explorer item first'),null,action('Rename…','rename','F2',()=>single&&change()),action('Delete…','delete','Delete',change));
   if(single&&node.project&&node.kind==='source')items.push(action(node.excluded?'Include in Project':'Exclude from Project',node.excluded?'include':'exclude','',canChange),{label:'Build Action',enabled:canChange,children:['Compile','None','Content','EmbeddedResource'].map(kind=>action(kind,'build-action:'+kind,'',canChange))});
  }else items.push(action('Paste','paste','Ctrl+V',()=>this.clipboard?canChange():'Copy or cut an explorer item first'));
  if(node?.branch)items.push(null,action('Scope to This','scope'),action('Expand All','expand'),action('Collapse','collapse'));
  items.push(null,action('Undo Last File Operation','undo','Ctrl+Z',()=>this.history.length?canChange():'No file operation to undo in this workspace session'),action('Sync with Active Document','sync'),action('Refresh','refresh'),null,action('Copy Full Path','copy-path','',!!node?.path),action('Copy Relative Path','copy-relative','',!!node?.path),action('Properties','properties','Alt+Enter'));
  if(['workspace','solution','project'].includes(node?.kind)&&this.host.workspaceAction)items.push(null,action('Save Workspace as ZIP…','save-zip'),action('Save Workspace to Empty Folder…','save-folder'));
  if(node?.path&&/\.(csproj|slnx|sln)$/i.test(node.path)&&this.host.workspaceAction)items.push(action('Open as Workspace Entry','open-workspace-entry'));
  if(node?.path&&/\.sln$/i.test(node.path)&&this.host.workspaceAction)items.push(action('Convert to SLNX (keep original)…','convert-sln','',canChange));
  if(this.host.windowMenu)items.push(null,{label:"Window",children:()=>this.host.windowMenu()});
  return [...items,...this.host.contextItems?.(node,nodes)??[]];
 }
 async run(action,node=null,selection=[],event=null){let ownsOperation=false;try{
  const c=this.context(),nodes=this.nodes(node,selection);
  if(action==='context'){this.host.menu({items:this.menu(node,nodes),x:event?.clientX??0,y:event?.clientY??0,anchor:event?.currentTarget??this.host.explorer.tree,document:event?.target?.ownerDocument??document});return;}
  if(action==='open'){if(node)await this.host.open(node);return;}
  if(action==='properties'){this.host.properties(nodes);return;}
  if(action==='copy-path'||action==='copy-relative'){return this.host.copy(nodes.map(n=>(action==='copy-path'&&c.root?c.root.replace(/\/$/,'')+'/':'')+(n.path??n.label)).join('\n'));}
  if(action==='sync')return this.host.explorer.reveal(c.active,true);
  if(action==='scope')return this.host.explorer.scopeTo(node);
  if(action==='expand'||action==='collapse')return this.host.explorer.model.expandAll(action==='expand',node.id);
  if(action==='split'||action==='popout'){await this.host.open(node);return this.host.document(action,node.path);}
  if(action==='refresh'){await this.host.refresh();return;}
  if(['build','rebuild','clean','restore','evaluate','startup','edit-project'].includes(action))return this.host.project(action,node);
  if(action==='copy'||action==='cut'){if(action==='cut'&&this.editable()!==true)throw new Error(this.editable());const files=this.files(nodes);if(files.length!==nodes.length||!files.length)throw new Error('Select files or physical folders to copy or move');this.clipboard={identity:c.identity,cut:action==='cut',nodes:files.map(n=>({...n,children:undefined}))};this.host.notice(`${files.length} item(s) ${action==='cut'?'cut':'copied'}. Choose a destination and Paste.`);return;}
  if(this.editable()!==true)throw new Error(this.editable());
  if(this.runningMutation)throw new Error('Complete or cancel the active file dialog first');this.runningMutation=true;ownsOperation=true;this.operationIdentity=c.identity;this.readSet=new Map();
  if(action==='undo')return await this.undo();
  if((action==='rename'||action==='delete')&&node?.kind==='solution-folder')action=action==='rename'?'rename-solution-folder':'remove-solution-folder';
  if(action==='rename-solution-folder'){const path=await this.host.pathDialog('Rename Solution Folder',node.solutionFolder.replace(/^\/+|\/+$/g,''));if(!path)return;const text=await this.readText(c.solutionPath);return await this.perform([{kind:'write',path:c.solutionPath,text:renameSolutionFolder(text,{folder:node.solutionFolder,name:path})}]);}
  if(action==='remove-solution-folder'){if(!await this.host.confirm('Remove Solution Folder',[node.solutionFolder],'Remove the logical folder and its solution membership only. Physical files remain on disk.'))return;const text=await this.readText(c.solutionPath);return await this.perform([{kind:'write',path:c.solutionPath,text:removeSolutionFolder(text,node.solutionFolder)}]);}
  if(action==='project-folder'){const folder=await this.host.choose('Move Project to Solution Folder',['(Solution root)',...(c.snapshot?.solution?.folders??[])]);if(!folder)return;const text=await this.readText(c.solutionPath);return await this.perform([{kind:'write',path:c.solutionPath,text:moveSolutionProject(text,{solutionPath:c.solutionPath,projectPath:node.path,folder:folder==='(Solution root)'?null:folder})}]);}
  if(action==='new-file'&&this.host.wizardItem)return await this.host.wizardItem(node);
  if(action==='new-project'&&this.host.wizardProject)return await this.host.wizardProject(node);
  if(action==='add-project'&&this.host.workspaceAction)return await this.host.workspaceAction('import-project',node);
  if(['save-zip','save-folder','open-workspace-entry','convert-sln'].includes(action)&&this.host.workspaceAction)return await this.host.workspaceAction(action,node);
  if(action==='new-file'||action==='new-folder'){
   const folder=this.folder(node),isFolder=action==='new-folder',path=await this.host.pathDialog(isFolder?'New Folder':'Add New Item',(folder?folder+'/':'')+(isFolder?'NewFolder':'NewClass.cs'));if(!path)return;
   const id=name(path).replace(/\.cs$/i,'').replace(/[^A-Za-z0-9_]/g,'_'),className=/^[A-Za-z_]/.test(id)?id:'_'+id;
   let ops=[{kind:isFolder?'mkdir':'create',path,text:isFolder?undefined:/\.cs$/i.test(path)?`class ${className}\n{\n    public int Value { get; set; }\n}\n`:''}];
   if(!isFolder&&node?.project&&/\.cs$/i.test(path)){const text=await this.readText(node.project);ops.push({kind:'write',path:node.project,text:editProjectMembership(text,{projectPath:node.project,path})});}
   await this.perform(ops);if(!isFolder)await this.host.open({path,kind:/\.cs$/i.test(path)?'source':'file'});return;
  }
  if(action==='add-existing'){
   const files=await this.host.pickFiles();if(!files?.length)return;const folder=this.folder(node),ops=[];let projectText=node?.project?await this.readText(node.project):null;
   for(const file of files){if(file.size>16*1024*1024)throw new Error('Existing items must be at most 16 MiB each');const path=validateItemPath((folder?folder+'/':'')+file.name),bytes=new Uint8Array(await file.arrayBuffer()),record=decodeWorkspaceFile(path,bytes);let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));ops.push({kind:'create',path,base64:btoa(binary)});if(projectText!==null)projectText=editProjectMembership(projectText,{projectPath:node.project,path,itemType:/\.cs$/i.test(path)?'Compile':'None'});}

   if(projectText!==null)ops.push({kind:'write',path:node.project,text:projectText});await this.perform(ops);return;
  }
  if(action==='new-project'){
   const path=await this.host.pathDialog('Add New Project','NewProject/NewProject.csproj');if(!path)return;if(!/\.csproj$/i.test(path))throw new Error('Use a .csproj filename');const program=(base(path)?base(path)+'/':'')+'Program.cs',ops=[{kind:'create',path,text:createCsproj({assemblyName:name(path).replace(/\.csproj$/i,''),outputType:'Exe'})},{kind:'create',path:program,text:'using System;\nclass Program\n{\n    public static void Main()\n    {\n        Console.WriteLine("Hello from the new project");\n    }\n}\n'}];
   if(c.solutionPath)ops.push({kind:'write',path:c.solutionPath,text:addSolutionProject(await this.readText(c.solutionPath),{solutionPath:c.solutionPath,projectPath:path,folder:node?.solutionFolder})});
   else {const solution=await this.host.pathDialog('Create a solution for the projects',c.name.replace(/[^A-Za-z0-9_.-]/g,'_')+'.slnx');if(!solution)return;const projects=[...new Set([...(c.snapshot?.projects??[]).map(p=>p.path),path])];ops.push({kind:'create',path:solution,text:createSlnx(projects)});}
   await this.perform(ops);return;
  }
  if(action==='add-project'){
   const choices=c.records.filter(f=>/\.csproj$/i.test(f.path)&&!c.snapshot?.solution?.projectPaths?.includes(f.path)).map(f=>f.path);if(!choices.length)throw new Error('No additional .csproj exists in this workspace. Add or create a project folder first.');const path=await this.host.choose('Add Existing Project',choices);if(!path)return;await this.perform([{kind:'write',path:c.solutionPath,text:addSolutionProject(await this.readText(c.solutionPath),{solutionPath:c.solutionPath,projectPath:path,folder:node?.solutionFolder})}]);return;
  }
  if(action==='solution-folder'){const folder=await this.host.pathDialog('Add Solution Folder','NewFolder');if(!folder)return;await this.perform([{kind:'write',path:c.solutionPath,text:addSolutionFolder(await this.readText(c.solutionPath),(node?.solutionFolder??'')+folder)}]);return;}
  if(action==='add-reference'){
   const choices=(c.snapshot?.projects??[]).filter(p=>p.path!==node.project).map(p=>p.path);if(!choices.length)throw new Error('Add another project to this solution first');const path=await this.host.choose('Add Project Reference',choices);if(!path)return;const text=editProjectMembership(await this.readText(node.project),{projectPath:node.project,path,itemType:'ProjectReference'});await this.perform([{kind:'write',path:node.project,text}]);return;
  }
  if(action==='remove-project'){if(!c.solutionPath||!node.path)throw new Error('Select a project inside a solution');if(!await this.host.confirm('Remove Project',[node.path],'Only solution membership is removed. Project files remain on disk. Project references from other projects are unchanged.'))return;await this.perform([{kind:'write',path:c.solutionPath,text:removeSolutionProject(await this.readText(c.solutionPath),{solutionPath:c.solutionPath,projectPath:node.path})}]);return;}
  if(action==='remove-reference'){if(!await this.host.confirm('Remove Reference',[node.label],'Remove this item from project evaluation; files remain on disk. Conditional or imported definitions are preserved.'))return;const original=await this.readText(node.project),text=node.kind==='project-reference'?editProjectMembership(original,{projectPath:node.project,path:node.path,include:false,itemType:'ProjectReference'}):editNamedProjectItem(original,{itemType:({package:'PackageReference',reference:'Reference',analyzer:'Analyzer'})[node.kind],name:node.metadata?.name??node.metadata?.include??node.metadata?.path??node.label,include:false});await this.perform([{kind:'write',path:node.project,text}]);return;}
  if(action==='add-package'){const name=await this.host.pathDialog('Package ID','Example.Package');if(!name)return;if(!/^[A-Za-z0-9_.-]+$/.test(name))throw new Error('Use a literal NuGet package identifier');const version=await this.host.pathDialog('Package Version','1.0.0');if(!version)return;if(!/^[A-Za-z0-9.+-]+$/.test(version))throw new Error('Use a literal package version');await this.perform([{kind:'write',path:node.project,text:editNamedProjectItem(await this.readText(node.project),{name,metadata:{Version:version}})}]);this.host.notice('Package reference added. Restore explicitly with a trusted native MSBuild engine; browser preview does not restore packages.');return;}
  if(action==='include'||action==='exclude'||action.startsWith('build-action:')){
   if(!node?.project||!node.path)throw new Error('Select a source item in a project');let text=await this.readText(node.project);if(action.startsWith('build-action:')){const chosen=action.slice(13);for(const itemType of ['Compile','None','Content','EmbeddedResource'])text=editProjectMembership(text,{projectPath:node.project,path:node.path,include:false,itemType});text=editProjectMembership(text,{projectPath:node.project,path:node.path,itemType:chosen});}else if(action==='exclude'){for(const itemType of ['Compile','None','Content','EmbeddedResource','AdditionalFiles'])text=editProjectMembership(text,{projectPath:node.project,path:node.path,include:false,itemType});}else text=editProjectMembership(text,{projectPath:node.project,path:node.path,include:true,metadata:node.metadata??{}});await this.perform([{kind:'write',path:node.project,text}]);return;
  }
  if(action==='rename'){
   const file=this.files(nodes);if(file.length!==1)throw new Error('Rename one physical file or folder at a time');const path=await this.host.pathDialog('Rename Item',file[0].path);if(!path||path===file[0].path)return;await this.move(file.map(n=>({from:n.path,to:path})),false);return;
  }
  if(action==='delete'&&['project-reference','package','reference','analyzer'].includes(node?.kind))throw new Error('Use Remove Reference from the context menu; this does not delete files');
  if(action==='delete'){
   const files=this.files(nodes);if(files.length!==nodes.length||!files.length)throw new Error('Only physical files and folders may be deleted here');if(!await this.host.confirm('Delete Items',files.map(n=>n.path),c.native?'Deleted items are quarantined on disk. Undo is available in this host session.':'Items are removed from browser memory and recovery. Undo is available in this session.'))return;const roots=files.filter(n=>!files.some(p=>p!==n&&within(n.path,p.path)));const ops=roots.map(n=>({kind:'delete',path:n.path}));const edits=new Map();for(const n of files){if(n.project&&n.kind==='source')edits.set(n.project,editProjectMembership(edits.get(n.project)??await this.readText(n.project),{projectPath:n.project,path:n.path,include:false}));}for(const [path,text]of edits)ops.push({kind:'write',path,text});await this.perform(ops);return;
  }
  if(['paste','copy-to','move-to'].includes(action)){
   const clipboard=action==='paste'?this.clipboard:{nodes:this.files(nodes),cut:action==='move-to',identity:c.identity};if(!clipboard?.nodes.length||clipboard.identity!==c.identity)throw new Error('The explorer clipboard belongs to another workspace');const destination=this.folder(node);if(!['project','folder','solution','workspace','solution-folder'].includes(node?.kind))throw new Error('Select a destination project or folder');const mappings=clipboard.nodes.map(n=>({from:n.path,to:(destination?destination+'/':'')+name(n.path)}));await this.move(mappings,!clipboard.cut,node?.project);if(action==='paste'&&clipboard.cut)this.clipboard=null;return;
  }
  throw new Error('Unknown explorer command: '+action);
 }catch(error){this.host.error(error);return {error:error.message};}finally{if(ownsOperation){this.runningMutation=false;this.operationIdentity=null;this.readSet=null;this.host.render();}}}
 async readText(path){const c=this.context();let text=c.records.find(f=>f.path===path)?.text;if(c.native&&typeof text!=='string')text=(await c.client.read(path)).text;if(typeof text!=='string')throw new Error('Editable text not found: '+path);if(this.readSet?.has(path)&&this.readSet.get(path)!==text)throw new Error('Project changed while preparing the operation: '+path);this.readSet?.set(path,text);return text;}
 async move(mappings,copy,destinationProject=null){const c=this.context();for(const m of mappings){validateItemPath(m.to);if(m.from===m.to||within(m.to,m.from))throw new Error('Choose another destination; an item cannot contain itself');if(c.records.some(r=>within(r.path,m.from)&&/\.csproj$/i.test(r.path)))throw new Error('Moving folders containing project files requires editing their build-relative paths. Move source folders or edit the project path explicitly.');}
  const ops=mappings.map(m=>({kind:copy?'copy':'move',path:m.from,destination:m.to}));const projectEdits=new Map();
  if(!copy)for(const record of c.records.filter(r=>xmlFile(r.path))){let text=await this.readText(record.path),next=text;for(const m of mappings)next=rewriteProjectPath(next,{documentPath:record.path,oldPath:m.from,newPath:m.to});if(next!==text)projectEdits.set(record.path,next);}
  if(destinationProject){let text=projectEdits.get(destinationProject)??await this.readText(destinationProject);for(const record of c.records.filter(r=>/\.cs$/i.test(r.path))){const m=mappings.find(m=>within(record.path,m.from));if(m)text=editProjectMembership(text,{projectPath:destinationProject,path:m.to+record.path.slice(m.from.length)});}projectEdits.set(destinationProject,text);}
  for(const [path,text]of projectEdits)ops.push({kind:'write',path,text});
  await this.perform(ops,copy?[]:mappings);
 }
 async perform(operations,mappings=[]){const c=this.context();if(this.operationIdentity&&c.identity!==this.operationIdentity)throw new Error('Workspace changed while preparing the file operation');this.busy=true;this.host.render();
  try{
   if(c.native){await this.host.saveNative();for(const [path,text]of this.readSet??[]){if((await c.client.read(path)).text!==text)throw new Error('Project changed while preparing the operation; no file operations applied: '+path);}for(const op of operations)if(!['create','mkdir'].includes(op.kind))op.expectedHash=(await c.client.inspectItem(op.path)).hash;
    let result;try{result=await c.client.mutate(operations);}catch(error){if(error.undoToken)this.history.push({native:true,token:error.undoToken,mappings});await this.host.refreshNative([],true);throw error;}
    this.history.push({native:true,token:result.undoToken,mappings});await this.host.refreshNative(mappings);this.host.notice('Disk operation completed. Undo is available; multi-file operations are not atomic.');
   }else{
    for(const [path,text]of this.readSet??[])if(c.records.find(f=>f.path===path)?.text!==text)throw new Error('Project changed while preparing the operation: '+path);
    const before={records:cloneRecords(c.records),folders:[...(c.folders??[])],active:c.active,tabs:[...(c.tabs??[])],breakpoints:structuredClone(c.breakpoints??{}),startup:c.startup,entry:c.solutionPath??c.entry};
    const records=new Map(cloneRecords(c.records).map(f=>[f.path,f])),folders=new Set(c.folders??[]);
    for(const op of operations){const path=validateItemPath(op.path);if(['create','mkdir'].includes(op.kind)&&([...records.keys(),...folders].some(p=>p===path||p.startsWith(path+'/'))))throw new Error('Destination already exists: '+path);
     if(op.kind==='create'){if(op.base64!==undefined){if(typeof op.base64!=='string'||op.base64.length>24*1024*1024||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(op.base64))throw new Error('Invalid/oversized binary item');records.set(path,decodeWorkspaceFile(path,Uint8Array.from(atob(op.base64),c=>c.charCodeAt(0))));}else{if(typeof op.text!=='string'||op.text.length>4*1024*1024)throw new Error('Text item size limit exceeded');records.set(path,{path,text:op.text});}}
     else if(op.kind==='mkdir')folders.add(path);
     else if(op.kind==='write'){if(!records.has(path))throw new Error('Missing text file: '+path);if(xmlFile(path))parseXml(op.text);records.set(path,{...records.get(path),text:op.text});}
     else {const descendants=[...records].filter(([p])=>within(p,path)),dirs=[...folders].filter(p=>within(p,path));if(!descendants.length&&!dirs.length)throw new Error('Source no longer exists: '+path);
      if(['move','copy'].includes(op.kind)){const to=validateItemPath(op.destination);if(to===path||within(to,path)||[...records.keys(),...folders].some(p=>within(p,to)))throw new Error('Destination exists or contains itself: '+to);for(const [p,f]of descendants)records.set(to+p.slice(path.length),{...f,path:to+p.slice(path.length)});for(const p of dirs)folders.add(to+p.slice(path.length));}
      if(op.kind!=='copy'){for(const [p]of descendants)records.delete(p);for(const p of dirs)folders.delete(p);}
     }
    }
    if(records.size>20000)throw new Error('Workspace item limit exceeded');let size=0;for(const record of records.values())size+=(record.text?.length??0)*2+(record.bytes?.length??0);if(size>128*1024*1024)throw new Error('Workspace memory limit exceeded');
    await this.host.commit({records:[...records.values()],folders:[...folders],mappings});this.history.push({native:false,before,after:cloneRecords([...records.values()]),afterFolders:[...folders],size:size+before.records.reduce((n,r)=>n+(r.text?.length??0)*2+(r.bytes?.length??0),0)});while(this.history.length>1&&this.history.reduce((n,h)=>n+(h.size??0),0)>32*1024*1024)this.history.shift();
   }
   while(this.history.length>32)this.history.shift();
  }finally{this.busy=false;this.host.render();}
 }
 async undo(){if(!this.history.length)throw new Error('No file operation to undo');const record=this.history.at(-1),c=this.context();this.busy=true;this.host.render();try{
  if(record.native){if(!c.native)throw new Error('This undo belongs to a native workspace');await this.host.saveNative();await c.client.undoMutation(record.token);this.history.pop();await this.host.refreshNative(record.mappings.map(m=>({from:m.to,to:m.from})));}
  else {const expected=new Map(record.after.map(f=>[f.path,f]));if(c.records.length!==expected.size||c.records.some(f=>{const old=expected.get(f.path);return !old||old.text!==f.text||old.bytes?.length!==f.bytes?.length||f.bytes?.some((b,i)=>b!==old.bytes[i]);})||JSON.stringify(c.folders)!==JSON.stringify(record.afterFolders))throw new Error('Workspace files changed after that operation. Undo would overwrite newer edits; no files were changed.');await this.host.commit({...record.before,mappings:[],restore:record.before});this.history.pop();}
  this.host.notice('File operation undone.');
 }finally{this.busy=false;this.host.render();}}
}
