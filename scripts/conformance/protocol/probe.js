import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {parseArgs} from 'node:util';
import {LanguageServer, DebugAdapter} from '@sharpforge/protocol';
import {loadModels} from './schema.js';
import {validator} from './messages.js';
import {fileURLToPath} from 'node:url';
import {git} from '../../planning/lib/io.js';
import {isMain} from '../../planning/test-manifests.js';
/** A production-message probe, explicitly distinct from recorded VS Code replay. */
export async function probeUnsupported() {
  const models = await loadModels(), results = [];
  for (const protocol of ['lsp', 'dap']) {
    const request = protocol === 'lsp' ? {jsonrpc:'2.0',id:1,method:'sharpforge/unsupported'} : {seq:1,type:'request',command:'unsupportedCommand'};
    const service = protocol === 'lsp' ? new LanguageServer() : new DebugAdapter();
    const actual = await service.handle(request), validate = validator(protocol, models);
    try { validate(request,'clientToServer'); validate(actual,'serverToClient'); results.push({protocol, status:'passed', request, actual}); }
    catch (error) { results.push({protocol, status:'failed', request, actual, error:error.message}); }
  }
  const root=fileURLToPath(new URL('../../../',import.meta.url));
  return {schemaVersion:1, testedCommit:git(['rev-parse','HEAD'],root).trim(), dirty:git(['status','--porcelain'],root).trim().length>0,
    platform:`${process.platform}-${process.arch}`, node:process.versions.node, sourceKind:'synthetic-production-probe', qualification:'unknown',
    status:results.some(row=>row.status==='failed')?'failed':'passed', results};
}
if (isMain(import.meta.url)) {
  const {values} = parseArgs({options:{output:{type:'string',default:'artifacts/protocol/unsupported.json'}}});
  const report=await probeUnsupported(); await mkdir(dirname(resolve(values.output)),{recursive:true}); await writeFile(values.output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status}));if(report.status==='failed')process.exitCode=1;
}
