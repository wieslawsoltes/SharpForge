import {readZip,writeZip,portablePath,decodeWorkspaceFile,encodeWorkspaceFile,ZIP_LIMITS} from '@sharpforge/archive';
import {extractWorkspaceRecords} from './workspace-paths.js';
export const WORKSPACE_MANIFEST='.sharpforge/workspace.json';
import {validateWorkspaceSettings, workspaceSettingsManifest} from './workspace-settings.js';
export {validateWorkspaceSettings} from './workspace-settings.js';
export {startupActions, startupModes, sessionUserSettingsLimits, sanitizeStartupConfiguration,
  sanitizeLaunchProfileMetadata, sanitizeSessionUserSettings, sessionUserSettingsContributions} from './session-user-settings.js';
export function exportWorkspaceZip({records,folders=[],settings={}},options={}){
 if(!Array.isArray(records)||!Array.isArray(folders))throw new Error('Invalid workspace records');const paths=records.map(f=>portablePath(f.path??f.uri));if(paths.includes(WORKSPACE_MANIFEST))throw new Error('The reserved workspace manifest cannot be an ordinary file');
 const checked=validateWorkspaceSettings(settings,paths),files=records.map((f,i)=>({path:paths[i],bytes:encodeWorkspaceFile(f),mode:f.mode,mtime:f.mtime}));const directories=[...new Set(folders)].map(path=>({path:portablePath(path,{directory:true}),directory:true}));
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
 for(const entry of entries){if(entry===manifestEntry||prefix&&entry.path===prefix.slice(0,-1))continue;const path=prefix?entry.path.slice(prefix.length):entry.path;if(!path)continue;if(entry.directory){if(path!=='.sharpforge')folders.push(path);}else records.push({...decodeWorkspaceFile(path,entry.bytes),...(entry.mode!==undefined?{mode:entry.mode,mtime:entry.mtime}:{})});}
 settings=validateWorkspaceSettings(settings,records.map(f=>f.path));return {records,folders,settings,manifest:!!manifestEntry,entryCandidates:workspaceCandidates(records),summary:{files:records.length,folders:folders.length,bytes:records.reduce((n,f)=>n+f.bytes.length,0)}};
}
export function workspaceCandidates(records){return records.filter(f=>/\.(slnx|sln|csproj)$/i.test(f.path??f.uri)).map(f=>f.path??f.uri).sort((a,b)=>{const rank=p=>/\.slnx$/i.test(p)?0:/\.sln$/i.test(p)?1:2;return rank(a)-rank(b)||a.localeCompare(b);});}
export {prefixWorkspace} from './workspace-paths.js';
export {writeNewDirectory} from './destination-writer.js';
export {preflightDestination,DestinationError} from './destination-preflight.js';
export {rollbackDestination} from './destination-rollback.js';
/** Preserve prepared sources while extracting the bounded settings manifest. */
export function importWorkspaceRecords(records,folders=[],options={}){
 return extractWorkspaceRecords(records,folders,{...options,manifestPath:WORKSPACE_MANIFEST,validateSettings:validateWorkspaceSettings});
}
export function workspaceManifestRecord(settings,records){const validated=validateWorkspaceSettings(settings,records.map(r=>r.path));return {path:WORKSPACE_MANIFEST,text:workspaceSettingsManifest(validated)};}
