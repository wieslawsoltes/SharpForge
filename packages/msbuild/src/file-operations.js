import {readFile,readdir,lstat,mkdir,rename,cp,rm,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {workspacePath} from './contract.js';
import {parseXml} from '@sharpforge/project-system';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Fingerprints include names, file bytes and empty directories. Never follow symlinks. */
async function fingerprint(file,{maxEntries=20000,maxBytes=128*1024*1024}={}){
 let entries=0,bytes=0;const hash=createHash('sha256');
 const walk=async(path,relative,depth=0)=>{if(++entries>maxEntries||depth>48)throw new Error('File operation size/depth limit exceeded');const st=await lstat(path);if(st.isSymbolicLink())throw new Error('File operations do not follow symbolic links');if(st.isDirectory()){hash.update('D\0'+relative+'\0');for(const entry of (await readdir(path)).sort())await walk(resolve(path,entry),relative+'/'+entry,depth+1);}else if(st.isFile()){if((bytes+=st.size)>maxBytes)throw new Error('File operation byte limit exceeded');const content=await readFile(path);if(content.length!==st.size)throw new Error('File changed while taking a snapshot');hash.update('F\0'+relative+'\0'+digest(content)+'\0');}else throw new Error('Only regular files and directories can be changed');};
 const st=await lstat(file);if(st.isSymbolicLink())throw new Error('Symbolic links are not accepted');
 if(st.isFile()){if(st.size>maxBytes)throw new Error('File operation byte limit exceeded');const content=await readFile(file);if(content.length>maxBytes)throw new Error('File operation byte limit exceeded');return {hash:digest(content),size:content.length,kind:'file',entries:1};}
 await walk(file,'');return {hash:hash.digest('hex'),size:bytes,kind:'directory',entries};
}
function mutationPath(path){path=workspacePath(path);if(path.split('/').some(p=>['.git','.vs','.sharpforge','node_modules','.packages'].includes(p)))throw new Error('This path is reserved');return path;}
async function absent(file){try{await lstat(file);}catch(e){if(e.code==='ENOENT')return;throw e;}throw Object.assign(new Error('Destination already exists; overwrites are not implicit'),{status:409});}
async function parents(workspace,path){const parts=path.split('/').slice(0,-1);for(let i=1;i<=parts.length;i++){const part=parts.slice(0,i).join('/');let full;try{full=await workspace.path(part);}catch(e){if(e.code!=='ENOENT')throw e;full=await workspace.path(part,{create:true});await mkdir(full);}if(!(await lstat(full)).isDirectory())throw new Error('Destination parent is not a directory');}}
async function backupDirectory(workspace,id){for(const path of ['.sharpforge','.sharpforge/changes','.sharpforge/changes/'+id]){const file=resolve(workspace.root,path);try{await mkdir(file,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}await workspace.path(path,{internal:true});}return resolve(workspace.root,'.sharpforge/changes',id);}
export async function inspectWorkspaceItem(workspace,path){path=mutationPath(path);return {path,...await fingerprint(await workspace.path(path))};}
/** Serialized by the host. Each completed operation has a checked inverse; batches are not atomic. */
export async function mutateWorkspace(workspace,operations){
 if(!Array.isArray(operations)||!operations.length||operations.length>256)throw new Error('Use 1–256 file operations');
 const plan=operations.map(op=>{if(!['create','mkdir','move','copy','delete','write'].includes(op.kind))throw new Error('Unknown file operation');const path=mutationPath(op.path),destination=op.destination?mutationPath(op.destination):null;if(['move','copy'].includes(op.kind)&&(!destination||destination===path||destination.startsWith(path+'/')))throw new Error('Invalid destination: a folder cannot contain itself');if(!['create','mkdir'].includes(op.kind)&&!/^([a-f0-9]{64})$/.test(op.expectedHash??''))throw new Error('File changes require an inspected SHA-256 snapshot');if(op.base64!==undefined){if(op.kind!=='create'||op.text!==undefined||typeof op.base64!=='string'||op.base64.length>24*1024*1024||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(op.base64))throw new Error('Invalid binary create operation');if(Buffer.from(op.base64,'base64').length>16*1024*1024)throw new Error('Binary file limit exceeded');}
if(['create','write'].includes(op.kind)&&op.base64===undefined&&(typeof op.text!=='string'||Buffer.byteLength(op.text)>workspace.maxTextBytes))throw new Error('New text file size limit exceeded');if(['create','write'].includes(op.kind)&&op.base64===undefined){if(op.text.includes('\0'))throw new Error('Text files cannot contain NUL characters');if(/\.(?:[a-z]*proj|slnx|props|targets|xml|resx|ruleset|runsettings)$/i.test(path))parseXml(op.text,{maxLength:workspace.maxTextBytes,maxNodes:100000});}return {...op,path,destination};});
 const touched=new Set(),destinations=new Set();for(const op of plan){if(touched.has(op.path))throw new Error('Duplicate source in a file operation batch');touched.add(op.path);const destination=op.destination??(['create','mkdir'].includes(op.kind)?op.path:null);if(destination){if(destinations.has(destination))throw new Error('Duplicate destination in a file operation batch');destinations.add(destination);}}
 for(let i=0;i<plan.length;i++)for(let j=i+1;j<plan.length;j++){const a=[plan[i].path,plan[i].destination].filter(Boolean),b=[plan[j].path,plan[j].destination].filter(Boolean);if(a.some(x=>b.some(y=>x===y||x.startsWith(y+'/')||y.startsWith(x+'/'))))throw new Error('Overlapping batch paths require separate file operations');}
 // Enforce portable identity even on case-sensitive disks. Never create shadow aliases.
 const snapshot=await workspace.scan(),existingNames=new Map([...snapshot.files.map(f=>f.path),...snapshot.folders].map(p=>[p.normalize('NFC').toLowerCase(),p])),newNames=new Set(),newParents=new Map();
 for(const op of plan){const target=op.destination??(['create','mkdir'].includes(op.kind)?op.path:null);if(!target)continue;const key=target.normalize('NFC').toLowerCase();if(newNames.has(key))throw new Error('Case-colliding destination in batch: '+target);newNames.add(key);let path=target;while(path){const parentKey=path.normalize('NFC').toLowerCase(),actual=existingNames.get(parentKey)??newParents.get(parentKey);newParents.set(parentKey,path);if(actual&&actual!==path)throw new Error('Destination collides with existing path: '+actual);const slash=path.lastIndexOf('/');path=slash<0?'':path.slice(0,slash);}}
 // Preflight all existing inputs and destinations before the first mutation.
 for(const op of plan){if(!['create','mkdir'].includes(op.kind)){const current=await inspectWorkspaceItem(workspace,op.path);if(current.hash!==op.expectedHash)throw Object.assign(new Error('Disk conflict in '+op.path+'; no operations applied'),{status:409});}const target=op.destination??(['create','mkdir'].includes(op.kind)?op.path:null);if(target){try{await workspace.path(target);throw Object.assign(new Error('Destination already exists: '+target),{status:409});}catch(e){if(e.code!=='ENOENT')throw e;}}}
 const id=randomUUID(),completed=[],inverse=[],backup=await backupDirectory(workspace,id);workspace.fileHistory??=new Map();
 try{
  for(const op of plan){let file;if(!['create','mkdir'].includes(op.kind)){file=await workspace.path(op.path);if((await fingerprint(file)).hash!==op.expectedHash)throw Object.assign(new Error('Disk conflict in '+op.path),{status:409});}
   const target=op.destination??op.path;
   if(['create','mkdir','move','copy'].includes(op.kind)){await parents(workspace,target);const destination=await workspace.path(target,{create:true});await absent(destination);
    if(op.kind==='create')await writeFile(destination,op.base64!==undefined?Buffer.from(op.base64,'base64'):op.text,{flag:'wx',mode:0o644});
    else if(op.kind==='mkdir')await mkdir(destination);
    else if(op.kind==='copy')await cp(file,destination,{recursive:true,errorOnExist:true,force:false,dereference:false,verbatimSymlinks:true});
    else await rename(file,destination);
    const result=await fingerprint(destination);inverse.unshift({kind:op.kind==='move'?'move':'remove',path:target,destination:op.path,expectedHash:result.hash});completed.push({...op,result});
   }else if(op.kind==='write'){const saved=resolve(backup,String(completed.length));await cp(file,saved,{errorOnExist:true,force:false});const result=await workspace.save([{path:op.path,text:op.text,expectedHash:op.expectedHash}]);inverse.unshift({kind:'replace',path:op.path,backup:saved,backupHash:op.expectedHash,expectedHash:result.written[0].hash});completed.push({...op,result:result.written[0]});
   }else {const saved=resolve(backup,String(completed.length));await rename(file,saved);inverse.unshift({kind:'restore',path:op.path,backup:saved,expectedHash:op.expectedHash});completed.push({...op,quarantined:true});}
  }
 }catch(error){error.completed=completed;error.undoToken=completed.length?id:null;error.message+=`; completed: ${completed.length}. Refresh the explorer before retrying.`;throw error;}
 finally{if(inverse.length){workspace.fileHistory.set(id,{inverse,completed});while(workspace.fileHistory.size>32)workspace.fileHistory.delete(workspace.fileHistory.keys().next().value);}}
 return {completed,undoToken:id,atomic:false};
}
export async function undoWorkspaceMutation(workspace,token){
 const record=workspace.fileHistory?.get(token);if(!record)throw new Error('Undo operation is no longer available in this host session');
 for(const op of record.inverse){if(op.kind==='restore'){await absent(resolve(workspace.root,op.path));if((await fingerprint(op.backup)).hash!==op.expectedHash)throw new Error('Quarantined contents changed');}
  else {if(op.kind==='replace'&&(await fingerprint(op.backup)).hash!==op.backupHash)throw new Error('Quarantined contents changed');if((await inspectWorkspaceItem(workspace,op.path)).hash!==op.expectedHash)throw Object.assign(new Error('Cannot undo because '+op.path+' changed'),{status:409});if(op.kind==='move')await absent(resolve(workspace.root,op.destination));}}
 const restored=[];
 for(const op of [...record.inverse]){
  if(op.kind==='restore'){await absent(resolve(workspace.root,op.path));if((await fingerprint(op.backup)).hash!==op.expectedHash)throw new Error('Quarantined contents changed');await parents(workspace,op.path);await rename(op.backup,await workspace.path(op.path,{create:true}));}
  else if(op.kind==='replace'){if((await inspectWorkspaceItem(workspace,op.path)).hash!==op.expectedHash)throw new Error('Disk conflict while undoing '+op.path);await rename(op.backup,await workspace.path(op.path));}
  else if(op.kind==='move'){if((await inspectWorkspaceItem(workspace,op.path)).hash!==op.expectedHash)throw new Error('Disk conflict while undoing '+op.path);await absent(resolve(workspace.root,op.destination));await parents(workspace,op.destination);await rename(await workspace.path(op.path),await workspace.path(op.destination,{create:true}));}
  else {if((await inspectWorkspaceItem(workspace,op.path)).hash!==op.expectedHash)throw new Error('Disk conflict while undoing '+op.path);await rm(await workspace.path(op.path),{recursive:true});}
  restored.push(op.path);record.inverse.shift();
 }
 workspace.fileHistory.delete(token);return {restored,atomic:false};
}
