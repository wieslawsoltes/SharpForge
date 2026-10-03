import { normalizePath } from './paths.js';
import {portablePath,decodeWorkspaceFile,encodeWorkspaceFile} from '@sharpforge/archive';
const defaults={maxFiles:20000,maxFileBytes:2_000_000,maxAssemblyBytes:64*1024*1024,maxTotalBytes:128*1024*1024};
async function currentText(handle,path){const file=await handle.getFile();if(typeof file.arrayBuffer==='function'){const decoded=decodeWorkspaceFile(path,new Uint8Array(await file.arrayBuffer()));if(typeof decoded.text!=='string')throw new Error('Disk source changed to binary: '+path);return decoded.text;}return file.text();}
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
export class DiskWorkspace {
  constructor(records,handles=new Map(),name='Selected files',folders=[],skipped=[]){this.records=records;this.handles=handles;this.name=name;this.folders=folders;this.skipped=skipped;this.baseline=new Map(records.filter(f=>typeof f.text==='string').map(f=>[f.path,f.text]));}
  /** Explicit save only. Preflight every file and report per-file writes; never claims atomic multi-file I/O. */
  async save(changes){
    const seen=new Set(),pending=[];
    for(const change of changes){const path=normalizePath(change.path??change.uri);if(seen.has(path))throw new Error('Duplicate save path');seen.add(path);if(typeof change.text!=='string'||change.text.length>2_000_000)throw new Error('Invalid save text');const handle=this.handles.get(path);if(!handle)throw new Error(`No write handle for '${path}'; export or reopen its folder.`);const current=await currentText(handle,path);if(current!==this.baseline.get(path))throw new Error(`Disk conflict in '${path}'; no files were written. Reopen the folder before saving.`);pending.push({path,text:change.text,handle});}
    // Resolve permissions for every file before opening any write stream.
    for(const file of pending){if(typeof file.handle.queryPermission==='function'){
      let permission=await file.handle.queryPermission({mode:'readwrite'});
      if(permission!=='granted'&&typeof file.handle.requestPermission==='function')permission=await file.handle.requestPermission({mode:'readwrite'});
      if(permission!=='granted')throw new Error(`Write permission denied for '${file.path}'; no files were written.`);
    }}
    // Recheck after prompts; a file may have changed while the user was deciding.
    for(const file of pending)if(await currentText(file.handle,file.path)!==this.baseline.get(file.path))throw new Error(`Disk conflict in '${file.path}'; no files were written. Reopen the folder before saving.`);
    const written=[];
    for(const file of pending){let stream;try{stream=await file.handle.createWritable();const original=this.records.find(r=>r.path===file.path);const content=original?.bytes?encodeWorkspaceFile({...original,text:file.text}):file.text;await stream.write(content);await stream.close();written.push(file.path);this.baseline.set(file.path,file.text);const record=this.records.find(f=>f.path===file.path);if(record)record.text=file.text;}catch(error){try{await stream?.abort();}catch{}const failure=new Error(`Save failed for '${file.path}'. Written before failure: ${written.join(', ')||'none'}. ${error.message}`);failure.written=written;throw failure;}}
    return {written,atomic:false};
  }
}
