import { mkdir, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { browserCsp, metaCsp, connectOrigins, standaloneScript } from './csp.js';
import { headPolicies, samePolicy } from './html-policy.js';

export function inspectPolicy(html, { header = '', allowedOrigins = [], standalone = false } = {}) {
  const inlineScript = standalone ? standaloneScript(html) : undefined;
  if (standalone && inlineScript === undefined) throw new Error('Missing generated standalone policy marker');
  const expected = browserCsp({ allowedOrigins, inlineScript }), meta = headPolicies(html);
  const headerPass = header.split(',').some(policy => samePolicy(policy.trim(), expected));
  const metaPass = meta.policies.some(policy => samePolicy(policy, metaCsp(expected)));
  return {
    passed: headerPass || metaPass,
    delivery: headerPass ? 'header' : metaPass ? 'meta' : null,
    errors: headerPass || metaPass ? [] : [...meta.errors, 'No enforced policy matches the generated network policy'],
    headerPresent: !!header, metaPolicies: meta.policies.length,
  };
}

export async function probe(target, { timeoutMs = 10000, maxBytes = 32 * 1024 * 1024, ...options } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) throw new Error('Invalid probe byte budget');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) throw new Error('Invalid probe timeout');
  let html, header = '', finalUrl = null;
  if (/^https?:\/\//i.test(target)) {
    const response = await fetch(target, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${target}`);
    if (!/^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error('Expected HTML response');
    header = response.headers.get('content-security-policy') ?? '';
    finalUrl = response.url;
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('HTML response exceeds probe byte budget');
      chunks.push(chunk);
    }
    html = Buffer.concat(chunks).toString('utf8');
  } else {
    const chunks = []; let size = 0;
    for await (const chunk of createReadStream(resolve(target))) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('HTML file exceeds probe byte budget');
      chunks.push(chunk);
    }
    html = Buffer.concat(chunks).toString('utf8');
  }
  return { target, finalUrl, ...inspectPolicy(html, { ...options, header }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    output: { type: 'string' }, origins: { type: 'string', default: '' }, standalone: { type: 'boolean', default: false },
  } });
  if (!positionals.length) throw new Error('Usage: node header-probe.js FILE_OR_URL [...] [--output REPORT.json]');
  const results = [];
  for (const target of positionals) {
    try { results.push(await probe(target, { allowedOrigins: connectOrigins(values.origins), standalone: values.standalone })); }
    catch (error) { results.push({ target, passed: false, errors: [error.message] }); }
  }
  const report = { schemaVersion: 1, passed: results.every(result => result.passed), results };
  const text = JSON.stringify(report, null, 2) + '\n';
  if (values.output) { await mkdir(dirname(resolve(values.output)), { recursive: true }); await writeFile(values.output, text); }
  console.log(text);
  if (!report.passed) process.exitCode = 1;
}
