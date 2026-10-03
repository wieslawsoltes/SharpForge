import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runChild} from '../process.js';
import {sha256} from '../fixtures.js';

const compiled = new WeakMap();
const source = await readFile(new URL('./ConsoleStartupHook.cs', import.meta.url));
export const consoleHostProfile = Object.freeze({id:'utf8-console-v1',sourceSHA256:sha256(source)});

/** Build the transport startup hook with the same checked compiler/reference pack. */
export async function consoleHost(toolchain, {signal} = {}) {
  signal?.throwIfAborted();
  if (compiled.has(toolchain)) return compiled.get(toolchain);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-console-host-'));
  try {
    const input = path.join(directory, 'ConsoleStartupHook.cs');
    const output = path.join(directory, 'SharpForge.Differential.ConsoleHost.dll');
    await writeFile(input, source);
    const args = [toolchain.csc,'/nologo','/noconfig','/nostdlib+','/utf8output','/deterministic+','/debug-','/optimize+','/target:library','/langversion:12.0',`/pathmap:${directory}=/_/console-host`,`/out:${output}`,...toolchain.references.map(file=>`/reference:${file}`),input];
    const run = await runChild(toolchain.dotnet,args,{cwd:directory,signal,timeoutMs:30000,maxOutputBytes:65536,env:{DOTNET_STARTUP_HOOKS:''}});
    if (run.exitCode!==0 || run.signal) throw new Error(`Console transport host compilation failed: ${run.stdout}${run.stderr}`);
    const assembly = await readFile(output);
    const result = {assembly,profile:{...consoleHostProfile,assemblySHA256:sha256(assembly)}};
    compiled.set(toolchain,result);
    return result;
  } finally { await rm(directory,{recursive:true,force:true}); }
}
