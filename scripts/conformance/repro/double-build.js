import {cp, mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {compareGolden} from '../../planning/golden-output.js';
import {temporary,revision,differences,writeJSON,cli,isMain,git} from './common.js';
import {createSourceArchive,extractSource} from './source.js';
import {vendorCache} from './cache.js';
import {build,assertToolchain} from './build.js';

export function compareBuilds(first,second) {
  if(first.commit!==second.commit||first.epoch!==second.epoch||JSON.stringify(first.toolchain)!==JSON.stringify(second.toolchain))throw new Error('Cannot compare different source commits, epochs or toolchains');
  const changes=differences(first.outputs,second.outputs),golden=compareGolden(first.golden,second.golden);
  return {passed:changes.length===0&&golden.passed,changes,golden};
}
export async function doubleBuild({root=process.cwd(),ref='HEAD',archive,cache,output='artifacts/results/repro/double-build',signal}={}) {
  root=resolve(root);output=resolve(output);await assertToolchain(root);
  return temporary(async temporaryRoot=>{
    const source=archive?{...await revision(root,ref),archive:resolve(archive)}:await createSourceArchive({root,ref,output:join(temporaryRoot,'source.zip'),signal});
    const reports=[];
    for(let index=0;index<2;index++){
      const tree=join(temporaryRoot,`build-${index}`);
      const extracted=await extractSource({...source,root,destination:tree,reverse:!!index,mtime:source.epoch+index*86400,signal});
      let selectedCache=cache?resolve(cache):join(temporaryRoot,'vendored-cache');
      if(!cache&&index===0)await vendorCache({root:tree,output:selectedCache,signal});
      const report=await build({root:tree,commit:source.commit,epoch:source.epoch,cache:selectedCache,signal});
      report.sourceArchive=extracted;reports.push(report);
      await writeJSON(join(output,`build-${index}.json`),report);
      if(index===0){await mkdir(join(output,'payloads'),{recursive:true});for(const file of report.manifest.files)await cp(join(tree,'artifacts',file.path),join(output,'payloads',file.path));await writeJSON(join(output,'payloads/SOURCE-MANIFEST.json'),report.manifest);}
    }
    const comparison=compareBuilds(...reports),report={schemaVersion:1,platform:`${process.platform}-${process.arch}`,commit:source.commit,harnessCommit:await git(root,['rev-parse','HEAD']),toolchain:reports[0].toolchain,epoch:source.epoch,...comparison,builds:reports.map(({milliseconds,sourceArchive})=>({milliseconds,sourceArchive})),outputs:reports[0].outputs,golden:reports[0].golden,scope:'Two independent extracted trees; reversed extraction order and distinct input mtimes. Cross-runner equality requires aggregate.js on independent runner reports.'};
    await writeJSON(join(output,'summary.json'),report);return report;
  });
}
if(isMain(import.meta.url)){
  const {values}=parseArgs({options:{root:{type:'string',default:'.'},ref:{type:'string',default:'HEAD'},archive:{type:'string'},cache:{type:'string'},output:{type:'string',default:'artifacts/results/repro/double-build'}}});
  await cli(signal=>doubleBuild({...values,signal}),{report:join(values.output,'report.json')});
}
