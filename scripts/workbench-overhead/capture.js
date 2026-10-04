import {protocol, settingsState, viewport} from './protocol.js';
import {initializeCapture, captureStartup, prepareWorkspace, measureDocuments,
  measureTools, measureCommands, beginInputCapture, captureResult} from './page.js';

async function waitReady(page, predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Studio readiness timed out');
}

async function exercise(page, url, run, records) {
  const response = await page.goto(url, {waitUntil: 'load', timeout: 30000});
  const csp = response?.headers()['content-security-policy'];
  if (!response?.ok() || !csp || csp.includes("'unsafe-eval'")) throw new Error('Production HTTP/CSP precondition failed');
  await waitReady(page, () => Boolean(window.sharpforge?.workbenchShell));
  await page.evaluate(captureStartup, run.enabled);
  await waitReady(page, () => {
    const shell = window.sharpforge.workbenchShell;
    return Boolean(shell.options.state().result) && shell.documents.list().length > 0
      && !shell.services.builds.list().some(build => build.busy);
  });
  await page.evaluate(prepareWorkspace, {records, sourceFiles: protocol.sourceFiles});
  await page.evaluate(measureDocuments, protocol);
  await page.evaluate(measureTools, protocol);
  await page.evaluate(measureCommands, protocol);
  await page.evaluate(beginInputCapture, protocol);
  for (let index = 0; index < protocol.inputs; index++) await page.keyboard.press(protocol.key);
  await page.evaluate(async () => {
    window.__sfInstrumentationCapture.finishInputs();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}

export async function captureRun(browser, url, run, records, errors, timeoutMs) {
  const context = await browser.newContext({viewport, deviceScaleFactor: 1,
    storageState: settingsState(new URL(url).origin, run.enabled)});
  let page, timeout;
  try {
    page = await context.newPage();
    page.on('pageerror', error => errors.push({pair: run.pair, enabled: run.enabled, message: error.message}));
    await page.addInitScript(initializeCapture);
    await Promise.race([
      exercise(page, url, run, records),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Instrumentation run timed out')), timeoutMs); })
    ]);
  } finally {
    clearTimeout(timeout);
    // Preserve completed operations even when a later operation fails. A timed-out page is bounded too.
    let snapshotTimeout;
    try {
      if (!page) throw new Error('Browser page creation did not complete');
      const snapshot = await Promise.race([page.evaluate(captureResult), new Promise((_, reject) => {
        snapshotTimeout = setTimeout(() => reject(new Error('Unable to retrieve partial page capture')), 2000);
      })]);
      Object.assign(run, snapshot);
      for (const violation of run.violations ?? []) errors.push({pair: run.pair, enabled: run.enabled, violation});
    } catch (error) { run.snapshotError = error.message; }
    finally { clearTimeout(snapshotTimeout); await context.close(); }
  }
}
