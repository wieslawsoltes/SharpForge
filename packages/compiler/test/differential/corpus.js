/**
 * Fixture corpus and pinned-result storage for the Roslyn differential harness (SF-A02-T40).
 *
 * This module does not import the compiler, so the pinning tool can run even while the compiler is being reworked.
 * Pinned results live in `pinned/<feature>.json`, one fixture per line, keyed by fixture id and guarded by a content
 * hash so that an edited fixture with a stale pin is detected instead of silently compared against old results.
 */
import {readFileSync,writeFileSync,existsSync,readdirSync,mkdirSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {fixtures as basics} from './fixtures/basics.js';
import {fixtures as flow} from './fixtures/flow.js';
import {fixtures as types} from './fixtures/types.js';
import {fixtures as library} from './fixtures/library.js';
import {profileFlow} from './fixtures/profile-flow.js';

/** Directory of the differential harness. */
export const root=dirname(fileURLToPath(import.meta.url));
/** Directory holding the pinned Roslyn results. */
export const pinnedDirectory=join(root,'pinned');
/** Path of the checked-in pass baseline. */
export const baselinePath=join(root,'baseline.json');

/** Stable content hash of what Roslyn was shown for a fixture (language version + source). */
export function fixtureHash(fixture){return createHash('sha256').update((fixture.langVersion??'')+'\0'+fixture.source).digest('hex').slice(0,16);}

/** Every fixture `{id,feature,kind,langVersion?,source}`, validated for unique ids and well-formed fields. */
export function loadFixtures(){
  const all=[...basics,...flow,...types,...library,...profileFlow],seen=new Set();
  for(const f of all){
    if(typeof f.id!=='string'||!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(f.id))throw new Error(`Invalid fixture id ${JSON.stringify(f.id)}`);
    if(seen.has(f.id))throw new Error(`Duplicate fixture id ${f.id}`);seen.add(f.id);
    if(f.kind!=='output'&&f.kind!=='diagnostics')throw new Error(`${f.id}: kind must be 'output' or 'diagnostics'`);
    if(typeof f.source!=='string'||!f.source.trim())throw new Error(`${f.id}: empty source`);
  }
  return all;
}

/** Pinned Roslyn results as `{meta,results:Map<id,{hash,kind,langVersion,diagnostics,output?,exception?,exitCode?}>}`. */
export function loadPinned(){
  const results=new Map();let meta=null;
  if(!existsSync(pinnedDirectory))return {meta,results};
  for(const name of readdirSync(pinnedDirectory).filter(n=>n.endsWith('.json')).sort()){
    const document=JSON.parse(readFileSync(join(pinnedDirectory,name),'utf8'));meta??=document.roslyn;
    for(const [id,value] of Object.entries(document.fixtures))results.set(id,value);
  }
  return {meta,results};
}

/** Rewrite `pinned/*.json` from a complete `Map<id,result>`; one file per feature, one fixture per line. */
export function savePinned(meta,fixtures,results){
  rmSync(pinnedDirectory,{recursive:true,force:true});mkdirSync(pinnedDirectory,{recursive:true});
  const byFeature=new Map();
  for(const f of fixtures){if(!byFeature.has(f.feature))byFeature.set(f.feature,[]);byFeature.get(f.feature).push(f);}
  for(const [feature,list] of byFeature){
    const rows=list.map(f=>`  ${JSON.stringify(f.id)}:${JSON.stringify(results.get(f.id))}`);
    writeFileSync(join(pinnedDirectory,feature+'.json'),`{"roslyn":${JSON.stringify(meta)},"shape":"diagnostics are [code, startOffset, length, severity]; output is stdout with \\\\n newlines","fixtures":{\n${rows.join(',\n')}\n}}\n`);
  }
}

/** The checked-in baseline `{diagnostics,warnings,bytecode,cil}` (arrays of fixture ids), or empty lists. */
export function loadBaseline(){
  const empty={diagnostics:[],warnings:[],bytecode:[],cil:[]};
  return existsSync(baselinePath)?{...empty,...JSON.parse(readFileSync(baselinePath,'utf8'))}:empty;
}

/** Write the baseline with one fixture id per line so diffs stay reviewable. */
export function saveBaseline(baseline){
  const axis=name=>`  ${JSON.stringify(name)}:[\n${[...baseline[name]].sort().map(id=>'    '+JSON.stringify(id)).join(',\n')}\n  ]`;
  writeFileSync(baselinePath,`{\n${['diagnostics','warnings','bytecode','cil'].map(axis).join(',\n')}\n}\n`);
}
