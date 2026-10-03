import {readFileSync,realpathSync} from 'node:fs';
import {dirname,relative,resolve,isAbsolute} from 'node:path';
import {clean,git,json,sha} from './core.js';
/** Extensions must be committed in one clean owner checkout, pinned for the run. */
export function pinRegistry(path){
 if(!path)return {rows:[],identity:null,verify(){}};
 path=realpathSync(path);const root=realpathSync(git(dirname(path),'rev-parse','--show-toplevel')),commit=clean(root),rows=json(path);
 if(!Array.isArray(rows))throw new Error('Registry must be an array');
 const tracked=file=>{file=realpathSync(file);const name=relative(root,file).replaceAll('\\','/');if(name==='..'||name.startsWith('../')||isAbsolute(name))throw new Error('Registry module must belong to its owner checkout');git(root,'ls-files','--error-unmatch','--',name);return {path:name,sha256:sha(readFileSync(file))};};
 const registry=tracked(path),modules=rows.map(row=>{if(typeof row.module!=='string'||!row.module)throw new Error('Registry adapter needs a module');return {id:row.id,...tracked(resolve(dirname(path),row.module))};});
 return {rows,identity:{commit,...registry,modules},verify(){if(clean(root)!==commit)throw new Error('Registry owner changed during measurement');for(const record of [registry,...modules])if(sha(readFileSync(resolve(root,record.path)))!==record.sha256)throw new Error('Registry bytes changed during measurement');}};
}
