import {readFile} from 'node:fs/promises';
import {posix,resolve,join} from 'node:path';
import {parseArgs} from 'node:util';
import {git,readJSON,cli,isMain} from './common.js';
import {verifyManifest} from '../source-manifest.js';

const identity=value=>value.trim().replace(/\s+/g,' ').toLowerCase();
// Parse balanced inline destinations, reference definitions/uses, autolinks and
// HTML href/src attributes. Fenced and inline code are examples, not links.
export function markdownLinks(markdown) {
  const text=markdown.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1\s*$/gm,'').replace(/(`+)[\s\S]*?\1/g,''),links=[],definitions=new Map();
  const destination=value=>{const match=/^\s*(?:<([^>]+)>|((?:\\.|[^\s])+))/.exec(value);return match?(match[1]??match[2]).replace(/\\([\s\S])/g,'$1'):null;};
  for(const match of text.matchAll(/^ {0,3}\[([^\]]+)\]:\s*(.+)$/gm)){
    const url=destination(match[2]);if(url){definitions.set(identity(match[1]),url);links.push(url);}
  }
  for(let index=0;index<text.length;index++){
    if(text[index]!=='['||text[index-1]==='\\')continue;
    const end=text.indexOf(']',index+1);if(end<0)continue;
    const label=text.slice(index+1,end);let cursor=end+1;
    if(text[cursor]==='('){
      let depth=1,angle=false,quote=null,body='';
      for(cursor++;cursor<text.length;cursor++){
        const character=text[cursor];
        if(character==='\\'&&cursor+1<text.length){body+=character+text[++cursor];continue;}
        if(character==='<'&&!quote)angle=true;if(character==='>'&&!quote)angle=false;
        if(!angle){if(quote){if(character===quote)quote=null;}else if((character==='"'||character==="'")&&/\s/.test(text[cursor-1]))quote=character;else if(character==='(')depth++;else if(character===')'&&--depth===0)break;}
        body+=character;
      }
      const url=destination(body);if(depth===0&&url)links.push(url);else if(depth!==0)throw new Error(`Unclosed Markdown link: ${label}`);
      index=cursor;
    }else if(text[cursor]==='['){
      const finish=text.indexOf(']',cursor+1);if(finish<0)throw new Error(`Unclosed reference link: ${label}`);
      const key=identity(text.slice(cursor+1,finish)||label);if(!definitions.has(key))throw new Error(`Undefined link reference: ${key}`);links.push(definitions.get(key));index=finish;
    }else if(text[cursor]!==':'&&definitions.has(identity(label)))links.push(definitions.get(identity(label)));
  }
  for(const match of text.matchAll(/<(https?:\/\/[^>\s]+)>|\b(?:href|src)\s*=\s*["']([^"']+)["']/gi))links.push(match[1]??match[2]);
  return [...new Set(links)];
}
export function checkLink(document,url,{tracked,assets=new Set()}) {
  if(/^(?:https?:)?\/\//i.test(url))return {kind:'external',url};
  if(/^(?:mailto|tel):/i.test(url)||url.startsWith('#'))return {kind:'anchor-or-contact',url};
  if(/^[a-z][\w+.-]*:/i.test(url))throw new Error(`Unsupported link scheme in ${document}: ${url}`);
  const raw=url.split(/[?#]/,1)[0];let decoded;try{decoded=decodeURIComponent(raw);}catch{throw new Error(`Malformed encoded link in ${document}: ${url}`);}
  if(!decoded)return {kind:'anchor-or-contact',url};
  if(decoded.includes('\\')||/[\0-\x1f]/.test(decoded))throw new Error(`Unsafe link in ${document}: ${url}`);
  const path=posix.normalize(decoded.startsWith('/')?decoded.slice(1):posix.join(posix.dirname(document),decoded));
  if(path==='..'||path.startsWith('../'))throw new Error(`Link escapes source tree in ${document}: ${url}`);
  if(tracked.has(path))return {kind:'tracked-file',path};
  if([...tracked].some(file=>file.startsWith(path.replace(/\/$/,'')+'/')))return {kind:'tracked-directory',path};
  if(assets.has(path))return {kind:'release-asset',path};
  throw new Error(`Missing tracked file or release artifact in ${document}: ${url} (${path})`);
}
export async function checkLinks({root=process.cwd(),assets,external=false,signal,fetcher=fetch}={}) {
  root=resolve(root);const tracked=new Set((await git(root,['ls-files','-z'])).split('\0').filter(Boolean)),assetPaths=new Set();
  if(assets){const directory=resolve(assets),manifest=await readJSON(join(directory,'SOURCE-MANIFEST.json'));await verifyManifest(directory,manifest);for(const file of manifest.files){assetPaths.add(file.path);assetPaths.add('artifacts/'+file.path);}}
  const documents=[...tracked].filter(path=>path==='README.md'||path==='CHANGELOG.md'||/^docs\/[^/]+\.md$/.test(path)).sort(),links=[],errors=[];
  for(const document of documents){
    let urls;try{urls=markdownLinks(await readFile(join(root,document),'utf8'));}catch(error){errors.push(error.message);continue;}
    for(const url of urls)try{links.push({document,...checkLink(document,url,{tracked,assets:assetPaths})});}catch(error){errors.push(error.message);}
  }
  const remote=[];
  if(external)for(const url of [...new Set(links.filter(link=>link.kind==='external').map(link=>link.url))]){
    try{const response=await fetcher(url.startsWith('//')?'https:'+url:url,{method:'HEAD',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(15000)])});if(!response.ok)throw new Error(`HTTP ${response.status}`);remote.push({url,status:response.status});}
    catch(error){errors.push(`External link ${url}: ${error.message}`);}
  }
  return {schemaVersion:1,passed:!errors.length,documents:documents.length,links:links.length,external:external?'checked':'not requested; scheduled workflow only',remote,errors};
}
if(isMain(import.meta.url)){
  const {values}=parseArgs({options:{root:{type:'string',default:'.'},assets:{type:'string'},external:{type:'boolean'}}});
  if(values.external&&process.env.GITHUB_EVENT_NAME!=='schedule')throw new Error('External links are checked only in the scheduled workflow');
  await cli(signal=>checkLinks({...values,signal}),{report:'artifacts/results/repro/links.json'});
}
