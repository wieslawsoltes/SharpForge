import {DiskWorkspace} from './disk-workspace.js';
export * from './disk-api.js';
import {portablePath,decodeWorkspaceFile} from '@sharpforge/archive';
const defaults={maxFiles:20000,maxFileBytes:2_000_000,maxAssemblyBytes:64*1024*1024,maxTotalBytes:128*1024*1024};
const ignored=new Set(['.git','node_modules','.vs','.sharpforge']);
const isIgnored=path=>!/(?:^|\/)\.sharpforge\/workspace\.json$/.test(path)&&path.split('/').some(part=>ignored.has(part));
/** Read every selected file, not just C# extensions. Unknown/binary bytes are preserved. */
export async function readBrowserFiles(files,options={}){
 const limits={...defaults,...options},list=[...files];if(list.length>limits.maxFiles)throw new Error('Disk workspace file limit exceeded');let total=0;const records=[],seen=new Set(),folders=new Set(),skipped=[];
 for(const file of list){const path=portablePath(file.webkitRelativePath||file.name);if(isIgnored(path)){skipped.push(path);continue;}const key=path.normalize('NFC').toLowerCase();if(seen.has(key))throw new Error('Duplicate or case-colliding disk path: '+path);seen.add(key);if(file.size>limits.maxAssemblyBytes||(total+=file.size)>limits.maxTotalBytes)throw new Error('Disk workspace byte limit exceeded by '+path);
  const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length!==file.size)throw new Error('File changed while being read: '+path);const record=decodeWorkspaceFile(path,bytes);if(/\.cs$/i.test(path)&&record.text?.length>limits.maxFileBytes)throw new Error('Source file limit exceeded by '+path);records.push(record);let parent=path;while(parent.includes('/')){parent=parent.slice(0,parent.lastIndexOf('/'));folders.add(parent);}}
 Object.defineProperties(records,{folders:{value:[...folders]},skipped:{value:skipped}});return records;
}
export async function readDirectory(handle,options={}){
 const limits={...defaults,...options},records=[],handles=new Map(),folders=[],skipped=[],seen=new Set();let total=0,entries=0;
 async function visit(dir,prefix='',depth=0){if(depth>48)throw new Error('Disk directory depth limit exceeded');for await(const [name,child]of dir.entries()){if(++entries>limits.maxFiles*4)throw new Error('Directory entry limit exceeded');const path=portablePath(prefix?prefix+'/'+name:name),key=path.normalize('NFC').toLowerCase();if(ignored.has(name)){if(name==='.sharpforge'&&child.kind==='directory'){try{const saved=await (await child.getFileHandle('workspace.json')).getFile();if(saved.size>4*1024*1024||(total+=saved.size)>limits.maxTotalBytes||records.length>=limits.maxFiles)throw new Error('Workspace manifest or total byte limit exceeded');records.push(decodeWorkspaceFile(path+'/workspace.json',new Uint8Array(await saved.arrayBuffer())));}catch(error){if(error.name!=='NotFoundError')throw error;}}else skipped.push(path);continue;}if(seen.has(key))throw new Error('Case-colliding directory path: '+path);seen.add(key);
  if(child.kind==='directory'){folders.push(path);await visit(child,path,depth+1);}else if(child.kind==='file'){const file=await child.getFile();if(file.size>limits.maxAssemblyBytes||(total+=file.size)>limits.maxTotalBytes||records.length>=limits.maxFiles)throw new Error('Disk workspace byte/file limit exceeded by '+path);const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length!==file.size)throw new Error('File changed while being read');const record=decodeWorkspaceFile(path,bytes);if(/\.cs$/i.test(path)&&record.text?.length>limits.maxFileBytes)throw new Error('Source file limit exceeded');records.push(record);if(typeof record.text==='string')handles.set(path,child);}}
 }
 await visit(handle);return new DiskWorkspace(records,handles,handle.name,folders,skipped);
}
