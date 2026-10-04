import {isDeepStrictEqual} from 'node:util';
import {nativeExitStatus} from '../native-exit-status.js';
import {sha256} from './fixtures.js';
const engineOrder=['source-vm','cil-vm','clr-sharpforge','clr-roslyn','rust-native','rust-wasm'];
const statuses=['completed','compile-error','runtime-error','host-error','unsupported','cancelled','budget-exceeded'];
function text(value,tags){
  value=String(value??'');if(tags.includes('newlines'))value=value.replace(/\r\n?/g,'\n');
  if(tags.includes('float-format'))value=value.replace(/^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[+-]?Infinity|NaN)$/gm,token=>{if(/^[+-]?\d+$/.test(token))return /^-0+$/.test(token)?'-0':BigInt(token).toString();const number=Number(token);return Object.is(number,-0)?'-0':String(number);});
  if(tags.includes('wall-clock'))value=value.replace(/^clock=-?\d+(?:\.\d+)?$/gm,'clock=<normalised>');
  if(tags.includes('unordered-lines')){const trailing=value.endsWith('\n');value=value.replace(/\n$/,'').split('\n').sort().join('\n')+(trailing?'\n':'');}
  return value;
}
export function normalise(record,fixture){
  if(!record||!engineOrder.includes(record.engine)||!statuses.includes(record.status)||typeof record.stdout!=='string'||typeof record.stderr!=='string'||!Array.isArray(record.diagnostics))throw new Error('Malformed engine result');
  const tags=fixture.normalisers,exception=record.exception?{type:record.exception.type,message:record.exception.message}:null;
  if(exception&&tags.includes('exception-text')){exception.type=exception.type.replace(/^System\./,'');exception.message=exception.message.replace(/\r\n?/g,'\n').trim().replace(/\.$/,'');}
  const exitCode=record.exitCode===null?null:record.exitCodeKind==='process'?record.exitCode:nativeExitStatus(record.exitCode);
  return {status:record.status,stdout:text(record.stdout,tags),stderr:exception?'':text(record.stderr,tags),exitCode,exception,diagnostics:record.diagnostics.filter(d=>d.severity==='error').map(d=>({code:d.code,severity:d.severity})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'))};
}
export function differenceSignature(difference){return JSON.stringify({class:difference.class,engines:difference.engines,statuses:difference.statuses,phase:difference.phase});}
export function classify(fixture,repetitions){
  if(!Array.isArray(repetitions)||repetitions.length<2)throw new Error('At least two observations are required');
  const normalized=repetitions.map(records=>Object.fromEntries(records.map(record=>[record.engine,normalise(record,fixture)]))),first=repetitions[0],differences=[];
  if(repetitions.some(records=>new Set(records.map(r=>r.engine)).size!==records.length)||normalized.some(rows=>JSON.stringify(Object.keys(rows).sort())!==JSON.stringify(Object.keys(normalized[0]).sort())))throw new Error('Missing or duplicate engine observation');
  const add=(kind,engines,reason,phase='execute')=>{const observations=engines.map(engine=>normalized[0][engine]);const d={class:kind,engines,reason,phase,statuses:observations.map(r=>r?.status??'missing'),observations};d.signature=differenceSignature(d);d.fingerprint=sha256(JSON.stringify({inputHash:fixture.inputHash,...d}));differences.push(d);};
  const unstable=new Set();for(const engine of Object.keys(normalized[0]))if(normalized.slice(1).some(rows=>!isDeepStrictEqual(rows[engine],normalized[0][engine]))){unstable.add(engine);add('fixture-nondeterminism',[engine],'Repeated same-seed observations differ');}
  const records=Object.fromEntries(first.map(r=>[r.engine,r])),assemblies=new Map(),invalidAssemblies=new Set();
  // Every executing observation must identify the same emitted bytes on every repetition.
  // Source VM has no DLL; its indirect attribution below relies on validated native/CIL peers.
  for(const engine of ['cil-vm','clr-sharpforge','clr-roslyn','rust-native','rust-wasm']){
    const observed=repetitions.map(rows=>rows.find(record=>record.engine===engine));
    const executed=observed.filter(record=>record&&['completed','runtime-error'].includes(record.status));
    if(!executed.length)continue;
    const hashes=executed.map(record=>record.artifactHash);
    if(hashes.some(hash=>typeof hash!=='string'||!/^([a-f0-9]{64})$/.test(hash))||new Set(hashes).size!==1){
      invalidAssemblies.add(engine);add('unclassified',[engine],'Missing, malformed or changing assembly provenance across repetitions','compile');
    }else if(executed.length===repetitions.length)assemblies.set(engine,hashes[0]);
  }
  const usable=engine=>records[engine]&&!unstable.has(engine)&&!invalidAssemblies.has(engine)&&!['unsupported','host-error','cancelled','budget-exceeded'].includes(records[engine].status),equal=(a,b)=>isDeepStrictEqual(normalized[0][a],normalized[0][b]);
  const sameAssembly=engine=>assemblies.has('clr-sharpforge')&&assemblies.has(engine)&&assemblies.get('clr-sharpforge')===assemblies.get(engine);
  for(const record of first)if(['host-error','cancelled','budget-exceeded'].includes(record.status))add('host',[record.engine],record.error??record.status,record.phase);
  for(const engine of ['source-vm','cil-vm','clr-sharpforge','clr-roslyn'])if(!records[engine])add('unclassified',[engine],'Required comparison engine is missing','host');
  if(usable('clr-roslyn')&&usable('clr-sharpforge')&&!equal('clr-roslyn','clr-sharpforge'))add('compiler',['clr-roslyn','clr-sharpforge'],'Roslyn and SharpForge emitted programs differ on the same pinned CLR',records['clr-roslyn'].status==='compile-error'||records['clr-sharpforge'].status==='compile-error'?'compile':'execute');
  if(usable('clr-sharpforge'))for(const engine of ['cil-vm','rust-native','rust-wasm'])if(usable(engine)){
    if(records['clr-sharpforge'].status==='compile-error'||records[engine].status==='compile-error'){
      if(!equal('clr-sharpforge',engine))add('compiler',['clr-sharpforge',engine],'Compilation acceptance differs','compile');
    }else if(!sameAssembly(engine))add('unclassified',['clr-sharpforge',engine],'Runtime comparison did not use identical assembly bytes');
    else if(!equal('clr-sharpforge',engine))add('runtime',['clr-sharpforge',engine],'Identical emitted DLL behaves differently',records[engine].phase);
  }
  if(usable('source-vm')&&usable('cil-vm')&&!equal('source-vm','cil-vm')){
    if(records['source-vm'].status==='compile-error'||records['cil-vm'].status==='compile-error')add('compiler',['source-vm','cil-vm'],'Source and IL compilation acceptance differs','compile');
    else if(usable('clr-sharpforge')&&usable('clr-roslyn')&&sameAssembly('cil-vm')&&assemblies.has('clr-roslyn')&&equal('clr-sharpforge','clr-roslyn')&&equal('cil-vm','clr-sharpforge'))add('runtime',['clr-sharpforge','source-vm'],'Source VM differs from agreeing emitted-DLL/native-reference paths');
    else if(!differences.some(d=>d.class==='compiler'||d.class==='runtime'))add('unclassified',['source-vm','cil-vm'],'Insufficient native evidence to locate source/CIL divergence');
  }
  return {differences,unsupported:first.filter(r=>r.status==='unsupported').map(r=>({engine:r.engine,reason:r.reason??'Adapter reported unsupported'})),normalised:normalized};
}
