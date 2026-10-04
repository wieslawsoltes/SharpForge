import { mkdir, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleWorker } from './bundle-worker.js';
import { loadBuildContributions, concatenateStyles } from './build-contributions.js';
import { browserCsp, connectOrigins, installCsp } from './conformance/security/csp.js';
import { checkoutIdentity, writeBuildIdentity } from './conformance/build-identity.js';
import { rewriteModulePaths } from './build-module-paths.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dist=resolve(root,'dist');
const sourceIdentity=checkoutIdentity(root);
const contributions=await loadBuildContributions(root);
await rm(dist,{recursive:true,force:true});await mkdir(dist,{recursive:true});
for (const asset of contributions.assets) {
 const target=resolve(dist,asset.target);await mkdir(dirname(target),{recursive:true});
 await cp(resolve(root,asset.source),target,{recursive:true});
}
await rewriteModulePaths(dist);
await writeFile(resolve(dist,'studio.css'),await concatenateStyles(contributions.styles,root));

for (const worker of contributions.workers) {
 const path=resolve(dist,worker.entry);
 await writeFile(path,await bundleWorker(path,{root:dist}));
}
// Single-file classic workers avoid extra module fetches at startup. Source workers remain ESM.
const studioPath = resolve(dist, 'studio.js');
await writeFile(studioPath, (await readFile(studioPath, 'utf8')).replace("new Worker(url,{type:'module'})", "new Worker(url)"));
const cspOptions={allowedOrigins:connectOrigins(process.env.SHARPFORGE_CONNECT_ORIGINS)};
const html=installCsp(await readFile(resolve(dist,'index.html'),'utf8'),cspOptions);
await writeFile(resolve(dist,'index.html'),html);await writeFile(resolve(dist,'404.html'),html);
await writeFile(resolve(dist,'_headers'),`/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: ${browserCsp(cspOptions)}\n`);
await writeBuildIdentity(root,dist,sourceIdentity);
console.log('Built dependency-free browser application in dist/');
