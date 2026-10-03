/** Transport fixture, NOT an implementation or substitute for MSBuild. */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const args=process.argv.slice(2);if(args.includes('-version')){console.log('17.14.99 TEST PROCESS — not MSBuild');process.exit(0);}
const project=args.find(a=>/\.(?:csproj|slnx|sln|proj)$/i.test(a));
const value=key=>args.find(a=>a.startsWith(key))?.slice(key.length);
const mode=value('-p:Fixture=')??'ok';
if(mode==='sleep'){console.log('fixture waiting');setInterval(()=>{},1000);}
else if(mode==='flood'){const data=Buffer.alloc(65536,120);setInterval(()=>process.stdout.write(data),1);}
else if(mode==='fail'){console.log(`${project}(3,7): error CS1002: ; expected [${project}]`);process.exitCode=1;}
else{
 const pre=value('-preprocess:'),targets=value('-targets:'),bin=value('-binaryLogger:')?.split(';')[0];
 if(pre)await writeFile(pre,'<Project><PropertyGroup><FromImport>fixture</FromImport></PropertyGroup></Project>');
 if(targets)await writeFile(targets,'Build\nClean\nPack\nCustomTarget\n');
 if(bin)await writeFile(bin,new Uint8Array([1,2,3,4]));
 if(value('-getProperty:')){
  console.log('Fixture startup banner');console.log(JSON.stringify({Properties:{MSBuildVersion:'17.14.99 fixture',MSBuildProjectFullPath:project,Configuration:value('-p:Configuration=')??'Debug',TargetFramework:'net10.0',AssemblyName:'Fixture',TargetFrameworks:'net10.0',ImportedProperty:'not-native-evaluation'},Items:{Compile:[{Identity:'Program.cs',FullPath:join(dirname(project),'Program.cs'),DefiningProjectFullPath:project}],PackageReference:[{Identity:'Sample.Package',Version:'1.0.0'}]}}));
 }else{
  const bytes=Buffer.from('fixture UTF-8 😀 café\n');process.stdout.write(bytes.subarray(0,15));await new Promise(r=>setTimeout(r,5));process.stdout.write(bytes.subarray(15));
  console.log(`${project}(2,1): warning TEST001: simulated warning [${project}]`);
  const output=join(dirname(project),'bin','Debug','net10.0');await mkdir(output,{recursive:true});
  if(value('-p:FixtureAssembly='))await writeFile(join(output,'Fixture.dll'),await readFile(value('-p:FixtureAssembly=')));
  else await writeFile(join(output,'Fixture.dll'),new Uint8Array([77,90,0,0]));
  console.log('TEST PROCESS completed (no actual MSBuild tasks executed)');
 }
}
