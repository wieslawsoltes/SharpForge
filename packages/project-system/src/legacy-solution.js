import {normalizePath,directoryName,baseName} from './paths.js';
import {xmlEscape} from './xml.js';
/** Data-only classic .sln reader. Never executes solution/project content. */
export function readLegacySolution(text,path){
 if(typeof text!=='string'||text.length>4*1024*1024||!text.replace(/^\uFEFF/,'').includes('Microsoft Visual Studio Solution File'))throw new Error('Not a supported classic Visual Studio solution');
 const nodes=new Map(),nested=new Map(),items=[];let current=null,section=null;const diagnostics=[];
 for(const line of text.split(/\r?\n/)){
  const project=/^\s*Project\("\{([\da-f-]+)\}"\)\s*=\s*"([^"]*)",\s*"([^"]*)",\s*"\{([\da-f-]+)\}"\s*$/i.exec(line);
  if(project){if(nodes.size>=1000)throw new Error('Solution project limit exceeded');const id=project[4].toLowerCase();if(nodes.has(id))throw new Error('Duplicate solution project ID');current={id,type:project[1].toLowerCase(),name:project[2],raw:project[3],files:[]};current.folder=['2150e333-8fdc-42a3-9474-1a3956d46de8','66a26720-8fb5-11d2-aa7e-00c04f688dde'].includes(current.type);if(!current.folder)try{current.path=normalizePath(current.raw,directoryName(path));}catch(error){throw new Error('Unsafe solution project path: '+current.raw);}nodes.set(id,current);continue;}
  if(/^\s*EndProject\s*$/.test(line)){current=null;section=null;continue;}
  const group=/^\s*(?:Global|Project)Section\(([^)]+)\)/.exec(line);if(group){section=group[1];continue;}
  if(/^\s*End(?:Global|Project)Section/.test(line)){section=null;continue;}
  if(section==='NestedProjects'){const match=/\{([\da-f-]+)\}\s*=\s*\{([\da-f-]+)\}/i.exec(line);if(match)nested.set(match[1].toLowerCase(),match[2].toLowerCase());}
  if(section==='SolutionItems'&&current?.folder){const value=line.trim().split(/\s*=\s*/)[0];if(value)current.files.push(normalizePath(value,directoryName(path)));}
 }
 const folderPath=id=>{const parts=[],seen=new Set();let node=nodes.get(id);while(node){if(seen.has(node.id))throw new Error('Solution folder cycle');seen.add(node.id);if(node.folder){const name=node.name.replaceAll('\\','/').replace(/^\/+|\/+$/g,'');if(!name||name.split('/').includes('..'))throw new Error('Invalid solution folder name');parts.unshift(name);}const parent=nested.get(node.id);if(parent&&!nodes.get(parent)?.folder)throw new Error('Missing or invalid solution folder parent');node=nodes.get(parent);}return parts.length?'/'+parts.join('/')+'/':'';};
 const folders=[],projectPaths=[];for(const n of nodes.values()){const folder=folderPath(n.id);if(n.folder){folders.push(folder);for(const file of n.files)items.push({kind:'file',path:file,folder});}else{if(/\.csproj$/i.test(n.path)){projectPaths.push(n.path);items.push({kind:'project',path:n.path,folder});}else diagnostics.push({path,message:'Project type requires its native toolchain: '+n.path,severity:'warning',code:'SFP1301'});}}
 return {path,name:baseName(path).replace(/\.sln$/i,''),folders:[...new Set(folders)],items,projectPaths,legacy:true,diagnostics};
}
/** Explicit conversion leaves the original .sln unchanged. Paths stay relative to the chosen new solution. */
export function convertLegacySolution(text,path,target=path.replace(/\.sln$/i,'.slnx')){
 const solution=readLegacySolution(text,path),relative=(p)=>{let a=directoryName(target).split('/').filter(Boolean),b=p.split('/');while(a.length&&b.length&&a[0]===b[0]){a.shift();b.shift();}return [...a.map(()=>'..'),...b].join('/');};
 let xml='<Solution>\n';for(const folder of solution.folders){xml+='  <Folder Name="'+xmlEscape(folder)+'">\n';for(const item of solution.items.filter(i=>i.folder===folder))xml+='    <'+(item.kind==='project'?'Project':'File')+' Path="'+xmlEscape(relative(item.path))+'" />\n';xml+='  </Folder>\n';}for(const item of solution.items.filter(i=>!i.folder))xml+='  <'+(item.kind==='project'?'Project':'File')+' Path="'+xmlEscape(relative(item.path))+'" />\n';return {path:target,text:xml+'</Solution>\n',warnings:['Classic solution configuration mappings and unsupported project types are not converted; the original .sln is retained.',...solution.diagnostics.map(d=>d.message)]};
}
