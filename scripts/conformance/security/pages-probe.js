import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { probe } from './header-probe.js';

export function pagesTargets(publishedUrl) {
  const base = new URL(publishedUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('Expected an HTTP(S) Pages site URL without credentials, query or fragment');
  }
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return ['index.html', '404.html'].map(file => new URL(file, base).href);
}

/** Inspect the published files sequentially; a failure still retains both results. */
export async function probePages(publishedUrl, { revision = null, timeoutMs = 10000, maxBytes = 32 * 1024 * 1024 } = {}) {
  const targets = pagesTargets(publishedUrl), results = [];
  for (const target of targets) {
    try { results.push(await probe(target, { timeoutMs, maxBytes })); }
    catch (error) { results.push({ target, passed: false, errors: [error.message] }); }
  }
  return {
    schemaVersion: 1, kind: 'deployed-pages-policy', checkedAt: new Date().toISOString(),
    publishedUrl, workflowRevision: revision, limits: { timeoutMs, maxBytes },
    passed: results.every(result => result.passed), results,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    url: { type: 'string' }, output: { type: 'string' }, revision: { type: 'string' },
  } });
  if (!values.url || !values.output) throw new Error('Usage: node pages-probe.js --url PUBLISHED_URL --output REPORT.json [--revision SHA]');
  const report = await probePages(values.url, { revision: values.revision });
  const text = JSON.stringify(report, null, 2) + '\n';
  await mkdir(dirname(resolve(values.output)), { recursive: true });
  await writeFile(values.output, text);
  console.log(text);
  if (!report.passed) process.exitCode = 1;
}
