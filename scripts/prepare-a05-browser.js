/** Build fixtures only after the complete E01 integration is ready for validation. */
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {bundleWorker} from './bundle-worker.js';
import {sourceScalarCases} from '../tests/a05-01-fixtures.js';
import {arrayFixture} from '../tests/a05-05-fixtures.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),run=promisify(execFile),sha=value=>createHash('sha256').update(value).digest('hex');
const args=process.argv.slice(2),external=[];let output=resolve(root,'artifacts/a05-e01-browser'),nativeIntBits=64;
for(let i=0;i<args.length;i++){
  if(args[i]==='--output'&&args[i+1])output=resolve(args[++i]);
  else if(args[i]==='--native-int-bits'&&args[i+1])nativeIntBits=Number(args[++i]);
  else if(args[i]==='--assembly'&&args[i+1]&&args[i+2])external.push({path:resolve(args[++i]),expected:resolve(args[++i])});
  else throw new Error('Usage: node scripts/prepare-a05-browser.js [--output DIRECTORY] [--native-int-bits 32|64] [--assembly DLL EXPECTED.txt]...');
}
if(![32,64].includes(nativeIntBits))throw new Error('Native integer width must be 32 or 64');
await mkdir(output,{recursive:true});
const command=async(executable,parameters)=>run(executable,parameters,{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024});
const preparedCommit=(await command('git',['rev-parse','HEAD'])).stdout.trim();
const preparation={preparedCommit,node:process.version,platform:process.platform,architecture:process.arch,startedAt:new Date().toISOString(),commands:[]};
try{
  const build=await command(process.execPath,['scripts/build.js']);preparation.commands.push({command:[process.execPath,'scripts/build.js'],stdout:build.stdout,stderr:build.stderr,exitCode:0});
  const staging=resolve(root,'dist/a05-e01');await mkdir(staging,{recursive:true});
  // This location preserves the suite's ../packages imports after build rewrites package imports.
  await copyFile(resolve(root,'tests/browser_e01_suite.js'),resolve(staging,'browser_e01_suite.js'));
  const entry="import {runE01Browser} from './browser_e01_suite.js';\nself.onmessage=async({data})=>{try{const result=await runE01Browser(data,item=>self.postMessage({kind:'progress',item}));self.postMessage({kind:'result',result});}catch(error){self.postMessage({kind:'fatal',error:{name:error.name,message:error.message,stack:error.stack}});}};\n";
  await writeFile(resolve(staging,'entry.js'),entry);
  const bundle=await bundleWorker(resolve(staging,'entry.js'));await writeFile(resolve(output,'a05-e01.bundle.js'),bundle);
  await copyFile(resolve(root,'tests/browser_e01.html'),resolve(output,'index.html'));
  const scalarNames=['uint signed operands widen before arithmetic','checked narrow compound and increment','Decimal constructors methods constants and out','Decimal native integer conversions','long wrap','ulong division','small integer storage','single arithmetic','double arithmetic','signed zero','NaN ordering','decimal addition','decimal scale','decimal division','checked unsigned overflow','integer division overflow'];
  const scalars=scalarNames.map(name=>{const fixture=sourceScalarCases.find(item=>item.name===name);if(!fixture)throw new Error('Missing pinned scalar fixture '+name);return fixture;});
  scalars.push({name:'native shift width',source:'nint one=(nint)1;Console.WriteLine((long)(one<<40));',outputs:{32:'256\n',64:'1099511627776\n'}});
  const synchronization=[{
    name:'Monitor recursion, wait/pulse, threads, atomics and fences',
    source:await readFile(resolve(root,'tests/fixtures/a05/synchronization/Program.cs'),'utf8'),
    output:await readFile(resolve(root,'tests/fixtures/a05/synchronization/expected.txt'),'utf8')
  },{
    name:'lock releases on exception',source:'using System.Threading;class P{static object gate=new object();static void Main(){try{lock(gate){throw new Exception("leave");}}catch(Exception error){Console.WriteLine(error.Message);}Console.WriteLine(Monitor.IsEntered(gate));lock(gate){Console.WriteLine(Monitor.IsEntered(gate));}}}',output:'leave\nFalse\nTrue\n'
  }];
  const rectangular=arrayFixture((writer,context)=>{
    writer.op('ldc.i4.m1').op('ldc.i4.2').op('ldc.i4.4').op('ldc.i4.3').op('newobj',context.boundedCtor).op('stloc.0');
    writer.op('ldloc.0').op('ldc.i4.0').op('ldc.i4.6').op('call',context.address).op('stloc.1').op('call',context.collect);
    writer.op('ldloc.1').op('ldc.i4',42).op('stind.i4').op('ldloc.0').op('ldc.i4.0').op('ldc.i4.6').op('call',context.get).op('ret');
  });
  const assemblies=[{label:'T05 rectangular lower bounds, interior address and GC',origin:'independently assembled CIL; not Roslyn qualification',base64:Buffer.from(rectangular).toString('base64'),sha256:sha(rectangular),output:'',returnValue:42,nativeIntBits:64}];
  for(const fixture of external){const bytes=await readFile(fixture.path),expected=await readFile(fixture.expected,'utf8');assemblies.push({label:'External DLL '+basename(fixture.path),origin:'provided DLL and expected output; browser execution only',path:fixture.path,expectedPath:fixture.expected,base64:bytes.toString('base64'),sha256:sha(bytes),expectedSha256:sha(expected),output:expected,nativeIntBits});}
  const status=(await command('git',['status','--porcelain=v1'])).stdout,diff=(await command('git',['diff','--binary','HEAD'])).stdout;
  const manifest={schemaVersion:1,preparedCommit,preparedAt:new Date().toISOString(),worktreeStatus:status,trackedDiffSha256:sha(diff),runtimeBundleSha256:sha(bundle),
    suiteSha256:sha(await readFile(resolve(root,'tests/browser_e01_suite.js'))),scalars,synchronization,assemblies,
    awaitSource:'using System.Threading.Tasks;class P{static async Task Main(){int[] values=new int[3];values[0]=42;Console.WriteLine("start");await Task.Delay(10);GC.Collect();Console.WriteLine(values[0]);await Task.Delay(20);Console.WriteLine("end");}}',awaitOutput:'start\n42\nend\n'};
  await writeFile(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  preparation.passed=true;preparation.runtimeBundleSha256=manifest.runtimeBundleSha256;preparation.output=output;
  console.log(JSON.stringify(preparation,null,2));
}catch(error){preparation.passed=false;preparation.error={name:error.name,message:error.message,stack:error.stack,stdout:error.stdout,stderr:error.stderr,exitCode:error.code};throw error;}
finally{await writeFile(resolve(output,'preparation.json'),JSON.stringify(preparation,null,2)+'\n');}
