import {normalizePath,directoryName,baseName} from './paths.js';
import {parseXml,xmlEscape} from './xml.js';
const folderOf=p=>p.includes('/')?p.slice(0,p.lastIndexOf('/')):'';
export const relativeTo=(path,base)=>{const a=base.split('/').filter(Boolean),b=path.split('/');while(a.length&&b.length&&a[0]===b[0]){a.shift();b.shift();}return [...a.map(()=>'..'),...b].join('/');};
export function validateItemPath(value){if(typeof value!=='string'||!value.trim()||value.length>1024||/[\u0000-\u001f<>:"|?*]/.test(value)||/^(?:[\\/]|[A-Za-z]:)/.test(value))throw new Error('Enter a relative file or folder path without reserved characters');if(value.replaceAll('\\','/').split('/').some(p=>p==='..'))throw new Error('Parent path components are not accepted for file changes');const path=normalizePath(value.trim());if(path.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)||['.git','.sharpforge','node_modules'].includes(p)))throw new Error('This path is reserved or not portable');return path;}
/** Build a display hierarchy from project evaluation or native static inspection, never execute a project. */
export function buildSolutionTree({name='Workspace',files=[],snapshot=null,startup=null,showAll=false,view='solution',dirty=[],folders=[],generated=[],symbols=[]}={}){
 const map=new Map(files.map(f=>[f.path??f.uri,f])),dirtySet=new Set(dirty),projects=snapshot?.projects??[];
 const root={id:'solution:'+(snapshot?.solution?.path??name),kind:view==='folders'?'workspace':'solution',label:view==='folders'?name:`Solution '${snapshot?.solution?.name??name}' (${snapshot?projects.length:1} project${(snapshot?projects.length:1)===1?'':'s'})`,path:snapshot?.solution?.path??'',icon:'◇',branch:true,defaultExpanded:true,draggable:false,children:[]};
 const addFile=(parent,file,path,display=path,extra={})=>{
  const parts=display.split('/').filter(Boolean);let at=parent;
  for(let i=0;i<parts.length-1;i++){const segment=parts[i],prefix=parts.slice(0,i+1).join('/'),id=parent.id+':folder:'+prefix;let folder=at.children.find(n=>n.id===id);if(!folder){const real=extra.projectBase?normalizePath(prefix,extra.projectBase):prefix;folder={id,kind:'folder',label:segment,path:real,project:extra.project,branch:true,children:[],icon:'▰'};at.children.push(folder);}at=folder;}
  const kind=file.kind??(/\.(?:cs|vb|fs)$/i.test(path)?'source':/\.(?:dll|exe)$/i.test(path)?'assembly':/\.(?:csproj|fsproj|vbproj)$/i.test(path)?'project-file':'file');
  at.children.push({id:parent.id+':file:'+path,kind,label:parts.at(-1)??baseName(path),path,icon:kind==='source'?'C#':kind==='assembly'?'◇':'≡',dirty:dirtySet.has(path),searchText:path,description:path+(extra.linked?' (linked item)':''),...extra});
 };
 const symbolFiles=new Map();for(const symbol of symbols){if(!['class','method','field','property','enum'].includes(symbol.kind)||symbol.name?.startsWith('<')||!symbol.uri)continue;const list=symbolFiles.get(symbol.uri)??[];if(list.length<5000)list.push(symbol);symbolFiles.set(symbol.uri,list);}
 const attachSymbols=n=>{if(n.kind==='source'){const values=symbolFiles.get(n.path)??[],types=new Map();n.children??=[];for(const v of values.filter(v=>['class','enum'].includes(v.kind))){const item={id:n.id+':symbol:'+v.id,kind:'symbol',label:v.name,path:n.path,start:v.start,end:v.end,symbol:v,draggable:false,icon:'C',children:[]};types.set(v.name,item);n.children.push(item);}for(const v of values.filter(v=>!['class','enum'].includes(v.kind))){const parent=types.get(v.owner)??n;parent.children.push({id:n.id+':symbol:'+v.id,kind:'symbol',label:(v.name==='.ctor'?v.owner:v.name)+(v.kind==='method'?'('+(v.parameters??[]).map(p=>p.type).join(', ')+')':'')+(v.type?' : '+v.type:''),path:n.path,start:v.start,end:v.end,symbol:v,draggable:false,icon:v.kind==='method'?'◇':v.kind==='property'?'⚙':'▪'});}return;}n.children?.forEach(attachSymbols);};
 const sort=n=>{n.children?.sort((a,b)=>((a.kind==='dependencies'?0:a.kind==='folder'?1:2)-(b.kind==='dependencies'?0:b.kind==='folder'?1:2))||a.label.localeCompare(b.label,undefined,{numeric:true,sensitivity:'base'}));n.children?.forEach(sort);};
 if(view==='folders'||(!projects.length&&!snapshot)){const parent=view==='folders'?root:{id:'project:loose',kind:'project',label:name,path:'',icon:'C#',branch:true,defaultExpanded:true,startup:true,children:[]};if(parent!==root)root.children.push(parent);
  for(const [path,file]of map)addFile(parent,file,path);for(const path of folders){const marker={path:path+'/.sf-folder',kind:'folder-marker'};addFile(parent,marker,marker.path,marker.path);}
  const clean=n=>{n.children=n.children?.filter(c=>c.kind!=='folder-marker');n.children?.forEach(clean);};clean(root);attachSymbols(root);sort(root);return [root];}
 const solutionFolders=new Map();const solutionFolder=(path)=>{if(!path)return root;const parts=path.split('/').filter(Boolean);let parent=root,current='';for(const part of parts){current+='/'+part;let f=solutionFolders.get(current);if(!f){f={id:root.id+':slnfolder:'+current,kind:'solution-folder',label:part,solutionFolder:current+'/',branch:true,defaultExpanded:true,draggable:false,children:[],icon:'▰'};parent.children.push(f);solutionFolders.set(current,f);}parent=f;}return parent;};
 for(const path of snapshot.solution?.folders??[])solutionFolder(path);
 const owned=new Set();for(const project of projects){const base=directoryName(project.path),node={id:'project:'+project.path,kind:'project',label:project.name??baseName(project.path),path:project.path,project:project.path,projectBase:base,icon:'C#',branch:true,defaultExpanded:true,startup:project.path===startup,draggable:false,children:[]};
  solutionFolder(snapshot.solution?.items?.find(i=>i.kind==='project'&&i.path===project.path)?.folder).children.push(node);
  const dependencies={id:node.id+':dependencies',kind:'dependencies',label:'Dependencies',project:project.path,branch:true,draggable:false,icon:'▱',children:[]};
  for(const [label,kind,values]of [['Projects','project-reference',project.projectReferences??[]],['Packages','package',project.packageReferences??[]],['Assemblies','reference',project.references??[]],['Analyzers','analyzer',project.analyzers??[]]])if(values.length){const group={id:dependencies.id+':'+kind,kind:'dependency-group',label,project:project.path,branch:true,draggable:false,icon:'▱',children:values.map((v,i)=>({id:dependencies.id+':'+kind+':'+i,kind,label:kind==='project-reference'?baseName(v.path??String(v)):v.name??v.path??String(v),path:v.path,project:project.path,metadata:v,badge:v.version??'',icon:kind==='package'?'▣':'◇',draggable:false}))};dependencies.children.push(group);}
  if(project.targetFramework||project.targetFrameworks?.length)dependencies.children.push({id:dependencies.id+':framework',kind:'framework',label:project.targetFrameworks?.join(', ')||project.targetFramework,project:project.path,icon:'◇',draggable:false});
  node.children.push(dependencies);
  const compile=new Set((project.compile??[]).map(f=>f.path));for(const item of project.compile??[]){const file=map.get(item.path)??{path:item.path,kind:'source'},display=item.metadata?.Link??item.link??relativeTo(item.path,base);const outside=display.startsWith('../');addFile(node,file,item.path,outside?'Linked Files/'+baseName(item.path):display,{project:project.path,projectBase:base,included:true,itemType:'Compile',linked:!!item.metadata?.Link||!!item.link||outside,missing:!map.has(item.path),metadata:item.metadata});owned.add(item.path);}
  const explicitItems=new Set();for(const item of project.items??[]){if(item.itemType==='Folder'){addFile(node,{kind:'folder-marker'},item.path+'/.sf-folder',relativeTo(item.path,base)+'/.sf-folder',{project:project.path,projectBase:base});continue;}if(compile.has(item.path)||explicitItems.has(item.path))continue;explicitItems.add(item.path);const display=item.metadata?.Link??relativeTo(item.path,base),outside=display.startsWith('../');addFile(node,map.get(item.path)??{path:item.path},item.path,outside?'Linked Files/'+baseName(item.path):display,{project:project.path,projectBase:base,included:true,itemType:item.itemType,linked:!!item.metadata?.Link||outside,missing:!map.has(item.path),metadata:item.metadata});owned.add(item.path);}
  for(const [path,file]of map){const inside=base?path.startsWith(base+'/'):true,underAnother=projects.some(p=>p.path!==project.path&&directoryName(p.path)!==base&&directoryName(p.path)&&path.startsWith(directoryName(p.path)+'/'));if(inside&&!underAnother&&!compile.has(path)&&!explicitItems.has(path)&&path!==project.path&&(showAll||!['source'].includes(file.kind??(/\.cs$/i.test(path)?'source':'file')))){addFile(node,file,path,relativeTo(path,base),{project:project.path,projectBase:base,excluded:/\.cs$/i.test(path),included:false});owned.add(path);}}
  node.children.push({id:node.id+':xml',kind:'project-file',label:baseName(project.path),path:project.path,project:project.path,icon:'⚙',draggable:false,dirty:dirtySet.has(project.path)});owned.add(project.path);
  for(const path of folders.filter(f=>base?f.startsWith(base+'/'):true)){const display=relativeTo(path,base);if(!display.startsWith('../')){addFile(node,{kind:'folder-marker'},path+'/.sf-folder',display+'/.sf-folder',{project:project.path,projectBase:base});}}
 }
 for(const item of snapshot.solution?.items??[])if(item.kind==='file'){const parent=solutionFolder(item.folder);addFile(parent,map.get(item.path)??{kind:'file'},item.path,baseName(item.path));owned.add(item.path);}
 const others=[...map].filter(([path])=>!owned.has(path)&&path!==snapshot.solution?.path);if(others.length){const group={id:root.id+':items',kind:'solution-folder',label:'Solution Items',branch:true,children:[],icon:'▰',draggable:false};root.children.push(group);for(const [path,file]of others)if(showAll||!/\.cs$/i.test(path))addFile(group,file,path);}
 if(generated.length){root.children.push({id:root.id+':generated',kind:'generated-group',label:'Generated Sources',branch:true,draggable:false,icon:'⚙',children:generated.map(f=>({id:root.id+':generated:'+f.uri,kind:'generated',label:f.uri,path:f.uri,icon:'C#',draggable:false}))});}
 const clean=n=>{if(n.children){n.children=n.children.filter(c=>c.kind!=='folder-marker');n.children.forEach(clean);}};clean(root);attachSymbols(root);sort(root);return [root];
}
/** Exact element spans preserve comments, declarations, quoted delimiters and a BOM. */
function elementSpan(text,node){
 const start=node.start+(text.startsWith('\uFEFF')?1:0),token=/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:"[^"]*"|'[^']*'|[^'">])*?>/g;
 token.lastIndex=start;let depth=0,match,openEnd;
 while((match=token.exec(text))){const value=match[0];if(/^<(?:!|\?)/.test(value))continue;openEnd??=token.lastIndex;
  if(value.startsWith('</'))depth--;else if(!/\/\s*>$/.test(value))depth++;
  if(depth===0)return {start,openEnd,closeStart:match.index,end:token.lastIndex,selfClosing:match.index===start};
 }
 throw new Error('Unterminated XML element');
}
function appendToElement(text,node,fragment){const span=elementSpan(text,node),newline=text.includes('\r\n')?'\r\n':'\n',insert=fragment.replaceAll('\n',newline)+newline;
 if(span.selfClosing){const opening=text.slice(span.start,span.end),slash=opening.lastIndexOf('/');return text.slice(0,span.start)+opening.slice(0,slash)+'>'+newline+insert+'</'+node.name+'>'+text.slice(span.end);}
 return text.slice(0,span.closeStart)+insert+text.slice(span.closeStart);
}
/** Source-preserving XML append. No serialization of unrelated elements/comments. */
function appendToRoot(text,expected,fragment){const root=parseXml(text);if(root.name!==expected)throw new Error('Expected <'+expected+'>');return appendToElement(text,root,fragment);}
export function editProjectMembership(text,{projectPath,path,include=true,itemType='Compile',metadata={}}){
 if(!/^[A-Za-z][\w.]*$/.test(itemType))throw new Error('Invalid MSBuild item type');const relative=relativeTo(validateItemPath(path),directoryName(validateItemPath(projectPath))),op=include?'Include':'Remove';
 const children=Object.entries(metadata).map(([key,value])=>{if(!/^[A-Za-z][\w.]*$/.test(key))throw new Error('Invalid metadata name');return '      <'+key+'>'+xmlEscape(value)+'</'+key+'>';});
 const item=(include?'    <'+itemType+' Remove="'+xmlEscape(relative)+'" />\n':'')+'    <'+itemType+' '+op+'="'+xmlEscape(relative)+'"'+(children.length?'>\n'+children.join('\n')+'\n    </'+itemType+'>':' />');
 return appendToRoot(text,'Project','  <ItemGroup>\n'+item+'\n  </ItemGroup>');
}
function solutionFolderName(name){name=String(name).trim().replace(/^\/+|\/+$/g,'');return '/'+validateItemPath(name)+'/';}
function findFolder(root,name){if(root.name==='Folder'&&root.attributes.Name&&solutionFolderName(root.attributes.Name)===name)return root;for(const child of root.children){const found=findFolder(child,name);if(found)return found;}return null;}
export function addSolutionProject(text,{solutionPath,projectPath,folder=null}){
 projectPath=validateItemPath(projectPath);solutionPath=validateItemPath(solutionPath);const path=relativeTo(projectPath,directoryName(solutionPath)),root=parseXml(text);
 if(root.name!=='Solution')throw new Error('Expected <Solution>');const paths=[];const visit=n=>{if(n.name==='Project'&&n.attributes.Path)paths.push(normalizePath(n.attributes.Path,directoryName(solutionPath)));n.children.forEach(visit);};visit(root);if(paths.includes(projectPath))throw new Error('Project already belongs to this solution');
 const entry='  <Project Path="'+xmlEscape(path)+'" />';if(folder){const name=solutionFolderName(folder),existing=findFolder(root,name);if(existing)return appendToElement(text,existing,'  '+entry);return appendToElement(text,root,'  <Folder Name="'+xmlEscape(name)+'">\n  '+entry+'\n  </Folder>');}
 return appendToElement(text,root,entry);
}
export function addSolutionFolder(text,name){name=solutionFolderName(name);const root=parseXml(text);if(root.name!=='Solution')throw new Error('Expected <Solution>');if(findFolder(root,name))throw new Error('Solution folder already exists');return appendToElement(text,root,'  <Folder Name="'+xmlEscape(name)+'" />');}
/** Rewrite literal path attributes only, never element text, comments or property expressions. */
export function rewriteProjectPath(text,{documentPath,oldPath,newPath}){
 parseXml(text);const base=directoryName(documentPath);return text.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:"[^"]*"|'[^']*'|[^'">])*?>/g,tag=>{
  if(/^<(?:!|\?|\/)/.test(tag))return tag;
  return tag.replace(/(\s+)([A-Za-z_][\w.:-]*)(\s*=\s*)(["'])([\s\S]*?)\4/g,(all,space,key,eq,quote,value)=>{
   if(!['Include','Update','Remove','Path','Project'].includes(key)||/[$@%*?&]/.test(value))return all;let changed=false;
   const parts=value.split(';').map(part=>{try{const resolved=normalizePath(part,base);if(resolved===oldPath||resolved.startsWith(oldPath+'/')){changed=true;return relativeTo(newPath+resolved.slice(oldPath.length),base);}}catch{}return part;});return changed?space+key+eq+quote+xmlEscape(parts.join(';'))+quote:all;
  });
 });
}
/** Remove exact solution membership without reserializing unrelated XML. */
export function removeSolutionProject(text,{solutionPath,projectPath}){
 const bom=text.startsWith('\uFEFF')?1:0,root=parseXml(text);if(root.name!=='Solution')throw new Error('Expected <Solution>');const spans=[];

 const visit=node=>{if((node.name==='Project'&&node.attributes.Path||node.name==='BuildDependency'&&node.attributes.Project)&&normalizePath(node.attributes.Path??node.attributes.Project,directoryName(solutionPath))===projectPath){spans.push({start:node.start+bom,end:elementSpan(text,node).end});return;}node.children.forEach(visit);};visit(root);if(!spans.length)throw new Error('Project does not belong to this solution');for(const span of spans.sort((a,b)=>b.start-a.start))text=text.slice(0,span.start)+text.slice(span.end);parseXml(text);return text;
}
/** Literal named items such as PackageReference: no property evaluation or code execution. */
export function editNamedProjectItem(text,{itemType='PackageReference',name,include=true,metadata={}}){
 if(!['PackageReference','Reference','Analyzer'].includes(itemType)||typeof name!=='string'||!name.trim()||name.length>1024||/[\u0000-\u001f;$@%*?]/.test(name))throw new Error('Invalid literal project item');
 const children=Object.entries(metadata).map(([key,value])=>{if(!/^[A-Za-z][\w.]*$/.test(key))throw new Error('Invalid metadata name');return '      <'+key+'>'+xmlEscape(value)+'</'+key+'>';});
 const item='    <'+itemType+' Remove="'+xmlEscape(name)+'" />'+(include?'\n    <'+itemType+' Include="'+xmlEscape(name)+'"'+(children.length?'>\n'+children.join('\n')+'\n    </'+itemType+'>':' />'):'');return appendToRoot(text,'Project','  <ItemGroup>\n'+item+'\n  </ItemGroup>');
}
/** Rename logical folders, including descendants, without touching disk paths or unrelated XML. */
export function renameSolutionFolder(text,{folder,name}){
 const old=solutionFolderName(folder),next=solutionFolderName(name),root=parseXml(text);if(root.name!=='Solution'||!findFolder(root,old))throw new Error('Solution folder not found');if(next.startsWith(old)&&next!==old)throw new Error('A solution folder cannot be moved into itself');if(next!==old&&findFolder(root,next))throw new Error('Destination solution folder already exists');
 const edits=[];const visit=n=>{if(n.name==='Folder'&&n.attributes.Name){const current=solutionFolderName(n.attributes.Name);if(current===old||current.startsWith(old)){const span=elementSpan(text,n),tag=text.slice(span.start,span.openEnd);const rewritten=tag.replace(/(\bName\s*=\s*)(["'])([\s\S]*?)\2/,(_,p,q)=>p+q+xmlEscape(next+current.slice(old.length))+q);edits.push({start:span.start,end:span.openEnd,text:rewritten});}}n.children.forEach(visit);};visit(root);for(const e of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,e.start)+e.text+text.slice(e.end);parseXml(text);return text;
}
/** Remove only logical folder membership. Physical files and projects are not deleted. */
export function removeSolutionFolder(text,folder){const name=solutionFolderName(folder),root=parseXml(text),spans=[];if(root.name!=='Solution')throw new Error('Expected <Solution>');const visit=n=>{if(n.name==='Folder'&&n.attributes.Name){const current=solutionFolderName(n.attributes.Name);if(current===name||current.startsWith(name)){spans.push(elementSpan(text,n));return;}}n.children.forEach(visit);};visit(root);if(!spans.length)throw new Error('Solution folder not found');for(const s of spans.sort((a,b)=>b.start-a.start))text=text.slice(0,s.start)+text.slice(s.end);parseXml(text);return text;}
/** Move the complete Project element so configurations and BuildDependency metadata survive. */
export function moveSolutionProject(text,{solutionPath,projectPath,folder=null}){let found;const root=parseXml(text);if(root.name!=='Solution')throw new Error('Expected <Solution>');const visit=n=>{if(n.name==='Project'&&n.attributes.Path&&normalizePath(n.attributes.Path,directoryName(solutionPath))===projectPath)found=n;n.children.forEach(visit);};visit(root);if(!found)throw new Error('Project not found in solution');const span=elementSpan(text,found),fragment=text.slice(span.start,span.end);text=text.slice(0,span.start)+text.slice(span.end);let current=parseXml(text);if(folder){const name=solutionFolderName(folder);if(!findFolder(current,name)){text=addSolutionFolder(text,name);current=parseXml(text);}return appendToElement(text,findFolder(current,name),'    '+fragment);}return appendToElement(text,current,'  '+fragment);}
export function addSolutionItem(text,{solutionPath,path,folder='Solution Items'}){const root=parseXml(text);if(root.name!=='Solution')throw new Error('Expected <Solution>');path=validateItemPath(path);let duplicate=false;const visit=n=>{if(n.name==='File'&&n.attributes.Path&&normalizePath(n.attributes.Path,directoryName(solutionPath))===path)duplicate=true;n.children.forEach(visit);};visit(root);if(duplicate)throw new Error('Solution item already exists');const name=solutionFolderName(folder);if(!findFolder(root,name))text=addSolutionFolder(text,name);return appendToElement(text,findFolder(parseXml(text),name),'    <File Path="'+xmlEscape(relativeTo(path,directoryName(solutionPath)))+'" />');}
