import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs, isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { isMain, readJSON, writeJSON, report, git } from './lib/io.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,(_key,value)=>typeof value==='bigint'?{$bigint:String(value)}:value);
/** Red nodes are derived parent-linked facades; green allocation IDs are process-local. */
export function syntaxSnapshot(syntax) {
  const {syntax: redFacade, ...snapshot} = syntax;
  return JSON.stringify(snapshot, function(key, value) {
    if (key === 'id' && (this.isNode || this.isToken || this.isTrivia)) return undefined;
    // Interned trivia caches its own singleton list; it is a derived facade, not syntax content.
    if (key === 'asList' && this.isTrivia) return undefined;
    return typeof value === 'bigint' ? {$bigint: String(value)} : value;
  });
}
export function filesUnder(root,directory) {
  const files=[];
  const walk=path=>{
    for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      const full=resolve(path,entry.name);
      if(entry.isSymbolicLink())throw new Error(`Golden input contains symlink: ${full}`);
      if(entry.isDirectory())walk(full); else if(entry.isFile())files.push(relative(root,full).split(sep).join('/'));
    }
  };
  walk(resolve(root,directory));return files.sort();
}
export async function goldenOutput({root=process.cwd(),build=true}={}) {
  root=resolve(root);
  if(build){
    const child=spawnSync(process.execPath,['scripts/build.js'],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024});
    if(child.status!==0)throw new Error(child.stderr||child.error?.message||'Build failed');
  }
  const load=path=>import(pathToFileURL(resolve(root,path)));
  const [{compileToIL},{parse},{SourceText},{serializeImage}]=await Promise.all([
    load('packages/compiler/src/index.js'),load('packages/syntax/src/index.js'),load('packages/text/src/index.js'),load('packages/bytecode/src/index.js'),
  ]);
  const examples=[];
  for(const input of filesUnder(root,'examples').filter(path=>path.endsWith('.cs'))){
    const source=readFileSync(resolve(root,input),'utf8'),syntax=parse(new SourceText(source,input)),result=compileToIL([{text:source,uri:input,version:0}]);
    examples.push({input,source:hash(source),syntax:hash(syntaxSnapshot(syntax)),status:result.success?'emitted':'not-emitted',
      diagnostics:hash(json(result.diagnostics)),assembly:result.success?hash(result.assembly):null,bytecode:result.success?hash(serializeImage(result.image)):null});
  }
  if(!examples.length)throw new Error('Examples corpus is empty');
  const bundles=filesUnder(root,'dist').map(path=>({path,sha256:hash(readFileSync(resolve(root,path)))}));
  if(!bundles.length)throw new Error('Distribution corpus is empty');
  return {schemaVersion:1,algorithm:'sha256',mode:'Each C# example is compiled independently; project fragments and intentional errors retain diagnostics and syntax hashes.',examples,bundles};
}
export function compareGolden(expected,actual){
  const changes=[];
  for(const group of ['examples','bundles']){
    const identity=group==='examples'?'input':'path',before=new Map(expected[group].map(row=>[row[identity],row])),after=new Map(actual[group].map(row=>[row[identity],row]));
    if(before.size!==expected[group].length||after.size!==actual[group].length)throw new Error(`Duplicate ${group} output identity`);
    for(const path of [...new Set([...before.keys(),...after.keys()])].sort()){
      const old=before.get(path),value=after.get(path);
      if(!isDeepStrictEqual(old,value))changes.push({group,path,kind:!old?'added':!value?'removed':'changed',before:old??null,after:value??null});
    }
  }
  for(const key of ['schemaVersion','algorithm','mode'])if(expected[key]!==actual[key])changes.push({group:'format',path:key,kind:'changed',before:expected[key],after:actual[key]});
  return {passed:changes.length===0,changes,errors:changes.map(change=>`${change.group} ${change.kind}: ${change.path}`)};
}
export function checkSeamLock({base,head='HEAD',labels=[],root=process.cwd()}){
  if(!labels.includes('seam'))return {errors:[]};
  const path='planning/contracts/golden-output.lock.json',before=git(['show',`${base}:${path}`],root),after=git(['show',`${head}:${path}`],root);
  return {errors:before===after?[]:['A seam-labelled PR must preserve golden-output.lock.json; split intentional behavior/output changes into a reviewed PR']};
}
if(isMain(import.meta.url)){
  const {values}=parseArgs({options:{root:{type:'string',default:'.'},write:{type:'boolean',default:false},base:{type:'string'},labels:{type:'string',default:''}}});
  const path=resolve(values.root,'planning/contracts/golden-output.lock.json'),actual=await goldenOutput(values);
  if(values.write){
    if(values.labels.split(',').includes('seam'))throw new Error('Cannot regenerate a seam-labelled baseline');
    writeJSON(path,actual);report({examples:actual.examples.length,emitted:actual.examples.filter(row=>row.status==='emitted').length,bundles:actual.bundles.length,errors:[]});
  }else{
    const result=compareGolden(readJSON(path),actual);
    if(values.base)result.errors.push(...checkSeamLock({...values,labels:values.labels.split(',')}).errors);
    report({...result,passed:result.errors.length===0});
  }
}
