/** Install every workspace tarball offline and execute package-owned smoke contributions. */
import {mkdir, mkdtemp, writeFile, readFile, rm, cp, stat, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {npmCli} from './conformance/node-tools.js';
import {resultPath} from './conformance/results.js';
import {filesUnder, isMain} from './planning/test-manifests.js';
import {globPattern} from './planning/lib/paths.js';
export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
export async function discoverPackages(root = packageRoot) {
  const workspace = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const globs = Array.isArray(workspace.workspaces) ? workspace.workspaces : workspace.workspaces?.packages;
  if (!Array.isArray(globs) || !globs.length) throw new Error('Root package.json must declare workspaces');
  const patterns = globs.map(glob => globPattern(glob.replace(/\/$/, '') + '/package.json'));
  const manifests = (await filesUnder(root)).filter(path => patterns.some(pattern => pattern.test(path)));
  if (!manifests.length) throw new Error('No workspace packages discovered');
  const seen = new Set(), packages = [];
  for (const path of manifests) {
    const manifest = JSON.parse(await readFile(join(root, path), 'utf8'));
    if (typeof manifest.name !== 'string' || !manifest.name || typeof manifest.version !== 'string') throw new Error(`Invalid workspace package ${path}`);
    if (seen.has(manifest.name)) throw new Error(`Duplicate workspace package ${manifest.name}`);
    seen.add(manifest.name);
    const directory = path.slice(0, path.lastIndexOf('/')), smoke = `${directory}/smoke.mjs`;
    await stat(resolve(root, smoke)).catch(() => {throw new Error(`Missing package smoke contribution ${smoke}`);});
    packages.push({name: manifest.name, version: manifest.version, directory, smoke});
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}
function run(command, args, cwd = packageRoot) {
  const result = spawnSync(command === 'npm' ? process.execPath : command, command === 'npm' ? [npmCli(), ...args] : args, {cwd, encoding: 'utf8', timeout: 120000});
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr}\n${result.stdout}`);
  return result.stdout;
}
export function validatePacked(packages, packed) {
  if (!Array.isArray(packed) || packed.length !== packages.length) throw new Error(`Expected ${packages.length} package tarballs; received ${packed?.length}`);
  const seen = new Set();
  for (const item of packed) {
    if (!packages.some(pkg => pkg.name === item.name && pkg.version === item.version) || seen.has(item.name)) throw new Error(`Unexpected/duplicate tarball ${item.name}@${item.version}`);
    if (typeof item.filename !== 'string' || item.filename.includes('/') || item.filename.includes('\\') || !item.filename.endsWith('.tgz')) throw new Error(`Invalid tarball filename ${item.filename}`);
    seen.add(item.name);
  }
  return packed.map(item => item.filename).sort();
}
const runner = `import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const directory=process.cwd(), entries=JSON.parse(await readFile('smokes.json','utf8'));
const report={passed:true,node:process.version,mode:'All '+entries.length+' workspace tarballs installed offline in an isolated project, without source workspace links',packages:{},smokeSteps:[]},context={report};
const modules=[];
function run(command,args,options={}){const result=spawnSync(command,args,{cwd:directory,timeout:120000,...options});if(result.error||result.status!==0)throw new Error(command+' failed: '+(result.error?.message??result.stderr));return result.stdout;}
for(const entry of entries){const api=await import(entry.name),module=await import(pathToFileURL(join(directory,entry.smoke)));report.packages[entry.name]=Object.keys(api).length;if(!report.packages[entry.name]||typeof module.smoke!=='function')throw new Error('Invalid public API or smoke contribution '+entry.name);await module.smoke({api,directory,report});modules.push({entry,module});}
const steps=modules.flatMap(({module})=>module.smokeSteps??[]).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id)),ids=new Set();
for(const step of steps){if(typeof step.id!=='string'||ids.has(step.id)||!Number.isSafeInteger(step.order)||typeof step.run!=='function')throw new Error('Invalid/duplicate smoke step '+step.id);ids.add(step.id);await step.run(context);report.smokeSteps.push(step.id);}
for(const {entry,module} of modules)if(module.smokeInstalledCli)await module.smokeInstalledCli({directory,packageRoot:join(directory,'node_modules',entry.name),run});
console.log(JSON.stringify(report,null,2));`;
export async function verifyPackages(root = packageRoot) {
  const packages = await discoverPackages(root), artifacts = join(root, 'artifacts');
  await mkdir(artifacts, {recursive: true});
  const packDirectory = await mkdtemp(join(artifacts, 'package-verification-'));
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-packages-'));
  try {
    const packed = JSON.parse(run('npm', ['pack', '--workspaces', '--ignore-scripts', '--pack-destination', packDirectory, '--json'], root));
    const tarballs = validatePacked(packages, packed);
    await writeFile(join(directory, 'package.json'), JSON.stringify({name: 'sharpforge-isolated-smoke', version: '1.0.0', private: true, type: 'module'}));
    run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs.map(name => join(packDirectory, name))], directory);
    const entries = [];
    for (const [index, pkg] of packages.entries()) {
      const smoke = `smoke-${index}.mjs`;
      await cp(resolve(root, pkg.smoke), join(directory, smoke));
      entries.push({name: pkg.name, smoke});
    }
    await writeFile(join(directory, 'smokes.json'), JSON.stringify(entries));
    await writeFile(join(directory, 'verify.mjs'), runner);
    const output = run(process.execPath, ['verify.mjs'], directory);
    for (const name of await readdir(artifacts)) if (name.endsWith('.tgz')) await rm(join(artifacts, name));
    for (const name of tarballs) await cp(join(packDirectory, name), join(artifacts, name));
    const report = {...JSON.parse(output), timestamp: new Date().toISOString(), tarballs};
    await writeFile(await resultPath('package-results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(output); return report;
  } finally {
    await rm(directory, {recursive: true, force: true});
    await rm(packDirectory, {recursive: true, force: true});
  }
}
if (isMain(import.meta.url)) {
  try {await verifyPackages();} catch (error) {console.error(error.message); process.exitCode = 1;}
}
