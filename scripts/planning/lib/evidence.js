import { createHash } from 'node:crypto';
import { homedir, platform, release, arch } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { validate } from '../schema/validate.js';
import { git } from './io.js';
import { npmCli } from '../../conformance/node-tools.js';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const obligationKey = value => JSON.stringify([value.capabilityId,value.platform,value.engine,value.specRevision]);
export function artifactDigest({schemaVersion,task,headCommit,command,summary,obligations},files) {
  return digest(JSON.stringify({schemaVersion,task,headCommit,command,summary,obligations})+'\0'+Object.keys(files).sort().map(name=>`${name}\0${files[name]}`).join('\0'));
}
export function redact(text, root = process.cwd()) {
  for (const path of [...new Set([resolve(root),homedir()])].sort((a,b)=>b.length-a.length)) {
    for (const variant of [path,path.split(sep).join('/'),path.replaceAll('\\','\\\\')]) text = text.split(variant).join(path === resolve(root) ? '<repo>' : '<home>');
  }
  return text.replace(/(?:\/Users\/|\/home\/)[^/\s"']+/g,'<home>').replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+/gi,'<home>');
}
export function cleanHead(root = process.cwd(), expected) {
  if(git(['status','--porcelain','--untracked-files=all'],root).trim()) throw new Error('Evidence requires a clean working tree');
  const head=git(['rev-parse','HEAD'],root).trim();
  if(expected && head!==expected) throw new Error('HEAD changed while evidence commands were running');
  return head;
}
export function environment(root = process.cwd()) {
  const version = (command,args) => {
    const child = spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:15000});
    return child.status === 0 ? redact(child.stdout.trim().split('\n')[0],root) : 'unavailable';
  };
  return {os:`${platform()} ${release()} ${arch()}`,node:process.version,
    chromium:process.env.CHROMIUM_EXECUTABLE ? version(process.env.CHROMIUM_EXECUTABLE,['--version']) : 'unavailable',dotnet:version('dotnet',['--version'])};
}
const countKeys=['tests','passed','failed','cancelled','skipped','todo'];
export function tapSummary(tap, exitCode) {
  const totals={},names={passed:'pass',failed:'fail'};let complete=/^TAP version 13\r?$/m.test(tap)&&/^1\.\.\d+(?: #.*)?\r?$/m.test(tap);
  for(const key of countKeys) {
    const values=[...tap.matchAll(new RegExp(`^# ${names[key]??key} (\\d+)\\s*$`,'gm'))];
    totals[key]=Number(values.at(-1)?.[1]??0);complete &&= values.length===1&&Number.isSafeInteger(totals[key]);
  }
  complete &&= totals.tests===totals.passed+totals.failed+totals.cancelled+totals.skipped+totals.todo;
  return {...totals,exitCode:Number.isInteger(exitCode)&&exitCode>=0?exitCode:1,complete};
}
export function summarizeCommands(commands) {
  const totals={tests:0,passed:0,failed:0,cancelled:0,skipped:0,todo:0,exitCode:0,complete:true};
  for(const {summary} of commands) {
    for(const key of countKeys) totals[key]+=summary[key];
    totals.exitCode=Math.max(totals.exitCode,summary.exitCode);totals.complete &&= summary.complete;
  }
  return totals;
}
export function runCommand(command,root=process.cwd()) {
  if (!Array.isArray(command) || !command.length || !command.every(arg=>typeof arg==='string' && arg.length && !arg.includes('\0'))) throw new Error('Expected a nonempty argv command');
  const executable = command[0] === 'node' || command[0] === 'npm' ? process.execPath : command[0] === 'python' ? process.env.PYTHON || 'python' : command[0];
  const args=command[0]==='npm'?[npmCli(),...command.slice(1)]:command.slice(1);
  if(args.some(arg=>arg===undefined)) throw new Error('Cannot locate npm CLI');
  const env={...process.env}; delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(executable,args,{cwd:root,env,encoding:'utf8',timeout:600000,maxBuffer:64*1024*1024,shell:false});
  const output = redact(child.stdout??'',root), stderr=redact((child.stderr??'')+(child.error?'\n'+child.error.message:''),root);
  return {command,summary:tapSummary(output,child.status),output,stderr};
}
const proofSchema=JSON.parse(readFileSync(new URL('../../../planning/contracts/evidence-proof.schema.json',import.meta.url),'utf8'));
export function proofObligations(tap,summary) {
  const results=[...tap.matchAll(/^\s*(ok|not ok) \d+ - (.*?)(?:\s+#\s+(SKIP|TODO)\b.*)?\r?$/gm)].map(match=>({ok:match[1]==='ok',name:match[2],directive:match[3]}));
  const obligations=[],seen=new Set();
  for(const match of tap.matchAll(/^\s*# sharpforge-evidence: (.+)\r?$/gm)) {
    const proof=validate(proofSchema,JSON.parse(match[1])),key=obligationKey(proof);
    if(seen.has(key)) throw new Error(`Duplicate target proof ${key}`);seen.add(key);
    const matching=results.filter(result=>result.name===proof.testName);
    if(matching.length!==1) throw new Error(`Target proof requires one unambiguous TAP result: ${proof.testName}`);
    const result=matching[0];
    if(proof.status==='pass'&&(!summary.complete||summary.exitCode!==0||summary.failed||summary.cancelled||summary.passed<1||!result.ok||result.directive)) throw new Error(`Target proof is not a passing test: ${proof.testName}`);
    if(proof.status==='fail'&&(!summary.complete||result.ok||result.directive||!summary.failed)) throw new Error(`Target proof is not a failing test: ${proof.testName}`);
    if(['unknown','unsupported'].includes(proof.status)&&!proof.reason) throw new Error(`Target proof ${proof.status} requires a reason`);
    obligations.push(proof);
  }
  return obligations.sort((a,b)=>obligationKey(a).localeCompare(obligationKey(b),'en'));
}
export function validateBundle(record) {
  validate(JSON.parse(readFileSync(new URL('../../../planning/contracts/evidence-bundle.schema.json',import.meta.url),'utf8')),record,{supportedVersion:2});
  const keys=record.obligations.map(obligationKey);if(new Set(keys).size!==keys.length)throw new Error('Duplicate target proof');
  for(const obligation of record.obligations)validate(proofSchema,obligation);
  return record;
}
export function validateHandoff(record) {
  validate(JSON.parse(readFileSync(new URL('../../../planning/contracts/handoff.schema.json',import.meta.url),'utf8')),record);
  if(!isDeepStrictEqual(summarizeCommands(record.commands),record.testSummary)) throw new Error('Handoff testSummary does not match command summaries');
  for(const command of record.commands)if(command.headCommit!==record.headCommit)throw new Error('Handoff command was tested at a different commit');
  if(record.evidenceDigests&&!isDeepStrictEqual(record.evidenceDigests,record.commands.map(command=>command.evidenceDigest)))throw new Error('Handoff evidenceDigests do not match command evidence');
  return record;
}
