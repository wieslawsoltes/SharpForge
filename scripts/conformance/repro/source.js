import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile, chmod, utimes} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {readZip} from '../../../packages/archive/src/index.js';
import {git, revision, hash, abortIfNeeded} from './common.js';

export const sourceLimits={maxEntries:30000,maxTotalBytes:512*1024*1024,maxArchiveBytes:512*1024*1024};
export async function sourceTree(root,commit) {
  const raw=await git(root,['ls-tree','-rz','--full-tree',commit]),tree=new Map();
  for(const row of raw.split('\0').filter(Boolean)){
    const match=/^(100644|100755) blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(row);
    if(!match)throw new Error(`Unsupported source tree entry: ${row}`);
    tree.set(match[3],{mode:match[1],oid:match[2]});
  }
  if(!tree.size)throw new Error('Empty source commit');return tree;
}
export function verifySource(bytes,tree) {
  const entries=readZip(bytes,sourceLimits),roots=new Set(entries.map(entry=>entry.path.split('/')[0]));
  if(roots.size!==1)throw new Error('Source archive must have exactly one root directory');
  const root=[...roots][0],output=[],seen=new Set();
  for(const entry of entries){
    if(entry.directory)continue;
    if(!entry.path.startsWith(root+'/'))throw new Error('File at archive root');
    const path=entry.path.slice(root.length+1),expected=tree.get(path);
    if(!expected||seen.has(path))throw new Error(`Unexpected source archive path: ${path}`);
    const oid=createHash('sha1').update(`blob ${entry.bytes.length}\0`).update(entry.bytes).digest('hex');
    if(oid!==expected.oid)throw new Error(`Source archive does not match commit: ${path}`);
    seen.add(path);output.push({...entry,path,mode:expected.mode});
  }
  for(const path of tree.keys())if(!seen.has(path))throw new Error(`Missing source archive path: ${path}`);
  return output;
}
export async function extractSource({archive,root,commit,destination,reverse=false,mtime,signal}) {
  const bytes=await readFile(archive),entries=verifySource(bytes,await sourceTree(root,commit));
  await mkdir(destination,{recursive:false});
  for(const entry of reverse?[...entries].reverse():entries){
    abortIfNeeded(signal);const target=join(destination,entry.path);
    await mkdir(dirname(target),{recursive:true});await writeFile(target,entry.bytes);await chmod(target,entry.mode==='100755'?0o755:0o644);
    if(mtime!==undefined)await utimes(target,mtime,mtime);
  }
  return {sha256:hash(bytes),files:entries.length};
}
export async function createSourceArchive({root,ref='HEAD',output,signal}) {
  const {commit,epoch}=await revision(root,ref);
  await git(root,['archive','--format=zip','--prefix=SharpForge/',`--output=${output}`,commit],{signal});
  return {commit,epoch,archive:output};
}
