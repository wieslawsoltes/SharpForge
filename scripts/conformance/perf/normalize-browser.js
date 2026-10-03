import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {args,isMain,json,environment,benchmark,report,sha,writeJson,clean} from './core.js';
export function verifyTraces(raw,directory){for(const trace of raw.traces??[]){if(!/^[-\w]+\.zip$/.test(trace.path??'')||sha(readFileSync(resolve(directory,trace.path)))!==trace.sha256)throw new Error('Browser trace digest mismatch');}}
export function normalizeBrowser(raw,env){
 if(raw.schemaVersion!==1||raw.commit!==env.commit||!raw.browser||!['chromium','firefox','webkit'].includes(raw.engine)||raw.correctness!==true||!Array.isArray(raw.traces)||raw.traces.length<3)throw new Error('Invalid actual browser evidence');
 if(raw.traces.some(t=>!t.path||!/^[-\w]+\.zip$/.test(t.path)||!/^([a-f0-9]{64})$/.test(t.sha256)))throw new Error('Malformed browser trace identity');
 const names=['startup','firstCompile','typing','toolActivation'];
 for(const name of names)if(!Array.isArray(raw.samples[name])||raw.samples[name].length<3)throw new Error('Missing browser measurements '+name);
 const rows=names.map(name=>benchmark({id:'A20/browser-'+name,area:'A20',engine:raw.engine,samples:raw.samples[name],coldSamples:name==='startup'?raw.samples[name]:[],checksum:'real-studio-'+name,metrics:{browser:raw.browser,traces:raw.traces,measurement:raw.measurement[name]}}));
 return report(rows,{...env,browser:raw.browser},{unsupported:raw.unsupported??[]});
}
if(isMain(import.meta.url)){const a=args(),head=clean(a.root),raw=json(a.input),env=environment(a.root);verifyTraces(raw,dirname(resolve(a.input)));if(head!==raw.commit)throw new Error('Browser checkout changed');writeJson(a.output,normalizeBrowser(raw,env));}
