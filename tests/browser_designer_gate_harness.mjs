import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {assert};

/** Poll from the test process: the shipped CSP intentionally forbids Playwright's eval-based wait helper. */
export async function waitFor(page, predicate, argument, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await page.evaluate(predicate, argument);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Browser condition timed out after ${timeout} ms: ${predicate}`);
}

export function documentHost(page, uri) {
  return page.locator(`[data-designer-document=${JSON.stringify(uri)}]`);
}

export function documentPanel(page, uri, panel) {
  return page.locator(`[data-designer-uri=${JSON.stringify(uri)}][data-designer-panel=${JSON.stringify(panel)}]`);
}

export async function snapshot(page, uri) {
  return page.evaluate(uri => sharpforge.designerDocuments.get(uri), uri);
}

export async function selectNode(page, uri, id) {
  await page.evaluate(({uri, id}) => {
    sharpforge.openFile(uri);
    sharpforge.designerDocuments.select(uri, [id]);
  }, {uri, id});
}

export async function openPanel(page, uri, panel) {
  await page.evaluate(({uri, panel}) => { sharpforge.openFile(uri); sharpforge.openTool(panel); }, {uri, panel});
  const locator = documentPanel(page, uri, panel);
  await locator.waitFor({state: 'visible'});
  return locator;
}

export async function overflow(page, uri) {
  const host = documentHost(page, uri);
  const toggle = host.locator('button[data-design-action="more"]');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  const dialog = host.getByRole('dialog', {name: 'More designer commands'});
  await dialog.waitFor({state: 'visible'});
  return dialog;
}

export async function previewOption(page, uri, key, value) {
  const dialog = await overflow(page, uri);
  await dialog.locator(`[data-preview-option=${JSON.stringify(key)}]`).selectOption(value);
  await dialog.press('Escape');
}

export async function loadWorkspace(page, records, uri, mode = 'design') {
  await page.evaluate(async ({records, uri, mode}) => {
    await sharpforge.loadDiskRecords(records, {name: 'A18 integrated browser qualification', mode: 'folder'});
    await sharpforge.designerDocuments.open(uri, mode);
  }, {records, uri, mode});
  await documentHost(page, uri).locator('.design-preview [data-sf-id]').first().waitFor({state: 'visible'});
}

export async function createGate({captureMode = process.env.SHARPFORGE_DESIGNER_CAPTURE ?? 'diagnostic', resultsSubdirectory = null} = {}) {
  assert(['diagnostic', 'measurement'].includes(captureMode), 'SHARPFORGE_DESIGNER_CAPTURE must be diagnostic or measurement.');
  assert(resultsSubdirectory === null || typeof resultsSubdirectory === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(resultsSubdirectory),
    'Invalid browser results subdirectory.');
  const baseURL = process.env.SHARPFORGE_BROWSER_URL;
  assert(baseURL, 'Set SHARPFORGE_BROWSER_URL to the already built and served Studio; this driver never starts a server.');
  const require = createRequire(import.meta.url);
  const paths = [process.cwd(), process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean);
  const {chromium} = require(process.env.PLAYWRIGHT_MODULE ?? require.resolve('playwright', {paths}));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const resultsRoot = resolve(process.env.SHARPFORGE_RESULTS_DIR ?? resolve(root, 'artifacts/results'));
  const results = resultsSubdirectory === null ? resultsRoot : resolve(resultsRoot, resultsSubdirectory);
  await mkdir(resolve(results, 'screenshots'), {recursive: true});
  const options = {headless: true};
  if (process.env.CHROMIUM_EXECUTABLE) options.executablePath = process.env.CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(options);
  const context = await browser.newContext({viewport: {width: 1600, height: 1000}, deviceScaleFactor: 1});
  // Playwright DOM snapshots walk the whole scene after each action; keep them outside measured input runs.
  const traceOptions = {screenshots: captureMode === 'diagnostic', snapshots: captureMode === 'diagnostic', sources: true};
  await context.tracing.start(traceOptions);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const report = {browser: await browser.version(), baseURL, checks: [], errors: [], consoleErrors: [], requestFailures: []};
  report.capture = {mode: captureMode, playwright: traceOptions, actionTrace: true, finalScreenshot: true,
    rendererTasks: 'All overlapping raw CDP renderer tasks; no artifact-task filtering.'};
  process.stdout.write(`CAPTURE ${captureMode}: DOM snapshots ${traceOptions.snapshots}; continuous screenshots ${traceOptions.screenshots}.\n`);
  page.on('pageerror', error => report.errors.push(error.stack ?? String(error)));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  page.on('requestfailed', request => report.requestFailures.push({url: request.url(), error: request.failure()?.errorText}));
  await context.addInitScript(() => {
    window.__a18CspViolations = [];
    addEventListener('securitypolicyviolation', event => window.__a18CspViolations.push({
      directive: event.effectiveDirective, blocked: event.blockedURI
    }));
  });
  try {
    const response = await page.goto(baseURL);
    assert.equal(response.status(), 200);
    const policy = response.headers()['content-security-policy'] ?? '';
    assert(policy.includes("script-src 'self'") && !policy.includes("'unsafe-eval'"), 'The production CSP must remain active.');
    await waitFor(page, () => window.sharpforge?.getState().metrics != null);
  } catch (error) {
    report.passed = false;
    report.bootstrapFailure = error.stack ?? String(error);
    try {
      report.bootstrapState = await page.evaluate(() => {
        const state = window.sharpforge?.getState();
        return {ready: Boolean(window.sharpforge), metrics: state?.metrics, diagnostics: state?.diagnostics};
      });
    } catch (stateError) { report.bootstrapStateError = stateError.message; }
    try {
      await writeFile(resolve(results, 'browser-designer-bootstrap-failure.json'), JSON.stringify(report, null, 2));
      await context.tracing.stop({path: resolve(results, 'browser-designer-bootstrap-failure.zip')});
    } catch (artifactError) { process.stderr.write(`Bootstrap evidence: ${artifactError.message}\n`); }
    finally { await browser.close(); }
    throw error;
  }
  const check = async (name, action) => {
    const started = performance.now();
    try {
      const evidence = await action();
      report.checks.push({name, passed: true, milliseconds: performance.now() - started, evidence});
      process.stdout.write(`PASS ${name}\n`);
      return evidence;
    } catch (error) {
      report.checks.push({name, passed: false, milliseconds: performance.now() - started, error: error.stack});
      throw error;
    }
  };
  const close = async failure => {
    report.passed = !failure;
    report.artifactErrors = [];
    try {
      report.cspViolations = await page.evaluate(() => window.__a18CspViolations);
      report.screenshot = `screenshots/a18-integrated-${failure ? 'failure' : 'final'}.png`;
      await page.screenshot({path: resolve(results, report.screenshot)});
    } catch (error) { report.artifactErrors.push(error.message); }
    try { await context.tracing.stop({path: resolve(results, 'browser-designer-integrated-trace.zip')}); }
    catch (error) { report.artifactErrors.push(error.message); }
    try { await writeFile(resolve(results, 'browser-designer-integrated-results.json'), JSON.stringify(report, null, 2)); }
    finally { await browser.close(); }
  };
  return {browser, context, page, report, results, check, close};
}
