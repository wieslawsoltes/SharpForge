import { parseArgs } from 'node:util';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { rollup, rollupInputs, rollupOptions } from './rollup.js';
import { isMain, writeJSON } from './lib/io.js';
import { GitHubProject } from './lib/github-project.js';

export function markdown(result) {
  const escape=value=>String(value).replaceAll('|','\\|').replaceAll('\n',' ');
  return '# Verified parity\n\nDenominator: '+result.denominator+'. Unknown and unsupported remain in the denominator.\n\n| Scope | Platform | Engine | Revision | Pass | Fail | Unknown | Unsupported | Total | Percent |\n| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |\n'+result.groups.map(g=>`| ${[g.id,g.platform,g.engine,g.specRevision,g.pass,g.fail,g.unknown,g.unsupported,g.total,g.percent+'%'].map(escape).join(' | ')} |`).join('\n')+'\n';
}
export function validateRollup(result) {
  if(!result||!Array.isArray(result.errors)||result.errors.length||!Array.isArray(result.groups)||!result.groups.length||!Array.isArray(result.obligations)||!result.obligations.length)throw new Error('Invalid rollup');
  const seen=new Set(),scopes=new Map();
  for(const group of result.groups){
    const identity=JSON.stringify([group.id,group.platform,group.engine,group.specRevision]);
    if(seen.has(identity))throw new Error('Duplicate rollup group');seen.add(identity);
    if(['pass','fail','unknown','unsupported','total'].some(key=>!Number.isSafeInteger(group[key])||group[key]<0)||!group.total||group.pass+group.fail+group.unknown+group.unsupported!==group.total)throw new Error('Invalid rollup totals');
    if(group.fraction?.numerator!==group.pass||group.fraction?.denominator!==group.total||group.percent!==Math.round(group.pass/group.total*10000)/100||group.complete!==(group.pass===group.total))throw new Error('Invalid rollup percentage');
    scopes.set(group.id,(scopes.get(group.id)??true)&&group.complete);
  }
  for(const group of result.groups)if(group.scopeComplete!==scopes.get(group.id))throw new Error('Invalid rollup scope completion');
  return result;
}
export async function publishRollup({result,directory='planning/contracts/rollup',client}) {
  validateRollup(result);
  mkdirSync(directory,{recursive:true}); writeJSON(resolve(directory,'parity.json'),result); writeFileSync(resolve(directory,'parity.md'),markdown(result));
  const updates=[];
  if(client) {
    const items=await client.items(), totals=new Map();
    for(const group of result.groups.filter(g=>g.kind==='Epic')) {
      const value=totals.get(group.id)??{pass:0,total:0}; value.pass+=group.pass; value.total+=group.total; totals.set(group.id,value);
    }
    const pending=[];
    for(const [id,value] of totals) {
      const matches=items.filter(item=>item.content?.title?.startsWith(`[${id}]`));
      if(matches.length!==1) throw new Error(`Epic ${id} must identify exactly one project item; found ${matches.length}`);
      const item=matches[0],percent=Math.round(value.pass/value.total*10000)/100;
      if(item.fields['Parity percent']!==percent)pending.push({item,id,percent});
    }
    for(const {item,id,percent} of pending){await client.setFields(item,{'Parity percent':percent});updates.push({id,percent});}
  }
  return {groups:result.groups.length,updates};
}
if(isMain(import.meta.url)) {
  const {values}=parseArgs({options:{...rollupOptions,directory:{type:'string',default:'planning/contracts/rollup'},publish:{type:'boolean',default:false},owner:{type:'string',default:'wieslawsoltes'},repo:{type:'string',default:'SharpForge'},number:{type:'string',default:'4'}}});
  console.log(JSON.stringify(await publishRollup({result:rollup(rollupInputs(values)),directory:values.directory,client:values.publish?new GitHubProject(values):null}),null,2));
}
