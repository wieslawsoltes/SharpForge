/** Package the built IDE and its closed module/worker graph into one HTML file. */
import { writeFile,mkdir } from 'node:fs/promises';
import { createStandalone } from './bundling/standalone.js';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectOrigins } from './conformance/security/csp.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dist=resolve(root,'dist');
const {html,workers}=await createStandalone(dist,{allowedOrigins:connectOrigins(process.env.SHARPFORGE_CONNECT_ORIGINS)});
const target=resolve(root,process.env.SHARPFORGE_STANDALONE_PATH || 'artifacts/SharpForge-standalone.html');
await mkdir(dirname(target),{recursive:true});
await writeFile(target,html);
console.log(`Built ${target} (${Buffer.byteLength(html).toLocaleString()} bytes; ${workers} embedded worker graphs)`);
