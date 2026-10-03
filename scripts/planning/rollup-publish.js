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
export async function publishRollup({result,directory='planning/contracts/rollup',client}) {
  if(result.errors.length) throw new Error('Invalid rollup');
  mkdirSync(directory,{recursive:true}); writeJSON(resolve(directory,'parity.json'),result); writeFileSync(resolve(directory,'parity.md'),markdown(result));
  const updates=[];
  if(client) {
    const items=await client.items(), totals=new Map();
    for(const group of result.groups.filter(g=>g.kind==='Epic')) {
      const value=totals.get(group.id)??{pass:0,total:0}; value.pass+=group.pass; value.total+=group.total; totals.set(group.id,value);
    }
    for(const [id,value] of totals) {
      const item=items.find(item=>item.content.title.startsWith(`[${id}]`));
      if(!item) throw new Error(`Epic ${id} is missing from project`);
      const percent=Math.round(value.pass/value.total*10000)/100;
      if(item.fields['Parity percent']!==percent) { await client.setFields(item,{'Parity percent':percent}); updates.push({id,percent}); }
    }
  }
  return {groups:result.groups.length,updates};
}
if(isMain(import.meta.url)) {
  const {values}=parseArgs({options:{...rollupOptions,directory:{type:'string',default:'planning/contracts/rollup'},publish:{type:'boolean',default:false},owner:{type:'string',default:'wieslawsoltes'},repo:{type:'string',default:'SharpForge'},number:{type:'string',default:'4'}}});
  console.log(JSON.stringify(await publishRollup({result:rollup(rollupInputs(values)),directory:values.directory,client:values.publish?new GitHubProject(values):null}),null,2));
}
