import { hashBytes, readNativeText, encodeNativeText } from './workspace-io.js';
import { readFile, readdir, realpath, lstat, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { resolve, relative, dirname, sep, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseXml, ProjectSystem } from '@sharpforge/project-system';
import { isWorkspaceTextPath } from '@sharpforge/archive';
import {inspectWorkspaceItem,mutateWorkspace,undoWorkspaceMutation} from './file-operations.js';
import { workspacePath } from './contract.js';
export { hashBytes } from './workspace-io.js';
const projectPattern=/\.(?:[a-z]*proj|slnx|sln)$/i;
const ignored=new Set(['.git','.vs','node_modules','.sharpforge','.packages','bin','obj']);
export class NativeWorkspace {
 static async open(root,options={}){const canonical=await realpath(resolve(root));if(!(await lstat(canonical)).isDirectory())throw new Error('Workspace root must be a directory');return new NativeWorkspace(canonical,options);}
 constructor(root,{maxFiles=20000,maxTextBytes=4*1024*1024,maxArtifactBytes=128*1024*1024}={}){this.root=root;this.maxFiles=maxFiles;this.maxTextBytes=maxTextBytes;this.maxArtifactBytes=maxArtifactBytes;}
 relative(path){const result=relative(this.root,path).split(sep).join('/');return !result.startsWith('../')&&result!=='..'&&!result.startsWith('/')?result:null;}
 /** Disallow all symlink components in API paths, including output files. Builds themselves are trusted native code. */
 async path(input,{create=false,internal=false}={}){
  const name=workspacePath(input),parts=name.split('/');if(!internal&&parts.some(p=>['.git','.sharpforge','node_modules'].includes(p)))throw new Error('This workspace path is reserved');
  let current=this.root;for(let i=0;i<parts.length;i++){current=resolve(current,parts[i]);let info;try{info=await lstat(current);}catch(error){if(error.code==='ENOENT'&&create&&i===parts.length-1)return current;throw error;}
   if(info.isSymbolicLink())throw new Error('Symbolic links are not followed by workspace APIs');if(i<parts.length-1&&!info.isDirectory())throw new Error('Workspace path parent is not a directory');}
  if(this.relative(current)===null)throw new Error('Workspace path escaped its root');return current;
 }
 async scan(){
  const files=[],folders=[];let entries=0;const walk=async(dir,prefix='',depth=0)=>{if(depth>48)throw new Error('Workspace directory depth exceeded');
   const children=await readdir(dir,{withFileTypes:true});children.sort((a,b)=>a.name.localeCompare(b.name));
   for(const child of children){if(++entries>this.maxFiles*5)throw new Error('Workspace entry limit exceeded');if(child.isSymbolicLink())continue;const path=prefix+child.name;
    if(child.isDirectory()){if(!ignored.has(child.name)){folders.push(path);await walk(resolve(dir,child.name),path+'/',depth+1);}}
    else if(child.isFile()){if(files.length>=this.maxFiles)throw new Error('Workspace file limit exceeded');const info=await lstat(resolve(dir,child.name));files.push({path,size:info.size,kind:/\.slnx?$/i.test(path)?'solution':projectPattern.test(path)?'project':/\.(props|targets)$/i.test(path)?'build':/\.(cs|vb|fs)$/i.test(path)?'source':/\.(dll|exe)$/i.test(path)?'assembly':'file'});}
   }
  };await walk(this.root);
  const projects=files.filter(f=>f.kind==='project').map(f=>f.path),solutions=files.filter(f=>f.kind==='solution').map(f=>f.path),records=files.map(f=>({path:f.path,text:''}));
  let loadedBytes=0;for(const f of records.filter(f=>/\.(csproj|slnx|sln|props|targets)$/i.test(f.path)).slice(0,512)){try{const value=await this.read(f.path);if((loadedBytes+=value.size)>8*1024*1024)break;f.text=value.text;}catch{}}
  let hierarchy=null;try{const system=new ProjectSystem(records,{maxFiles:this.maxFiles}),entry=solutions.find(p=>p.endsWith('.slnx'))??solutions.find(p=>p.endsWith('.sln'))??projects.find(p=>p.endsWith('.csproj'));if(entry){hierarchy=system.load(entry);hierarchy.inspectionOnly=true;}}catch{}
  return {name:this.root.split(sep).at(-1),root:this.root,files,folders,projects,solutions,hierarchy};
 }
 async read(input){const file=await this.path(input);if(!isWorkspaceTextPath(input)&&!projectPattern.test(input))throw new Error('File type is not editable');return readNativeText(this,file,input);}
 async save(changes){
  if(!Array.isArray(changes)||!changes.length||changes.length>256)throw new Error('Save requires 1–256 changes');
  const seen=new Set(),pending=[];let total=0;
  for(const c of changes){const path=workspacePath(c.path);if(seen.has(path))throw new Error('Duplicate save path');seen.add(path);if(!isWorkspaceTextPath(path)&&!projectPattern.test(path))throw new Error('File type is not editable');if(typeof c.text!=='string'||Buffer.byteLength(c.text)>this.maxTextBytes||(total+=Buffer.byteLength(c.text))>32*1024*1024)throw new Error('Save text limit exceeded');
   if(c.expectedHash!==null&&(typeof c.expectedHash!=='string'||!/^([a-f0-9]{64})$/.test(c.expectedHash)))throw new Error('Save requires the previous SHA-256 hash (or null for new files)');
   if(/\.(?:[a-z]*proj|slnx|props|targets|pubxml|xml|resx|ruleset|runsettings)$/i.test(path))parseXml(c.text,{maxLength:this.maxTextBytes,maxNodes:100000});
   const file=await this.path(path,{create:c.expectedHash===null});let current=null;try{current=await this.read(path);}catch(e){if(!(e.code==='ENOENT'&&c.expectedHash===null))throw e;}
   if(current?.hash!==(c.expectedHash??undefined))throw Object.assign(new Error(`Disk conflict in '${path}'; no files were written`),{status:409});
   const original=current?await readFile(file):undefined;const bytes=encodeNativeText(path,c.text,current,original);if(bytes.length>this.maxTextBytes)throw new Error('Encoded text file size limit exceeded');pending.push({path,file,bytes,expectedHash:c.expectedHash,hash:hashBytes(bytes)});
  }
  // Preflight all buffers, then recheck immediately before each rename. Multi-file saves are not atomic.
  const written=[];
  for(const c of pending){let temp;try{await this.path(c.path,{create:c.expectedHash===null});
    if(c.expectedHash===null){await writeFile(c.file,c.bytes,{flag:'wx',mode:0o644});}
    else {const old=await this.read(c.path);if(old.hash!==c.expectedHash)throw Object.assign(new Error(`Disk conflict in '${c.path}'`),{status:409});
     temp=c.file+'.sharpforge-'+randomBytes(8).toString('hex');const mode=(await lstat(c.file)).mode&0o777;await writeFile(temp,c.bytes,{flag:'wx',mode});
     if((await this.read(c.path)).hash!==c.expectedHash)throw Object.assign(new Error(`Disk conflict in '${c.path}'`),{status:409});await rename(temp,c.file);temp=null;
    }
    written.push({path:c.path,hash:c.hash});
   }catch(error){if(temp)await unlink(temp).catch(()=>{});error.written=written;error.message+=`; written before failure: ${written.map(x=>x.path).join(', ')||'none'}`;throw error;}
  }
  return {written,atomic:false};
 }
 inspectItem(path){return inspectWorkspaceItem(this,path);}
 mutate(operations){return mutateWorkspace(this,operations);}
 undoMutation(token){return undoWorkspaceMutation(this,token);}
 async jobDirectory(id){
  if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid job identifier');
  for(const path of ['.sharpforge','.sharpforge/msbuild',`.sharpforge/msbuild/${id}`]){const full=resolve(this.root,path);try{await mkdir(full,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}await this.path(path,{internal:true});}
  return resolve(this.root,'.sharpforge/msbuild',id);
 }
 async artifact(input){const file=await this.path(input,{internal:true}),info=await lstat(file);if(!info.isFile()||info.size>this.maxArtifactBytes)throw new Error('Artifact size limit exceeded');const bytes=await readFile(file);if(bytes.length>this.maxArtifactBytes)throw new Error('Artifact size limit exceeded');return bytes;}
 async outputs(project){
  const roots=[dirname(project)],found=[];const seen=new Set();
  const walk=async(path,depth=0)=>{if(depth>8||found.length>=512)return;let entries;try{entries=await readdir(await this.path(path),{withFileTypes:true});}catch{return;}
   for(const item of entries){if(found.length>=512)break;if(item.isSymbolicLink())continue;const child=path+'/'+item.name;if(item.isDirectory())await walk(child,depth+1);else if(item.isFile()&&/\.(dll|exe|pdb|nupkg|snupkg|json|deps\.json|binlog)$/i.test(item.name)){const info=await lstat(resolve(this.root,child));if(info.size<=this.maxArtifactBytes&&!seen.has(child)){seen.add(child);found.push({path:child,size:info.size,modified:info.mtime.toISOString()});}}}
  };
  for(const root of roots){const prefix=root==='.'?'':root+'/';await walk(prefix+'bin');}
  return found;
 }
}
