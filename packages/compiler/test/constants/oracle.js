/**
 * Builds and runs the Roslyn oracle (roslyn-oracle/Program.cs) for the corpus generators. Development-time only:
 * requires a .NET SDK (`DOTNET` env var or `dotnet` on PATH); the build happens in a scratch directory
 * (`SF_ORACLE_DIR` or node_modules/.sf/options/oracle), never inside the repository tree.
 */
import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,readFileSync,readdirSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
let built=null;
function build(){
  if(built)return built;
  const dotnet=process.env.DOTNET??'dotnet',scratch=resolve(process.env.SF_ORACLE_DIR??'node_modules/.sf/options/oracle');
  const sdk=execFileSync(dotnet,['--version'],{encoding:'utf8'}).trim();
  const base=execFileSync(dotnet,['--list-sdks'],{encoding:'utf8'}).split('\n').map(l=>/^(\S+) \[(.+)\]$/.exec(l.trim())).find(m=>m&&m[1]===sdk)?.[2];
  const roslyn=process.env.ROSLYN_DIR??join(base,sdk,'Roslyn','bincore');
  if(!existsSync(join(roslyn,'Microsoft.CodeAnalysis.CSharp.dll')))throw new Error('Roslyn binaries not found in '+roslyn);
  mkdirSync(scratch,{recursive:true});
  for(const file of readdirSync(join(here,'roslyn-oracle')))cpSync(join(here,'roslyn-oracle',file),join(scratch,file));
  execFileSync(dotnet,['build',join(scratch,'oracle.csproj'),'-c','Release','-nologo','-v','q','-p:ROSLYN_DIR='+roslyn],{stdio:'inherit'});
  return built={dotnet,scratch,dll:join(scratch,'bin','Release','net10.0','oracle.dll')};
}
/** Runs the oracle in `mode` ('constants' | 'suppression') on a JSON-serialisable input and returns its parsed output. */
export function runOracle(mode,input){
  const {dotnet,scratch,dll}=build(),inFile=join(scratch,mode+'-input.json'),outFile=join(scratch,mode+'-output.json');
  writeFileSync(inFile,JSON.stringify(input));
  execFileSync(dotnet,[dll,mode,inFile,outFile],{stdio:'inherit'});
  return JSON.parse(readFileSync(outFile,'utf8'));
}
