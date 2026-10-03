// Explicit native recapture; never run by the ordinary Node test suite.
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const repository=fileURLToPath(new URL('../../../',import.meta.url));
const oracleRoot=process.env.SHARPFORGE_ORACLE_ROOT||repository;
const oracle=name=>import(pathToFileURL(path.join(oracleRoot,'scripts/conformance/oracle',name)));
const {resolveToolchain,sha256}=await oracle('toolchain.js');
const {compileFixture}=await oracle('roslyn-compile.js');
const {runFixture}=await oracle('clr-run.js');
const sourceBytes=await readFile(new URL('Program.cs',import.meta.url));
const fixture={id:'constant-runtime-conversion',source:'Program.cs',sourceBytes,langVersion:'12.0'};
const toolchain=await resolveToolchain(),compiled=await compileFixture(fixture,toolchain);
if(compiled.result.exitCode!==0)throw new Error(JSON.stringify(compiled.result));
const executed=await runFixture(compiled.assembly,fixture,toolchain);
if(executed.result.exitCode!==0)throw new Error(JSON.stringify(executed.result));
const report={schemaVersion:1,sourceSHA256:sha256(sourceBytes),toolchain:toolchain.actual,environment:toolchain.environment,compileRuns:2,executionRuns:2,commands:{compile:compiled.command,execute:executed.command},compiled:compiled.result,executed:executed.result};
await writeFile(new URL('oracle.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(executed.result.stdout);
