import {readZip,writeZip,portablePath,decodeWorkspaceFile,encodeWorkspaceFile,ZIP_LIMITS} from '@sharpforge/archive';
export const WORKSPACE_MANIFEST='.sharpforge/workspace.json';
import {validateWorkspaceSettings, workspaceSettingsManifest} from './workspace-settings.js';
export {validateWorkspaceSettings} from './workspace-settings.js';
export {startupActions, startupModes, sessionUserSettingsLimits, sanitizeStartupConfiguration,
  sanitizeLaunchProfileMetadata, sanitizeSessionUserSettings, sessionUserSettingsContributions} from './session-user-settings.js';
export function exportWorkspaceZip({records,folders=[],settings={}},options={}){
 if(!Array.isArray(records)||!Array.isArray(folders))throw new Error('Invalid workspace records');const paths=records.map(f=>portablePath(f.path??f.uri));if(paths.includes(WORKSPACE_MANIFEST))throw new Error('The reserved workspace manifest cannot be an ordinary file');
 const checked=validateWorkspaceSettings(settings,paths),files=records.map((f,i)=>({path:paths[i],bytes:encodeWorkspaceFile(f)}));const directories=[...new Set(folders)].map(path=>({path:portablePath(path,{directory:true}),directory:true}));
 files.push({path:WORKSPACE_MANIFEST,text:workspaceSettingsManifest(checked)});
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
export function prefixWorkspace(records,folders,prefix=''){if(prefix)portablePath(prefix);return {records:records.map(r=>({...r,path:prefix?prefix+'/'+r.path:r.path})),folders:folders.map(p=>prefix?prefix+'/'+p:p)};}
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
/** Read the same bounded settings manifest from an extracted workspace folder. No network or trust state. */
export function importWorkspaceRecords(records,folders=[]){
 const candidates=records.filter(r=>r.path===WORKSPACE_MANIFEST||r.path.endsWith('/'+WORKSPACE_MANIFEST));if(!candidates.length)return {records,folders,settings:{},manifest:false};if(candidates.length!==1)throw new Error('Multiple workspace manifests in selected folder');const file=candidates[0],prefix=file.path.slice(0,-WORKSPACE_MANIFEST.length),source=typeof file.text==='string'?file.text:new TextDecoder('utf-8',{fatal:true}).decode(file.bytes);if(source.length>4*1024*1024)throw new Error('Workspace manifest limit exceeded');const value=JSON.parse(source);if(value.format!=='sharpforge-workspace'||value.version!==1)throw new Error('Unsupported workspace settings manifest');if(prefix&&records.some(r=>!r.path.startsWith(prefix)))throw new Error('Manifest root excludes other selected files');const result=records.filter(r=>r!==file).map(r=>({...r,path:r.path.slice(prefix.length)})),dirs=folders.filter(p=>(!prefix||p.startsWith(prefix))&&!p.endsWith('/.sharpforge')&&p!=='.sharpforge').map(p=>p.slice(prefix.length)).filter(Boolean);return {records:result,folders:dirs,settings:validateWorkspaceSettings(value,result.map(r=>r.path)),manifest:true};
}
export function workspaceManifestRecord(settings,records){const validated=validateWorkspaceSettings(settings,records.map(r=>r.path));return {path:WORKSPACE_MANIFEST,text:workspaceSettingsManifest(validated)};}
