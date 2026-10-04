import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleWorker } from './bundle-worker.js';
import { loadBuildContributions, concatenateStyles } from './build-contributions.js';
import { prepareBuildAssets } from './build-assets.js';
import { browserCsp, connectOrigins, installCsp } from './conformance/security/csp.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dist=resolve(root,'dist');
const contributions=await loadBuildContributions(root);
await prepareBuildAssets(contributions, { root, destination: dist });
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
console.log('Built dependency-free browser application in dist/');
