#!/usr/bin/env node
/**
 * Regenerates the checked-in metadata fixture assemblies with the real C# compiler.
 *
 * Usage: node tests/fixtures/metadata/build-fixtures.mjs
 * Needs a .NET SDK (DOTNET_ROOT, ~/.dotnet or `dotnet` on PATH). The test suite never runs this script;
 * it only reads the DLLs next to it. Builds are deterministic, so regenerating with the same SDK is a no-op.
 */
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir,tmpdir} from 'node:os';

const here=dirname(fileURLToPath(import.meta.url)),src=join(here,'src'),work=join(tmpdir(),'sharpforge-metadata-fixtures');
const dotnetRoot=[process.env.DOTNET_ROOT,join(homedir(),'.dotnet'),'/usr/local/share/dotnet','/usr/share/dotnet'].find(d=>d&&existsSync(join(d,'sdk')));
if(!dotnetRoot)throw new Error('No .NET SDK found; set DOTNET_ROOT');
const sdk=readdirSync(join(dotnetRoot,'sdk')).filter(v=>existsSync(join(dotnetRoot,'sdk',v,'Roslyn','bincore','csc.dll'))).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).pop();
const csc=join(dotnetRoot,'sdk',sdk,'Roslyn','bincore','csc.dll'),dotnet=join(dotnetRoot,process.platform==='win32'?'dotnet.exe':'dotnet');

/** The public half of a strong-name key in the CLI PublicKeyBlob layout; enough for `csc -publicsign`. */
const keyFile=join(src,'fixtures-public.snk');
if(!existsSync(keyFile)){
  const {publicKey}=generateKeyPairSync('rsa',{modulusLength:1024,publicExponent:0x10001}),jwk=publicKey.export({format:'jwk'}),modulus=Buffer.from(jwk.n,'base64url').reverse(),blob=Buffer.alloc(32+modulus.length);
  blob.writeUInt32LE(0x2400,0);blob.writeUInt32LE(0x8004,4);blob.writeUInt32LE(20+modulus.length,8);blob.writeUInt8(6,12);blob.writeUInt8(2,13);blob.writeUInt32LE(0x2400,16);blob.write('RSA1',20,'latin1');blob.writeUInt32LE(modulus.length*8,24);blob.writeUInt32LE(0x10001,28);modulus.copy(blob,32);
  writeFileSync(keyFile,blob);
}
rmSync(work,{recursive:true,force:true});
const core=join(here,'MiniStandard.dll');
/** Compiles one library. `out` is absolute; `signed:false` builds a weakly named assembly. */
function compile(out,source,{defines=[],references=[],signed=true,extra=[]}={}){
  mkdirSync(dirname(out),{recursive:true});
  const args=[csc,'-nologo','-noconfig','-nostdlib','-target:library','-deterministic','-debug-','-optimize+','-langversion:preview','-runtimemetadataversion:v4.0.30319','-nowarn:CS0649,CS0169,CS0067,CS8618,CS0414,CS8714','-out:'+out,...(signed?['-publicsign','-keyfile:'+keyFile]:[]),...(defines.length?['-define:'+defines.join(';')]:[]),...references.map(r=>'-reference:'+r),...extra,...[source].flat().map(s=>s.includes('/')||s.includes('\\')?s:join(src,s))];
  const result=spawnSync(dotnet,args,{encoding:'utf8'});
  if(result.status!==0){console.error(result.stdout+result.stderr);throw new Error('csc failed for '+out);}
  if(result.stdout.trim())console.log(result.stdout.trim());
  return out;
}
const fixture=(name,from)=>{copyFileSync(from,join(here,name));return join(here,name);};

// Strongly named assemblies must name their friends with the full public key, so that part is generated.
const publicKey=readFileSync(keyFile).toString('hex'),friends=join(work,'Friends.g.cs');mkdirSync(work,{recursive:true});
writeFileSync(friends,['MiniStandard.Tests','Friend.Assembly'].map(n=>`[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("${n}, PublicKey=${publicKey}")]`).join('\n')+'\n');
compile(core,['MiniStandard.cs',friends],{extra:['-unsafe']});
// T22: three versions of one strongly named library and consumers compiled against the lowest and the highest.
const v1=compile(join(work,'v1','VersionedLib.dll'),'VersionedLib.cs',{defines:['LIB_V1'],references:[core]});
const v105=compile(join(work,'v105','VersionedLib.dll'),'VersionedLib.cs',{defines:['LIB_V105'],references:[core]});
const v2=compile(join(work,'v2','VersionedLib.dll'),'VersionedLib.cs',{defines:['LIB_V2'],references:[core]});
fixture('VersionedLib.1.0.0.0.dll',v1);fixture('VersionedLib.1.0.0.5.dll',v105);fixture('VersionedLib.2.0.0.0.dll',v2);
compile(join(here,'ConsumerOfV1.dll'),'Consumer.cs',{references:[core,v1]});
compile(join(here,'ConsumerOfV2.dll'),'Consumer.cs',{references:[core,v2]});
// Weakly named pair with one simple name (CS1704).
fixture('WeakLib.1.0.0.0.dll',compile(join(work,'w1','WeakLib.dll'),'VersionedLib.cs',{defines:['LIB_V1'],references:[core],signed:false}));
fixture('WeakLib.2.0.0.0.dll',compile(join(work,'w2','WeakLib.dll'),'VersionedLib.cs',{defines:['LIB_V2'],references:[core],signed:false}));
// Type forwarding: FacadeConsumer was compiled when Facade still defined Lib.Widget; today's Facade forwards it.
const oldFacade=compile(join(work,'old','Facade.dll'),'Forwarding.cs',{defines:['FACADE_OLD'],references:[core]});
compile(join(here,'Facade.dll'),'Forwarding.cs',{defines:['FACADE'],references:[core,v2]});
compile(join(here,'FacadeConsumer.dll'),'Forwarding.cs',{defines:['FACADE_CONSUMER'],references:[core,oldFacade]});
// A forwarder cycle: CycleA forwards Loop.Node to CycleB and CycleB forwards it back.
const definesB=compile(join(work,'cycle1','CycleB.dll'),'Forwarding.cs',{defines:['CYCLE_DEFINES'],references:[core]});
const definesA=compile(join(work,'cycle2','CycleA.dll'),'Forwarding.cs',{defines:['CYCLE_DEFINES'],references:[core]});
compile(join(here,'CycleA.dll'),'Forwarding.cs',{defines:['CYCLE_FORWARDS'],references:[core,definesB]});
compile(join(here,'CycleB.dll'),'Forwarding.cs',{defines:['CYCLE_FORWARDS'],references:[core,definesA]});
compile(join(here,'CycleConsumer.dll'),'Forwarding.cs',{defines:['CYCLE_CONSUMER'],references:[core,definesA]});
rmSync(work,{recursive:true,force:true});
for(const f of readdirSync(here).filter(f=>f.endsWith('.dll')).sort())console.log(f.padEnd(28),readFileSync(join(here,f)).length,'bytes');
