import {mkdir, writeFile,lstat} from 'node:fs/promises';
import {resolve, join, dirname,relative,sep,isAbsolute} from 'node:path';
import {parseArgs} from 'node:util';
import {writeZip, readZip} from '../../../packages/archive/src/index.js';
import {files, revision, hash, isMain,readRegular} from './common.js';

// ZIP's UTC-independent DOS fields have two-second precision. No host timestamps,
// permissions, directory enumeration order, compression version, or extra fields.
export function canonicalZip(entries,epoch) {
  if(!Number.isSafeInteger(epoch)||epoch<315532800||epoch>4354819199)throw new Error('SOURCE_DATE_EPOCH must be an integer in ZIP date range 1980–2107');
  const date=new Date(epoch*1000),time=(date.getUTCHours()<<11)|(date.getUTCMinutes()<<5)|(date.getUTCSeconds()>>1),day=((date.getUTCFullYear()-1980)<<9)|((date.getUTCMonth()+1)<<5)|date.getUTCDate();
  const bytes=writeZip(entries),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let central=view.getUint32(bytes.length-6,true);
  while(view.getUint32(central,true)===0x02014b50){
    const local=view.getUint32(central+42,true);
    view.setUint16(local+10,time,true);view.setUint16(local+12,day,true);
    view.setUint16(central+12,time,true);view.setUint16(central+14,day,true);
    central+=46+view.getUint16(central+28,true)+view.getUint16(central+30,true)+view.getUint16(central+32,true);
  }
  readZip(bytes);return bytes;
}
export async function packageRelease({root=process.cwd(),epoch,output}={}) {
  root=resolve(root);epoch??=process.env.SOURCE_DATE_EPOCH===undefined?(await revision(root)).epoch:Number(process.env.SOURCE_DATE_EPOCH);
  if(!(await lstat(root)).isDirectory())throw new Error('Package root must be a real directory');
  const paths=await files(join(root,'dist'));if(!paths.length)throw new Error('Cannot package empty dist tree');
  const entries=[];let total=0;for(const path of paths){const bytes=await readRegular(join(root,'dist',path));total+=bytes.length;if(total>128*1024*1024)throw new Error('Browser archive total input limit exceeded');entries.push({path,bytes});}
  const bytes=canonicalZip(entries,epoch),target=resolve(root,output??'artifacts/SharpForge-browser.zip');
  const local=relative(root,target);if(!local||local==='..'||local.startsWith('..'+sep)||isAbsolute(local))throw new Error('Browser archive output escapes package root');
  let current=root;for(const part of relative(root,dirname(target)).split(sep).filter(Boolean)){current=join(current,part);await mkdir(current,{recursive:true});if(!(await lstat(current)).isDirectory())throw new Error('Browser archive output parent is not a real directory');}
  const existing=await lstat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(existing&&!existing.isFile())throw new Error('Browser archive output is not a regular file');
  await writeFile(target,bytes);
  return {path:target,bytes:bytes.length,sha256:hash(bytes),epoch,files:entries.length};
}
if(isMain(import.meta.url)){
  const {values}=parseArgs({options:{root:{type:'string',default:'.'},epoch:{type:'string'},output:{type:'string'}}});
  console.log(JSON.stringify(await packageRelease({...values,epoch:values.epoch===undefined?undefined:Number(values.epoch)})));
}
