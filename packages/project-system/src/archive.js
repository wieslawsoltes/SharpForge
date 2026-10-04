import {readZip,writeZip,portablePath,decodeWorkspaceFile,encodeWorkspaceFile,ZIP_LIMITS} from '@sharpforge/archive';
import {extractWorkspaceRecords} from './workspace-paths.js';
export const WORKSPACE_MANIFEST='.sharpforge/workspace.json';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const safeString=(value,max=4096)=>typeof value==='string'&&value.length<=max;
/** Only data settings are restored. No plugin code, host URLs, trust flags or absolute paths are accepted. */
export function validateWorkspaceSettings(input={},paths=[]){
 if(!object(input))throw new Error('Invalid workspace settings');const available=new Set(paths),hasPath=p=>{portablePath(p);if(!available.has(p))throw new Error('Workspace entry is missing: '+p);return p;};const out={};
 if(input.langVersion!==undefined){if(typeof input.langVersion!=='string'||!/^(?:[1-9]|1[0-4]|preview)$/.test(input.langVersion))throw new Error('Invalid workspace language version');out.langVersion=input.langVersion;}
 if(input.name!==undefined){if(!safeString(input.name,200)||!input.name)throw new Error('Invalid workspace name');out.name=input.name;}
 if(input.mode!==undefined){if(!['solution','project','folder'].includes(input.mode))throw new Error('Invalid workspace mode');out.mode=input.mode;}
 if(input.entry!=null){out.entry=hasPath(input.entry);if(!/\.(slnx|sln|csproj)$/i.test(out.entry))throw new Error('Invalid workspace entry type');}
 if(input.startup!=null){out.startup=hasPath(input.startup);if(!/\.csproj$/i.test(out.startup))throw new Error('Invalid startup project');}
 for(const name of ['configuration','platform'])if(input[name]!==undefined){if(!safeString(input[name],128)||!input[name])throw new Error('Invalid '+name);out[name]=input[name];}
 if(input.active&&available.has(input.active))out.active=hasPath(input.active);
 if(input.tabs!==undefined){if(!Array.isArray(input.tabs)||input.tabs.length>200)throw new Error('Too many open documents');out.tabs=[...new Set(input.tabs.filter(p=>available.has(p)).map(hasPath))];}
 out.breakpoints=Object.create(null);let count=0;
 if(input.breakpoints!==undefined&&!object(input.breakpoints))throw new Error('Invalid breakpoints');
 for(const [path,points]of Object.entries(input.breakpoints??{})){
  portablePath(path);if(!Array.isArray(points)||(count+=points.length)>10000)throw new Error('Breakpoint limit exceeded');if(!available.has(path))continue;
  out.breakpoints[path]=points.map(point=>{if(!object(point)||!Number.isInteger(point.line)||point.line<1||point.line>2000000)throw new Error('Invalid source breakpoint');const bp={line:point.line};if(point.column!==undefined){if(!Number.isInteger(point.column)||point.column<1||point.column>2000000)throw new Error('Invalid breakpoint column');bp.column=point.column;}
   for(const key of ['enabled','oneShot'])if(point[key]!==undefined){if(typeof point[key]!=='boolean')throw new Error('Invalid breakpoint flag');bp[key]=point[key];}
   for(const key of ['condition','hitCondition','logMessage'])if(point[key]!==undefined){if(!safeString(point[key]))throw new Error('Invalid breakpoint expression');bp[key]=point[key];}
   if(point.conditionMode!==undefined){if(!['whenTrue','whenChanged'].includes(point.conditionMode))throw new Error('Invalid condition mode');bp.conditionMode=point.conditionMode;}return bp;});
 }
 const functions=input.functionBreakpoints??[];if(!Array.isArray(functions)||functions.length>1000)throw new Error('Function breakpoint limit exceeded');out.functionBreakpoints=functions.map(bp=>{if(!object(bp)||!safeString(bp.name)||!bp.name)throw new Error('Invalid function breakpoint');const item={name:bp.name};for(const key of ['condition','hitCondition','logMessage'])if(bp[key]!==undefined){if(!safeString(bp[key]))throw new Error('Invalid function breakpoint expression');item[key]=bp[key];}for(const key of ['enabled','oneShot'])if(bp[key]!==undefined){if(typeof bp[key]!=='boolean')throw new Error('Invalid function breakpoint flag');item[key]=bp[key];}if(bp.conditionMode!==undefined){if(!['whenTrue','whenChanged'].includes(bp.conditionMode))throw new Error('Invalid function breakpoint mode');item.conditionMode=bp.conditionMode;}return item;});
 if(input.extensions!=null){if(!object(input.extensions)||JSON.stringify(input.extensions).length>4*1024*1024)throw new Error('Invalid built-in extension settings');const ext={};for(const key of ['buildInfo','analyzers','schema','schemaProperties'])if(input.extensions[key]!==undefined){if(typeof input.extensions[key]!=='boolean')throw new Error('Invalid extension switch');ext[key]=input.extensions[key];}if(input.extensions.version!==undefined){if(!safeString(input.extensions.version,200))throw new Error('Invalid generated version');ext.version=input.extensions.version;}
  const additional=input.extensions.additionalFiles??[];if(!Array.isArray(additional)||additional.length>100)throw new Error('Extension input limit exceeded');ext.additionalFiles=additional.map(f=>{if(!safeString(f.uri,1024)||!safeString(f.text,2*1024*1024))throw new Error('Invalid generator input');return {uri:f.uri,text:f.text};});
  if(input.extensions.severities){if(!object(input.extensions.severities))throw new Error('Invalid analyzer settings');ext.severities={};for(const [key,value]of Object.entries(input.extensions.severities)){if(!/^SFAN\d{4}$/.test(key)||!['default','none','hint','info','warning','error'].includes(value))throw new Error('Invalid analyzer severity');ext.severities[key]=value;}}out.extensions=ext;
 }
 return out;
}
export function exportWorkspaceZip({records,folders=[],settings={}},options={}){
 if(!Array.isArray(records)||!Array.isArray(folders))throw new Error('Invalid workspace records');const paths=records.map(f=>portablePath(f.path??f.uri));if(paths.includes(WORKSPACE_MANIFEST))throw new Error('The reserved workspace manifest cannot be an ordinary file');
 const checked=validateWorkspaceSettings(settings,paths),files=records.map((f,i)=>({path:paths[i],bytes:encodeWorkspaceFile(f)}));const directories=[...new Set(folders)].map(path=>({path:portablePath(path,{directory:true}),directory:true}));
 const manifest={format:'sharpforge-workspace',version:1,...checked};files.push({path:WORKSPACE_MANIFEST,text:JSON.stringify(manifest,null,2)+'\n'});
 return writeZip([...files,...directories],options);
}
/** Plain ZIPs and ZIPs with one top-level repository folder both work. The selected root is explicit. */
export function importWorkspaceZip(bytes,options={}){
 const entries=readZip(bytes,options),manifests=entries.filter(e=>!e.directory&&(e.path===WORKSPACE_MANIFEST||e.path.endsWith('/'+WORKSPACE_MANIFEST)));
 if(manifests.length>1)throw new Error('Multiple workspace manifests; open a narrower ZIP or remove the ambiguous manifests');
 const manifestEntry=manifests[0],prefix=manifestEntry?manifestEntry.path.slice(0,-WORKSPACE_MANIFEST.length):'';let settings={};
 if(manifestEntry){if(manifestEntry.bytes.length>4*1024*1024)throw new Error('Workspace manifest limit exceeded');settings=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestEntry.bytes));if(settings.format!=='sharpforge-workspace'||settings.version!==1)throw new Error('Unsupported workspace manifest');if(prefix&&entries.some(e=>!e.path.startsWith(prefix)&&e.path!==prefix.slice(0,-1)))throw new Error('Files outside the manifest root would be lost; use a plain ZIP or a single workspace root');}
 const records=[],folders=[];
 for(const entry of entries){if(entry===manifestEntry||prefix&&entry.path===prefix.slice(0,-1))continue;const path=prefix?entry.path.slice(prefix.length):entry.path;if(!path)continue;if(entry.directory){if(path!=='.sharpforge')folders.push(path);}else records.push(decodeWorkspaceFile(path,entry.bytes));}
 settings=validateWorkspaceSettings(settings,records.map(f=>f.path));return {records,folders,settings,manifest:!!manifestEntry,entryCandidates:workspaceCandidates(records),summary:{files:records.length,folders:folders.length,bytes:records.reduce((n,f)=>n+f.bytes.length,0)}};
}
export function workspaceCandidates(records){return records.filter(f=>/\.(slnx|sln|csproj)$/i.test(f.path??f.uri)).map(f=>f.path??f.uri).sort((a,b)=>{const rank=p=>/\.slnx$/i.test(p)?0:/\.sln$/i.test(p)?1:2;return rank(a)-rank(b)||a.localeCompare(b);});}
export {prefixWorkspace} from './workspace-paths.js';
/** New-folder save: collision preflight; no existing file is ever overwritten. Partial failure is explicit. */
export async function writeNewDirectory(handle,{records,folders=[]},{signal}={}){
 if(!handle||handle.kind!=='directory')throw new Error('Select a destination folder');const entries=records.map(r=>({path:portablePath(r.path??r.uri),bytes:encodeWorkspaceFile(r)}));const directories=[...new Set(folders.map(p=>portablePath(p)))];
 // Reuse archive structural validation before touching the selected directory.
 writeZip([...entries,...directories.map(path=>({path,directory:true}))]);
 const permission=await handle.queryPermission?.({mode:'readwrite'});if(permission&&permission!=='granted'&&await handle.requestPermission?.({mode:'readwrite'})!=='granted')throw new Error('Write permission denied');
 let count=0;for await(const _ of handle.entries()){if(++count)throw new Error('Choose an empty destination folder; existing content is never overwritten');}
 const cache=new Map([['',handle]]),written=[];async function directory(path){if(cache.has(path))return cache.get(path);const slash=path.lastIndexOf('/'),parent=await directory(slash<0?'':path.slice(0,slash)),name=path.slice(slash+1);const result=await parent.getDirectoryHandle(name,{create:true});cache.set(path,result);return result;}
 try{for(const path of directories){signal?.throwIfAborted();await directory(path);}for(const file of entries){signal?.throwIfAborted();const slash=file.path.lastIndexOf('/'),parent=await directory(slash<0?'':file.path.slice(0,slash)),name=file.path.slice(slash+1);try{await parent.getFileHandle(name);throw new Error('Destination changed while saving: '+file.path);}catch(error){if(error.name!=='NotFoundError')throw error;}
    const target=await parent.getFileHandle(name,{create:true}),stream=await target.createWritable();try{await stream.write(file.bytes);await stream.close();written.push(file.path);}catch(error){await stream.abort().catch(()=>{});throw error;}}
 }catch(cause){const error=new Error(`${cause.message}; ${written.length} file(s) written before failure. No preexisting file was intentionally overwritten.`,{cause});error.name=cause.name;error.written=written;throw error;}
 return {written,atomic:false};
}
export function importWorkspaceRecords(records,folders=[],options={}){
 return extractWorkspaceRecords(records,folders,{...options,manifestPath:WORKSPACE_MANIFEST,validateSettings:validateWorkspaceSettings});
}
export function workspaceManifestRecord(settings,records){const validated=validateWorkspaceSettings(settings,records.map(r=>r.path));return {path:WORKSPACE_MANIFEST,text:JSON.stringify({format:'sharpforge-workspace',version:1,...validated},null,2)+'\n'};}
