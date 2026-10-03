import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createBrowserCsp } from '../../../packages/network/src/index.js';
import { browserCsp, installCsp, metaCsp, scriptHash, standaloneScript, hostedHtml } from '../../../scripts/conformance/security/csp.js';
import { inspectPolicy, probe } from '../../../scripts/conformance/security/header-probe.js';

const document = '<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title></head><body></body></html>';

test('HTTP headers protect headless HTML and keep generated metadata grants in sync', () => {
  const fragment = '<h1>Valid implicit-head HTML</h1>';
  const response = hostedHtml(fragment);
  assert.equal(response.body, fragment);
  assert.equal(inspectPolicy(response.body, { header: response.policy }).delivery, 'header');
  const allowedOrigins = ['https://api.example.test'];
  const generated = hostedHtml(installCsp(document), { allowedOrigins });
  assert.equal(inspectPolicy(generated.body, { allowedOrigins }).passed, true);
  assert.equal(generated.policy, browserCsp({ allowedOrigins }));
});

test('static-host metadata derives from the network policy and precedes resources', () => {
  const allowedOrigins = ['https://api.example.test'], full = createBrowserCsp(allowedOrigins);
  const html = installCsp(document, { allowedOrigins });
  assert.equal(browserCsp({ allowedOrigins }), full);
  assert.equal(inspectPolicy(html, { allowedOrigins }).delivery, 'meta');
  assert(!metaCsp(full).includes('frame-ancestors'));
  assert(full.includes("frame-ancestors 'none'"));
  assert.equal(installCsp(html, { allowedOrigins }), html);
  assert.throws(() => installCsp(document, { allowedOrigins: ['https://a.test/path'] }), /exact/);
  assert.equal(inspectPolicy(html).passed, false, 'different grants are policy drift');
});

test('an exact standalone script hash permits only the emitted bytes', () => {
  const inlineScript = 'console.log("a <\\/script> b");';
  const html = installCsp(document.replace('</body>', `<script>${inlineScript}</script></body>`), { inlineScript });
  assert.equal(standaloneScript(html), inlineScript);
  assert(html.includes(scriptHash(inlineScript)));
  assert(!browserCsp({ inlineScript }).includes("script-src 'unsafe-inline'"));
  assert.equal(inspectPolicy(html, { standalone: true }).passed, true);
  assert.equal(inspectPolicy(html.replace('console.log(', 'console.warn('), { standalone: true }).passed, false);
  assert.throws(() => standaloneScript(html.replace('</body>', '<script>extra()</script></body>')), /entry script/);
});

test('header delivery passes, while missing, report-only and permissive policy do not', () => {
  assert.equal(inspectPolicy(document, { header: browserCsp() }).delivery, 'header');
  assert.equal(inspectPolicy(document).passed, false);
  assert.equal(inspectPolicy(document, { header: "default-src *; script-src 'unsafe-inline'" }).passed, false);
  assert.equal(inspectPolicy(installCsp(document).replace('Content-Security-Policy"', 'Content-Security-Policy-Report-Only"')).passed, false);
});

test('inactive or late metadata cannot qualify an HTML document', () => {
  const tag = installCsp(document).match(/<meta data-sharpforge-csp[^>]+>/)[0];
  const wrappers = [
    `<!-- ${tag} -->`, `<script>const text = '${tag}';</script>`, `<template>${tag}</template>`,
    `<template><script>const text = '</template>${tag}';</script></template>`, `<noscript>${tag}</noscript>`,
    `<link rel="stylesheet" href="style.css">${tag}`, `<script src="app.js"></script>${tag}`, `<div>${tag}</div>`,
    `text${tag}`, '</head><body>' + tag,
  ];
  for (const contents of wrappers) assert.equal(inspectPolicy(`<html><head>${contents}</head></html>`).passed, false, contents);
  for (const prefix of ['text', '<div>body</div>', '<template></template>', '</html>']) {
    assert.equal(inspectPolicy(`${prefix}<html><head>${tag}</head></html>`).passed, false, prefix);
  }
  assert.throws(() => installCsp(`<head><meta http-equiv='Content-Security-Policy' content="default-src 'none'"></head>`), /existing/);
});

test('local and HTTP probes enforce content, response status and byte budgets', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sharpforge-csp-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const html = installCsp(document), file = join(dir, 'index.html');
  await writeFile(file, html);
  assert.equal((await probe(file)).passed, true);
  await assert.rejects(probe(file, { maxBytes: 4 }), /byte budget/);
  const server = createServer((req, res) => {
    res.writeHead(req.url === '/missing' ? 404 : 200, { 'content-type': req.url === '/text' ? 'text/plain' : 'text/html' });
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await probe(base)).passed, true);
  await assert.rejects(probe(base + '/missing'), /HTTP 404/);
  await assert.rejects(probe(base + '/text'), /Expected HTML/);
  await assert.rejects(probe(base, { maxBytes: 4 }), /byte budget/);
});
