import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
export function negotiate(offered,supported){for(const key of Object.keys(supported))if(offered?.[key]!==supported[key]){const e=new Error(`Unsupported ${key}: ${offered?.[key]}`);e.code='ABI_VERSION';throw e;}if(Object.keys(offered).some(k=>!Object.hasOwn(supported,k)))throw Object.assign(new Error('Unknown version component'),{code:'ABI_VERSION'});return {...supported};}
/** Follow explicit relative re-exports without executing package initialization code. */
export function sourceVersion(path,constant,seen=new Set()){
  const key=path+':'+constant;if(seen.has(key)||seen.size>=16)return NaN;seen.add(key);
  const source=readFileSync(path,'utf8'),direct=source.match(new RegExp(`export\\s+const\\s+${constant}\\s*=\\s*(\\d+)\\s*;`));
  if(direct)return Number(direct[1]);
  for(const match of source.matchAll(/export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)){
    const binding=match[1].split(',').map(s=>s.trim().split(/\s+as\s+/)).find(parts=>(parts[1]??parts[0])===constant);
    if(binding&&match[2].startsWith('.'))return sourceVersion(resolve(dirname(path),match[2]),binding[0],seen);
  }
  return NaN;
}
export function checkVersions(root=fileURLToPath(new URL('../../../',import.meta.url))){
  const registry=JSON.parse(readFileSync(resolve(root,'planning/contracts/versions.json'),'utf8'));
  for(const [key,path,constant] of [['framework','packages/framework/src/index.js','ABI_VERSION'],['bytecode','packages/bytecode/src/index.js','FORMAT_VERSION'],['value','scripts/planning/abi/value-codec.js','ABI_VERSION']])if(sourceVersion(resolve(root,path),constant)!==registry[key])throw new Error(`${key} version drift`);
  return negotiate(registry,{framework:1,bytecode:1,value:1,metadata:1});
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(checkVersions()));
