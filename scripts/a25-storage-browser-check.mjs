import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createGitStorageFixtureServer } from './a25-storage-browser-server.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allCases = ['memory', 'indexeddb', 'opfs', 'persistence', 'quota', 'fallback', 'filesystem', 'credentials'];

function optionsFromArguments(args) {
  const result = { count: 50000, timeoutMs: 1200000, cases: allCases, headed: false };
  const names = { '--output': 'output', '--screenshot': 'screenshot', '--count': 'count', '--timeout-ms': 'timeoutMs',
    '--cases': 'cases', '--chromium-executable': 'executable', '--playwright-module': 'playwrightModule', '--cdp-endpoint': 'cdpEndpoint' };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--headed') { result.headed = true; continue; }
    const name = names[args[index]];
    if (!name || args[index + 1] === undefined) throw new Error(`Unknown or incomplete option: ${args[index]}`);
    result[name] = args[++index];
  }
  if (!result.output || !isAbsolute(result.output)) throw new Error('--output must name an explicit absolute JSON evidence path');
  result.screenshot ??= result.output.replace(/\.json$/u, '') + '-ready.png';
  result.count = Number(result.count);
  result.timeoutMs = Number(result.timeoutMs);
  if (!Number.isSafeInteger(result.count) || result.count < 1 || result.count > 1000000) throw new Error('--count must be 1..1000000');
  if (!Number.isSafeInteger(result.timeoutMs) || result.timeoutMs < 1000) throw new Error('--timeout-ms must be at least 1000');
  if (typeof result.cases === 'string') result.cases = result.cases.split(',');
  if (result.cases.some(name => !allCases.includes(name))) throw new Error(`--cases accepts: ${allCases.join(',')}`);
  result.executable ??= process.env.CHROMIUM_EXECUTABLE;
  result.cdpEndpoint ??= process.env.SHARPFORGE_BROWSER_CDP_ENDPOINT;
  if (result.cdpEndpoint && result.executable) throw new Error('Choose either a Chromium executable or an explicit CDP endpoint');
  return result;
}

function diagnostic(error, options) {
  let text = error?.stack ?? String(error);
  if (options.cdpEndpoint) text = text.replaceAll(options.cdpEndpoint, '[explicit browser endpoint]');
  return text;
}

async function playwrightDependency(options) {
  const candidates = [];
  if (options.playwrightModule) candidates.push(pathToFileURL(resolve(options.playwrightModule)).href);
  else {
    try { candidates.push(import.meta.resolve('playwright')); } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    }
    const runtimeModules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
    if (runtimeModules) candidates.push(pathToFileURL(join(runtimeModules, 'playwright', 'index.mjs')).href);
  }
  let previous;
  for (const candidate of candidates) {
    try {
      const imported = await import(candidate);
      const metadata = JSON.parse(await readFile(join(dirname(fileURLToPath(candidate)), 'package.json'), 'utf8'));
      return { ...imported, version: metadata.version, modulePath: fileURLToPath(candidate) };
    } catch (error) {
      if (!['ERR_MODULE_NOT_FOUND', 'ENOENT'].includes(error.code)) throw error;
      previous = error;
    }
  }
  throw new Error('Playwright is unavailable; install the existing browser-test dependency or supply --playwright-module', { cause: previous });
}

async function withinTimeout(promise, milliseconds, name) {
  let timeout;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${name} exceeded ${milliseconds} ms`)), milliseconds);
    })]);
  } finally { clearTimeout(timeout); }
}

async function fixtureReady(page, url, { reload = false } = {}) {
  if (reload) await page.reload({ waitUntil: 'load', timeout: 30000 });
  else await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.getByText('Ready', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
  if (!await page.evaluate(() => Boolean(window.gitStorageAcceptance))) throw new Error('Storage fixture did not initialize');
}

async function runBrowserCases({ page, url, options, report, workers }) {
  const check = async (name, callback) => {
    const started = performance.now();
    process.stdout.write(`${JSON.stringify({ state: 'running', case: name })}\n`);
    const progress = setInterval(() => {
      process.stdout.write(`${JSON.stringify({ state: 'running', case: name, elapsedMs: performance.now() - started })}\n`);
    }, 30000);
    try {
      const result = await withinTimeout(callback(), options.timeoutMs, name);
      report.checks.push({ name, passed: true, elapsedMs: performance.now() - started, result });
      process.stdout.write(`${JSON.stringify({ state: 'passed', case: name, elapsedMs: performance.now() - started })}\n`);
    } catch (error) {
      report.checks.push({ name, passed: false, elapsedMs: performance.now() - started, error: diagnostic(error, options) });
      throw error;
    } finally { clearInterval(progress); }
  };
  for (const backend of ['memory', 'indexeddb', 'opfs']) {
    if (!options.cases.includes(backend)) continue;
    await check(`${backend}-conformance`, async () => {
      const result = await page.evaluate(backend => window.gitStorageAcceptance.conformance({ backend }), backend);
      const expected = backend === 'opfs' ? 'opfs-sync-worker' : backend;
      if (result.backend !== expected) throw new Error(`Expected actual ${expected}; received ${result.backend}`);
      if (backend === 'opfs' && !workers.some(url => url.endsWith('/opfs-worker.js'))) throw new Error('No actual OPFS module worker was observed');
      return result;
    });
  }
  if (options.cases.includes('persistence')) {
    await check('indexeddb-object-persistence-write', () => page.evaluate(count => window.gitStorageAcceptance.run({
      backend: 'indexeddb', repositoryId: 'a25-native-persistence', count, phase: 'write'
    }), options.count));
    await fixtureReady(page, url, { reload: true });
    report.persistenceReloaded = true;
    await check('indexeddb-object-persistence-reload-read', () => page.evaluate(count => window.gitStorageAcceptance.run({
      backend: 'indexeddb', repositoryId: 'a25-native-persistence', count, phase: 'read'
    }), options.count));
  }
  if (options.cases.includes('credentials')) {
    await check('credential-native-persistence-write-and-plaintext-scan', () => page.evaluate(() =>
      window.gitStorageAcceptance.runCredentialVault({ phase: 'write' })));
    await fixtureReady(page, url, { reload: true });
    report.credentialPersistenceReloaded = true;
    await check('credential-native-reload-tamper-isolation-and-logout', () => page.evaluate(() =>
      window.gitStorageAcceptance.runCredentialVault({ phase: 'read' })));
  }
  if (options.cases.includes('quota')) await check('indexeddb-quota-atomic-rollback', () => page.evaluate(() => window.gitStorageAcceptance.runQuota()));
  if (options.cases.includes('fallback')) await check('unsupported-opfs-indexeddb-fallback',
    () => page.evaluate(() => window.gitStorageAcceptance.runFallback()));
  if (options.cases.includes('filesystem')) await check('filesystem-access-opfs-directory-handle',
    () => page.evaluate(() => window.gitStorageAcceptance.runFileSystem()));
}

async function main() {
  const options = optionsFromArguments(process.argv.slice(2));
  await mkdir(dirname(options.output), { recursive: true });
  await mkdir(dirname(options.screenshot), { recursive: true });
  const report = { schemaVersion: 1, suite: 'SF-A25-storage-browser', passed: false, startedAt: new Date().toISOString(),
    implementationHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
    storage: 'native browser IndexedDB and OPFS; no storage emulation', checks: [], pageErrors: [], requestFailures: [], workers: [],
    selectedCases: options.cases, persistenceObjectCount: options.count, screenshot: options.screenshot, cspViolations: [] };
  let server;
  let browser;
  let page;
  let context;
  let failure;
  try {
    const playwright = await playwrightDependency(options);
    const serving = await createGitStorageFixtureServer();
    server = serving.server;
    report.csp = serving.csp;
    report.origin = serving.origin;
    browser = options.cdpEndpoint ? await playwright.chromium.connectOverCDP(options.cdpEndpoint, { timeout: 30000 })
      : await playwright.chromium.launch({ headless: !options.headed,
        ...(options.executable ? { executablePath: options.executable } : {}) });
    report.environment = { node: process.version, platform: process.platform, architecture: process.arch, engine: 'chromium',
      browserVersion: browser.version(), playwrightVersion: playwright.version,
      connection: options.cdpEndpoint ? 'explicit-cdp-endpoint' : 'local-launch',
      executable: options.cdpEndpoint ? 'remote Chromium' : options.executable ?? playwright.chromium.executablePath() };
    context = await browser.newContext({ viewport: { width: 1100, height: 720 } });
    await context.exposeBinding('__gitStorageReportCsp', (_, violation) => { report.cspViolations.push(violation); });
    await context.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', event => {
        window.__gitStorageReportCsp({ directive: event.violatedDirective, blockedURI: event.blockedURI });
      });
    });
    page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.stack ?? String(error)));
    page.on('requestfailed', request => report.requestFailures.push({ url: request.url(), error: request.failure()?.errorText }));
    page.on('worker', worker => report.workers.push(worker.url()));
    const url = `${serving.origin}/tests/a25-storage-browser.html`;
    await fixtureReady(page, url);
    await page.screenshot({ path: options.screenshot, fullPage: true });
    await runBrowserCases({ page, url, options, report, workers: report.workers });
    if (report.pageErrors.length || report.requestFailures.length || report.cspViolations.length) {
      throw new Error('Browser emitted a page, request or CSP error; inspect recorded evidence');
    }
    report.passed = true;
    report.fullStorageScope = allCases.every(name => options.cases.includes(name)) && options.count >= 50000;
  } catch (error) {
    failure = error;
    report.failure = diagnostic(error, options);
    if (page) {
      const failureScreenshot = options.output.replace(/\.json$/u, '') + '-failure.png';
      await page.screenshot({ path: failureScreenshot, timeout: 5000 }).then(() => { report.failureScreenshot = failureScreenshot; },
        screenshotError => { report.screenshotError = String(screenshotError); });
    }
  } finally {
    await context?.close().catch(error => { report.contextCloseError = String(error); });
    await browser?.close().catch(error => { report.browserCloseError = String(error); });
    if (server) await new Promise(resolveClosed => server.close(resolveClosed));
    report.completedAt = new Date().toISOString();
    await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify({ passed: report.passed, checks: report.checks.length, evidence: options.output })}\n`);
  if (failure) { process.stderr.write(`${diagnostic(failure, options)}\n`); process.exitCode = 1; }
}

main().catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
