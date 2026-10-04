import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const xml = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function running(pid) {
  try { process.kill(pid, 0); }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  if (process.platform === 'linux') {
    try { return !/\) [ZX] /.test(await readFile(`/proc/${pid}/stat`, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  return true;
}

/** Cancel an actual MSBuild Exec task with a Node child and grandchild, then assert all observed descendants terminated. */
export async function qualifyProcessTreeCancellation(engine) {
  const directory = join(engine.workspace.root, 'Cancellation');
  await mkdir(directory, { recursive: true });
  const files = {
    'grandchild.cjs': 'setInterval(() => {}, 1000);',
    'child.cjs': "const {spawn}=require('node:child_process');const {join}=require('node:path');" +
      "const child=spawn(process.execPath,[join(__dirname,'grandchild.cjs')],{stdio:'ignore'});" +
      "console.log('SFQA_TREE:'+JSON.stringify([process.ppid,process.pid,child.pid]));setInterval(()=>{},1000);",
    'parent.cjs': "const {spawn}=require('node:child_process');const {join}=require('node:path');" +
      "const child=spawn(process.execPath,[join(__dirname,'child.cjs')],{stdio:['ignore','pipe','inherit']});" +
      'child.stdout.pipe(process.stdout);setInterval(()=>{},1000);'
  };
  for (const [name, source] of Object.entries(files)) await writeFile(join(directory, name), source);
  const command = `"${process.execPath}" "${join(directory, 'parent.cjs')}"`;
  await writeFile(join(directory, 'Tree.proj'), '<Project><Target Name="Hold"><Exec StandardOutputImportance="High" Command="' +
    xml(command) + '" /></Target></Project>');
  const started = await engine.start({ project: 'Cancellation/Tree.proj', action: 'target', targets: ['Hold'], trusted: true });
  let descendants = null;
  const deadline = performance.now() + 20000;
  try {
    while (performance.now() < deadline) {
      const job = engine.snapshot(started.id);
      const match = job.events.map(event => event.text).join('').match(/SFQA_TREE:(\[[\d,]+\])/);
      if (match) { descendants = JSON.parse(match[1]); break; }
      if (['failed', 'succeeded', 'cancelled'].includes(job.status)) throw new Error('Process-tree fixture ended before reporting descendants');
      await pause(25);
    }
    if (!descendants) throw new Error('Process-tree fixture did not report descendants within 20 seconds');
  } finally { engine.cancel(started.id); }
  const result = await engine.wait(started.id);
  for (let attempt = 0; attempt < 40; attempt++) {
    if (!(await Promise.all(descendants.map(running))).some(Boolean)) {
      return { capability: 'cancel-grandchildren', status: 'passed', descendants, jobStatus: result.status,
        invocation: result.invocation, platform: process.platform };
    }
    await pause(50);
  }
  throw new Error('Native cancellation left a live descendant: ' + descendants.join(', '));
}
