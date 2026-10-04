/**
 * Pins real Roslyn results for the differential fixtures (SF-A02-T40).
 *
 *   node packages/compiler/test/differential/tools/pin.mjs [--dotnet <path>] [--scratch <dir>] [--changed] [--list]
 *     [--only <exact-id[,exact-id...]>] (repeatable)
 *
 * Builds tools/Program.cs + tools/pin.csproj in a scratch directory (default node_modules/.sf/differential/pin), runs
 * selected fixtures through Roslyn and updates their pins. Needs a .NET SDK; the test run itself never does.
 * Every program runs in a process of its own (see Program.cs), so a pin does not depend on the fixtures around it and
 * a full re-pin of an unchanged corpus rewrites nothing. `--changed` pins only the fixtures whose pin is missing or
 * stale and keeps the other pins as they are (same Roslyn required; a full run is the reference).
 * `--only` restricts that set to exact fixture ids; unknown, duplicate and empty selections fail before building.
 * Unrelated pin files remain byte-for-byte unchanged. `--list` prints only the captured ids and their source hashes.
 * The run fails (and writes nothing) when a fixture contradicts its declared kind: an 'output' fixture must compile
 * without errors and finish in time, a 'diagnostics' fixture must produce at least one error or warning.
 */
import {execFileSync} from 'node:child_process';
import {mkdirSync,copyFileSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {root,pinnedDirectory,loadFixtures,loadPinned,fixtureHash} from '../corpus-store.js';
import {selectPinnedFixtures,writeSelectedPins} from './pin-selection.mjs';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:null;};
const home=join(homedir(),'.dotnet','dotnet');
const dotnet=option('--dotnet')??process.env.DOTNET??(existsSync(home)?home:'dotnet');
const scratch=resolve(option('--scratch')??'node_modules/.sf/differential/pin');
const fixtures=loadFixtures(),previous=loadPinned();
const current=f=>{const p=previous.results.get(f.id);return !!p&&p.hash===fixtureHash(f)&&p.kind===f.kind;};
const selected=selectPinnedFixtures(args,fixtures,current);
if(!selected.length){console.log('No fixtures require capture.');process.exit(0);}

mkdirSync(scratch,{recursive:true});
for(const name of ['Program.cs','pin.csproj'])copyFileSync(join(root,'tools',name),join(scratch,name));
const input=join(scratch,'input.json'),output=join(scratch,'output.json');
// What Roslyn is shown: the source and the options a fixture carries (language version, /unsafe).
const inputOf=f=>({id:f.id,langVersion:f.langVersion??null,allowUnsafe:!!f.allowUnsafe,source:f.source});
writeFileSync(input,JSON.stringify(selected.map(inputOf)));
const env={...process.env,DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_NOLOGO:'1',DOTNET_SKIP_FIRST_TIME_EXPERIENCE:'1'};
execFileSync(dotnet,['build',join(scratch,'pin.csproj'),'-c','Release','-o',join(scratch,'out'),'--nologo','-v','q'],{stdio:'inherit',env});
execFileSync(dotnet,[join(scratch,'out','pin.dll'),input,output],{stdio:'inherit',env});

const document=JSON.parse(readFileSync(output,'utf8')),problems=[],results=new Map();
for(const f of fixtures)if(!selected.includes(f))results.set(f.id,previous.results.get(f.id));
for(const f of selected){
  const r=document.results[f.id];if(!r){problems.push(`${f.id}: no result`);continue;}
  const errors=r.diagnostics.filter(d=>d[3]==='error'),warnings=r.diagnostics.filter(d=>d[3]==='warning');
  if(f.kind==='output'){
    if(errors.length)problems.push(`${f.id}: output fixture has Roslyn errors ${errors.map(d=>d[0]+'@'+d[1]).join(' ')}`);
    else if(r.timedOut)problems.push(`${f.id}: output fixture timed out`);
    else if(typeof r.output!=='string')problems.push(`${f.id}: output fixture produced no output record`);
  }else if(!errors.length&&!warnings.length)problems.push(`${f.id}: diagnostics fixture produced no Roslyn error or warning`);
  const pinned={hash:fixtureHash(f),kind:f.kind,langVersion:r.langVersion,diagnostics:r.diagnostics};
  if(f.kind==='output'){pinned.output=r.output;if(r.exception)pinned.exception=r.exception;if(r.exitCode!==undefined)pinned.exitCode=r.exitCode;}
  results.set(f.id,pinned);
}
if(args.includes('--list'))for(const f of selected){
  const r=results.get(f.id);if(!r)continue;
  const output=f.kind==='output'?String(JSON.stringify(r.output)).slice(0,60)+(r.exception?' !'+r.exception:''):'';
  const diagnostics=r.diagnostics.map(d=>`${d[0]}${d[3]==='error'?'':'('+d[3][0]+')'}@${d[1]}+${d[2]}`).join(' ');
  console.log(f.id.padEnd(58),r.hash,output,diagnostics);
}
if(problems.length){console.error(`\n${problems.length} fixture problem(s); nothing was pinned:\n`+problems.map(p=>'  '+p).join('\n'));process.exit(1);}
const meta={version:document.roslyn,informationalVersion:document.informationalVersion,runtime:document.runtime,references:document.references,options:'OutputKind.ConsoleApplication, default warning level, nullable disabled, no implicit usings, invariant culture'};
if(selected.length<fixtures.length&&previous.meta&&previous.meta.informationalVersion!==meta.informationalVersion){
  console.error(`The corpus is pinned with Roslyn ${previous.meta.informationalVersion}; this SDK has ${meta.informationalVersion}.`);
  console.error('Run a full capture without --changed or --only.');process.exit(1);
}
writeSelectedPins(meta,selected,results,pinnedDirectory,fixtureHash);
console.log(`Pinned ${selected.length} of ${fixtures.length} fixtures against Roslyn ${document.roslyn} (${document.informationalVersion}).`);
