import { createHash } from 'node:crypto';
import { homedir, platform, release, arch } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { readFileSync } from 'node:fs';
import { validate } from '../schema/validate.js';

export const digest = value => createHash('sha256').update(value).digest('hex');
export function artifactDigest({task,headCommit,command,summary},files) {
  return digest(JSON.stringify({task,headCommit,command,summary})+'\0'+Object.keys(files).sort().map(name=>`${name}\0${files[name]}`).join('\0'));
}
export function redact(text, root = process.cwd()) {
  for (const path of [...new Set([resolve(root),homedir()])].sort((a,b)=>b.length-a.length)) {
    for (const variant of [path,path.split(sep).join('/'),path.replaceAll('\\','\\\\')]) text = text.split(variant).join(path === resolve(root) ? '<repo>' : '<home>');
  }
  // Also remove home prefixes emitted by other tools or transported logs.
  return text.replace(/(?:\/Users\/|\/home\/)[^/\s"']+/g,'<home>').replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+/gi,'<home>');
}
export function environment(root = process.cwd()) {
  const version = (command,args) => {
    const child = spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:15000});
    return child.status === 0 ? redact(child.stdout.trim().split('\n')[0],root) : 'unavailable';
  };
  return {os:`${platform()} ${release()} ${arch()}`,node:process.version,
    chromium:process.env.CHROMIUM_EXECUTABLE ? version(process.env.CHROMIUM_EXECUTABLE,['--version']) : 'unavailable',dotnet:version('dotnet',['--version'])};
}
export function tapSummary(tap, exitCode) {
  const get = key => { const values=[...tap.matchAll(new RegExp(`^# ${key} (\\d+)\\s*$`,'gm'))]; return Number(values.at(-1)?.[1]??0); };
  return {tests:get('tests'),passed:get('pass'),failed:get('fail'),cancelled:get('cancelled'),skipped:get('skipped'),exitCode:exitCode??1};
}
export function runCommand(command,root=process.cwd()) {
  if (!Array.isArray(command) || !command.length || !command.every(arg=>typeof arg==='string' && !arg.includes('\0'))) throw new Error('Expected a nonempty argv command');
  const executable = command[0] === 'node' ? process.execPath : command[0];
  const env={...process.env}; delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(executable,command.slice(1),{cwd:root,env,encoding:'utf8',timeout:600000,maxBuffer:64*1024*1024,shell:false});
  const output = redact((child.stdout??'')+(child.stderr??'')+(child.error ? '\n'+child.error.message : ''),root);
  return {command,summary:tapSummary(output,child.status),output};
}
export function validateHandoff(record) {
  validate(JSON.parse(readFileSync(new URL('../../../planning/contracts/handoff.schema.json',import.meta.url),'utf8')),record);
  const totals={tests:0,passed:0,failed:0,cancelled:0,skipped:0,exitCode:0};
  for(const {summary} of record.commands) for(const key of Object.keys(totals)) totals[key]=key==='exitCode'?Math.max(totals[key],summary[key]):totals[key]+summary[key];
  if(Object.keys(totals).some(key=>totals[key]!==record.testSummary[key])) throw new Error('Handoff testSummary does not match command summaries');
  return record;
}
