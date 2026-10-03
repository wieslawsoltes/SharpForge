import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { browserCsp, installCsp } from '../../../scripts/conformance/security/csp.js';
import { pagesTargets, probePages } from '../../../scripts/conformance/security/pages-probe.js';

const run = promisify(execFile);
const sourceHtml = await readFile(new URL('../../../apps/studio/index.html', import.meta.url), 'utf8');

async function pagesServer(t, respond) {
  const requests = [];
  const server = createServer((req, res) => { requests.push(req.url); respond(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return { url: `http://127.0.0.1:${server.address().port}/SharpForge/`, requests };
}

test('SF-A29-B03: _headers-only Pages fails, and generated index and 404 metadata pass', async t => {
  let html = sourceHtml;
  const server = await pagesServer(t, (req, res) => {
    // Static Pages serves _headers as a file; it does not apply those headers to HTML.
    const headersFile = req.url === '/SharpForge/_headers';
    res.writeHead(200, { 'content-type': headersFile ? 'text/plain' : 'text/html' });
    res.end(headersFile ? `/*\n  Content-Security-Policy: ${browserCsp()}\n` : html);
  });
  assert.match(await (await fetch(new URL('_headers', server.url))).text(), /Content-Security-Policy:/);
  const before = await probePages(server.url);
  assert.equal(before.passed, false);
  assert(before.results.every(result => !result.passed && !result.headerPresent));
  html = installCsp(sourceHtml);
  const after = await probePages(server.url, { revision: 'a'.repeat(40) });
  assert.equal(after.passed, true);
  assert.equal(after.workflowRevision, 'a'.repeat(40));
  assert(after.results.every(result => result.delivery === 'meta' && !result.headerPresent));
  assert.deepEqual(after.results.map(result => new URL(result.target).pathname), ['/SharpForge/index.html', '/SharpForge/404.html']);
  assert.deepEqual(server.requests.slice(-4), ['/SharpForge/index.html', '/SharpForge/404.html', '/SharpForge/index.html', '/SharpForge/404.html']);
});

test('a bad index retains the 404 result and a bad 404 fails the deployment', async t => {
  let broken = 'index.html';
  const server = await pagesServer(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(req.url.endsWith(broken) ? sourceHtml : installCsp(sourceHtml));
  });
  for (const target of ['index.html', '404.html']) {
    broken = target;
    const report = await probePages(server.url);
    assert.equal(report.passed, false);
    assert.equal(report.results.length, 2);
    assert.deepEqual(report.results.map(result => result.passed), target === 'index.html' ? [false, true] : [true, false]);
  }
});

test('published response status, content type, body size and timeout fail with retained evidence', async t => {
  let mode = 'status';
  const server = await pagesServer(t, (_req, res) => {
    if (mode === 'timeout') return;
    res.writeHead(mode === 'status' ? 404 : 200, { 'content-type': mode === 'type' ? 'text/plain' : 'text/html' });
    res.end(installCsp(sourceHtml));
  });
  for (const [next, expected, options] of [
    ['status', /HTTP 404/, {}], ['type', /Expected HTML/, {}],
    ['bytes', /byte budget/, { maxBytes: 4 }], ['timeout', /timeout|aborted/i, { timeoutMs: 40 }],
  ]) {
    mode = next;
    const report = await probePages(server.url, options);
    assert.equal(report.passed, false);
    assert.equal(report.results.length, 2);
    for (const result of report.results) assert.match(result.errors.join('\n'), expected);
  }
});

test('Pages targets preserve a project subpath and reject non-deployment inputs', () => {
  assert.deepEqual(pagesTargets('https://example.test/SharpForge'), [
    'https://example.test/SharpForge/index.html', 'https://example.test/SharpForge/404.html',
  ]);
  assert.deepEqual(pagesTargets('https://example.test/'), ['https://example.test/index.html', 'https://example.test/404.html']);
  for (const url of ['file:///tmp/site/', 'https://user:pass@example.test/', 'https://example.test/?x=1', 'https://example.test/#x', '']) {
    assert.throws(() => pagesTargets(url));
  }
});

test('CLI writes failure evidence and exits nonzero without omitting either file', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sharpforge-pages-policy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const server = await pagesServer(t, (_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(sourceHtml); });
  const output = join(dir, 'results', 'policy.json');
  await assert.rejects(run(process.execPath, [
    fileURLToPath(new URL('../../../scripts/conformance/security/pages-probe.js', import.meta.url)),
    '--url', server.url, '--output', output, '--revision', 'b'.repeat(40),
  ]), error => error.code === 1);
  const report = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(report.kind, 'deployed-pages-policy');
  assert.equal(report.passed, false);
  assert.equal(report.workflowRevision, 'b'.repeat(40));
  assert.equal(report.results.length, 2);
});
