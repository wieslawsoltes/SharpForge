import { createHash } from 'node:crypto';
import { homedir, platform, release, arch } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { validate } from '../schema/validate.js';
import { git } from './io.js';
import { npmCli } from '../../conformance/node-tools.js';
import { readTapEvidence, summarizeTap } from './tap-evidence.js';

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
  return summarizeTap(readTapEvidence(tap), exitCode);
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
  const parsed = readTapEvidence(tap);
  const results = parsed.results;
  const complete = summary.complete && parsed.complete && isDeepStrictEqual(summary, summarizeTap(parsed, summary.exitCode));
  const hasFailure = results.some(result => !result.ok && !result.directive);
  const namedResults = new Map();
  for (const result of results) {
    namedResults.set(result.name, namedResults.has(result.name) ? null : result);
  }
  const obligations=[],seen=new Set();
  for(const text of parsed.proofs) {
    const proof=validate(proofSchema,JSON.parse(text)),key=obligationKey(proof);
    if(seen.has(key)) throw new Error(`Duplicate target proof ${key}`);seen.add(key);
    const result = namedResults.get(proof.testName);
    if (!result) throw new Error(`Target proof requires one unambiguous TAP result: ${proof.testName}`);
    const excluded = result.directive || result.inheritedDirective;
    if (proof.status === 'pass' && (!complete || summary.exitCode !== 0 || hasFailure || !result.executedPass)) {
      throw new Error(`Target proof is not a passing test: ${proof.testName}`);
    }
    if (proof.status === 'fail' && (!complete || result.ok || excluded || !summary.failed)) {
      throw new Error(`Target proof is not a failing test: ${proof.testName}`);
    }
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
