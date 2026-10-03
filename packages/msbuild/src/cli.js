import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { NativeWorkspace } from './workspace.js';
import { NativeMSBuild } from './engine.js';
import { startMSBuildHost } from './server.js';
import { BUILD_ACTIONS, parsePropertyLines } from './contract.js';
export const MSBUILD_HELP=`SharpForge local MSBuild bridge (requires Node 22+ and an installed SDK/MSBuild)

  sharpforge-msbuild serve --root <workspace> --studio <dist> --trust-projects
  sharpforge-msbuild build <relative.csproj|slnx> --root <workspace> --trust-projects --restore
  sharpforge-msbuild evaluate <relative.csproj> --root <workspace> --trust-projects --json
  sharpforge-msbuild target <relative.csproj> --target MyTarget --trust-projects

Actions: ${BUILD_ACTIONS.join(', ')}
Options:
  --root DIR                 Explicit workspace root (default current directory)
  --studio DIR               Static SharpForge dist directory (serve only)
  --connect-origin ORIGIN    Repeatable outgoing browser CSP grant (serve only; VM grant is separate)
  --port NUMBER              Loopback port (default 4175; 0 chooses an available port)
  --engine dotnet|msbuild    dotnet msbuild, or a standalone MSBuild executable
  --executable PATH          Owner-selected native executable (default dotnet/MSBuild.exe)
  --trust-projects           Permit local code execution, including evaluation and restore
  --configuration VALUE     Global Configuration property
  --platform VALUE          Global Platform property
  --framework TFM           Select one target framework; omitted builds all configured TFMs
  --runtime RID             Global RuntimeIdentifier property
  --property Name=Value     Repeatable global properties
  --target Name             Repeatable custom targets (target action)
  --result-target Name      Repeatable target-result queries (executes targets)
  --restore                 Restore before execution
  --binlog                  Capture binary log (may contain sensitive build data)
  --graph                   Enable graph build
  --max-nodes N             Parallel MSBuild nodes (1–64)
  --verbosity LEVEL         quiet|minimal|normal|detailed|diagnostic
  --json                    Print the final job result instead of streaming output
  -- <MSBuild switches>     Advanced individual switches, no shell invocation

Projects/tasks/property functions execute with your OS account. This is NOT a sandbox.
The host binds only 127.0.0.1, serves the IDE on the same origin, and uses an ephemeral token.
SDKs, workloads, packages and Windows-only tasks must be installed/available locally.
`;
export async function runMSBuildCLI(argv=process.argv.slice(2),io={out:process.stdout,err:process.stderr}){
 if(!argv.length||argv.includes('--help')||argv.includes('-h')){io.out.write(MSBUILD_HELP);return 0;}
 const args=[...argv],action=args.shift(),options={root:process.cwd()},request={action,properties:{},targets:[],resultTargets:[]},extra=[];let json=false;
 if(action!=='serve'&&!BUILD_ACTIONS.includes(action))throw new Error('Unknown action: '+action);
 while(args.length){const arg=args.shift();if(arg==='--'){extra.push(...args);break;}
  if(arg==='--trust-projects'){options.trusted=true;request.trusted=true;continue;}if(arg==='--restore'){request.restore=true;continue;}if(arg==='--binlog'){request.binaryLog=true;continue;}if(arg==='--graph'){request.graphBuild=true;continue;}if(arg==='--json'){json=true;continue;}
  if(arg==='--connect-origin'){if(action!=='serve'||!args.length)throw new Error('--connect-origin requires serve and one exact origin');(options.connectOrigins??=[]).push(args.shift());continue;}
  const key={'--root':'root','--studio':'studioRoot','--port':'port','--engine':'engine','--executable':'executable','--configuration':'configuration','--platform':'platform','--framework':'framework','--runtime':'runtime','--max-nodes':'maxNodes','--verbosity':'verbosity','--property':'property','--target':'target','--result-target':'resultTarget'}[arg];
  if(key){if(!args.length)throw new Error('Missing value for '+arg);const value=args.shift();if(key==='property')Object.assign(request.properties,parsePropertyLines(value));else if(key==='target')request.targets.push(value);else if(key==='resultTarget')request.resultTargets.push(value);else if(['root','studioRoot','port','engine','executable'].includes(key))options[key]=key==='port'?Number(value):value;else request[key]=key==='maxNodes'?Number(value):value;continue;}
  if(!arg.startsWith('-')&&!request.project&&action!=='serve'){request.project=arg;continue;}throw new Error('Unknown argument: '+arg);
 }
 options.root=resolve(options.root);if(options.engine==='msbuild'&&!options.executable)options.executable=process.platform==='win32'?'MSBuild.exe':'msbuild';
 if(action==='serve'){
  if(!options.studioRoot){const candidate=resolve(dirname(fileURLToPath(import.meta.url)),'../../../dist');if(existsSync(resolve(candidate,'index.html')))options.studioRoot=candidate;}
  const host=await startMSBuildHost(options);io.out.write(`SharpForge MSBuild host: ${host.url}\nWorkspace: ${host.workspace.root}\nNative execution: ${options.trusted?'explicitly enabled — trusted local code':'disabled (use --trust-projects to enable)'}\n`);
  let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await host.close();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);};process.on('SIGINT',stop);process.on('SIGTERM',stop);return host;
 }
 request.arguments=extra;if(!request.project)throw new Error('Specify a workspace-relative project or solution');
 const workspace=await NativeWorkspace.open(options.root),engine=new NativeMSBuild(workspace,options);let cursor=0,timer;
 const interrupt=()=>{if(engine.active)engine.cancel(engine.active);};process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
 try{const started=await engine.start(request);if(!json)timer=setInterval(()=>{const current=engine.snapshot(started.id,cursor);for(const event of current.events)(event.stream==='stderr'?io.err:io.out).write(event.text);cursor=current.nextCursor;},50);
  const result=await engine.wait(started.id);if(timer)clearInterval(timer);if(json)io.out.write(JSON.stringify(result,null,2)+'\n');else {for(const event of engine.snapshot(started.id,cursor).events)(event.stream==='stderr'?io.err:io.out).write(event.text);if(result.error)io.err.write(result.error+'\n');io.out.write(`MSBuild ${result.status}; artifacts: ${result.artifacts.map(a=>a.path).join(', ')||'none'}\n`);}return result.status==='succeeded'?0:result.status==='cancelled'?130:1;
 }finally{if(timer)clearInterval(timer);process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);await engine.close();}
}
