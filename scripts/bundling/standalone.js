import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { bundleWorker } from '../bundle-worker.js';
import { bundleMarker } from './emit.js';
import { installCsp } from '../conformance/security/csp.js';

async function standaloneScript(entry, dist, ancestors = new Set(), workerPaths = new Set()) {
  const workers = [], cache = new Map();
  const chain = new Set([...ancestors, entry]);
  const workerUrl = async path => {
    path = await realpath(path);
    if (!path.startsWith(dist + sep)) throw new Error('Worker leaves standalone asset root');
    if (chain.has(path) || chain.size > 32) throw new Error('Recursive or excessive worker asset graph: ' + path);
    if (cache.has(path)) return `__sharpforgeWorkerUrl(${cache.get(path)})`;
    const id = workers.length;
    cache.set(path, id);
    workers.push(null);
    workerPaths.add(path);
    const source = await readFile(path, 'utf8');
    workers[id] = source.startsWith(bundleMarker) ? source : (await standaloneScript(path, dist, chain, workerPaths)).script;
    return `__sharpforgeWorkerUrl(${id})`;
  };
  const compiled = await bundleWorker(entry, { root: dist, workerUrl });
  const bootstrap = `'use strict';
const __sharpforgeWorkerSources = ${JSON.stringify(workers)};
const __sharpforgeWorkerUrls = new Map();
function __sharpforgeWorkerUrl(id) {
  if (!__sharpforgeWorkerUrls.has(id)) {
    const source = __sharpforgeWorkerSources[id];
    if (typeof source !== 'string') throw new Error('Unknown embedded worker');
    __sharpforgeWorkerUrls.set(id, URL.createObjectURL(new Blob([source], {type: 'text/javascript'})));
  }
  const asset = new URL(__sharpforgeWorkerUrls.get(id));
  Object.defineProperty(asset, 'workerType', {value: 'classic'});
  return asset;
}
globalThis.addEventListener?.('pagehide', event => {
  if (event.persisted) return;
  for (const url of __sharpforgeWorkerUrls.values()) URL.revokeObjectURL(url);
  __sharpforgeWorkerUrls.clear();
});
`;
  return { script: (workers.length ? bootstrap : '') + compiled, workers: workerPaths.size };
}

/** The one entry script includes a closed, deferred module graph and lazily allocated actual worker assets. */
export async function createStandalone(dist, { allowedOrigins = [] } = {}) {
  dist = await realpath(dist);
  let html = await readFile(resolve(dist, 'index.html'), 'utf8');
  const css = await readFile(resolve(dist, 'studio.css'), 'utf8');
  const { script, workers } = await standaloneScript(resolve(dist, 'studio.js'), dist);
  if (!html.includes('<link rel="stylesheet" href="./studio.css">') || !html.includes('<script type="module" src="./studio.js"></script>')) {
    throw new Error('Standalone HTML entry markers are missing');
  }
  html = html.replace('<link rel="stylesheet" href="./studio.css">', () => '<style>' + css + '</style>')
    .replace('<link rel="icon" href="./favicon.svg" type="image/svg+xml">', '');
  const inlineScript = script.replace(/<\/script/gi, '<\\/script');
  html = html.replace('<script type="module" src="./studio.js"></script>', () => '<script>' + inlineScript + '</script>');
  html = installCsp(html, { allowedOrigins, inlineScript });
  const description = '<!-- Self-contained SharpForge release: exact entry-script hash, trusted Blob workers and configured origins. -->';
  html = html.replace('<title>', description + '\n<title>');
  return { html, workers };
}
