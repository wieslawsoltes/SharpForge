/** Disk reads are explicit and bounded. Symlinks are never traversed. */
import { readdir, readFile, lstat } from 'node:fs/promises';
import { resolve, relative, dirname, sep } from 'node:path';
import { ProjectSystem } from '../../packages/project-system/src/index.js';
export async function loadDiskProject(entry,{root=dirname(resolve(entry)),configuration='Debug',startup=null,maxFiles=5000,maxBytes=128*1024*1024}={}){
  root=resolve(root);entry=resolve(entry);const entryPath=relative(root,entry).split(sep).join('/');
  if(entryPath.startsWith('../')||entryPath==='..'||!entryPath)throw new Error('Project must be inside the selected --root directory');
  if((await lstat(root)).isSymbolicLink())throw new Error('Workspace root cannot be a symlink');
  const records=[];let bytes=0,count=0;
  async function scan(directory,prefix='',depth=0){if(depth>48)throw new Error('Directory depth limit exceeded');
    for(const item of await readdir(directory,{withFileTypes:true})){
      if(++count>maxFiles*4)throw new Error('Directory entry limit exceeded');
      if(item.isSymbolicLink())continue;const path=prefix+item.name,full=resolve(directory,item.name);
      if(item.isDirectory()){if(!['.git','node_modules','.vs'].includes(item.name))await scan(full,path+'/',depth+1);}
      else if(item.isFile()&&/\.(cs|csproj|slnx|props|targets|json|dll|exe|il|md|txt|editorconfig)$/i.test(path)){
        const size=(await lstat(full)).size,binary=/\.(dll|exe)$/i.test(path);bytes+=size;
        if(size>(binary?64*1024*1024:2_000_000)||bytes>maxBytes||records.length>=maxFiles)throw new Error('Workspace file/byte limit exceeded');
        const buffer=await readFile(full);records.push(binary?{path,bytes:new Uint8Array(buffer)}:{path,text:buffer.toString('utf8')});
      }
    }
  }
  await scan(root);const system=new ProjectSystem(records,{configuration}),snapshot=system.load(entryPath);
  const selected=startup?startup.replaceAll('\\','/'):snapshot.projects.find(p=>['exe','winexe'].includes(p.outputType.toLowerCase()))?.path??snapshot.solution.projectPaths[0];
  const project=system.projects.get(selected);if(!project)throw new Error(`Startup project '${selected??entryPath}' was not loaded: ${snapshot.diagnostics.map(d=>d.message).join('; ')}`);
  const closure=system.closure(selected),diagnostics=snapshot.diagnostics.filter(d=>closure.has(d.path)||d.path===entryPath);
  return {system,snapshot,project,files:system.compilationFiles(selected),diagnostics,root};
}
