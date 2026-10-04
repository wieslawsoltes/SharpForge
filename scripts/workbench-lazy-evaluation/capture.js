import {settingsState, viewport} from '../workbench-overhead/protocol.js';
import {deferredModules, entryDurations, pagePath, protocol, requireEntryPolicy} from './protocol.js';
import {connectOrigins} from '../conformance/security/csp.js';

function timeoutError() { return new Error('Lazy-evaluation capture exceeded its deadline (maximum 60 seconds)'); }
function recordError(run, error) {
  if (run.errors.length < 128) run.errors.push(error);
  else run.droppedErrorCount = (run.droppedErrorCount ?? 0) + 1;
}

/** Unsupported CDP clocks fail explicitly; never silently substitute elapsed wall time for thread time. */
export async function enableThreadMetrics(session) {
  try { await session.send('Performance.enable', {timeDomain: protocol.timeDomain}); }
  catch (cause) { throw new Error('Chromium threadTicks Performance metrics are unavailable', {cause}); }
}

async function closeProcess(server) {
  if (!server) return;
  let timer;
  try {
    await Promise.race([server.close(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Chromium close timed out')), 2000);
    })]);
  } catch {
    // BrowserServer.kill owns the browser process tree, including renderer/worker children.
    clearTimeout(timer);
    const killed = server.kill();
    await Promise.race([killed, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Chromium force-close timed out; no further captures will run')), 2000);
    })]);
  } finally { clearTimeout(timer); }
}

async function measure(browser, url, run, deadline) {
  const remaining = () => {
    const value = deadline - Date.now();
    if (value <= 0) throw timeoutError();
    return value;
  };
  const context = await browser.newContext({viewport, deviceScaleFactor: 1,
    storageState: settingsState(new URL(url).origin, true), serviceWorkers: 'block'});
  const page = await context.newPage();
  page.on('pageerror', error => recordError(run, {type: 'pageerror', message: error.message}));
  page.on('console', message => {
    if (message.type() === 'error') recordError(run, {type: 'console', message: message.text()});
  });
  page.on('request', request => {
    if (run.requests.length >= 30000) {
      if (!run.requestLimitExceeded) recordError(run, {type: 'request-limit', message: 'Request capture limit exceeded'});
      run.requestLimitExceeded = true;
      return;
    }
    run.requests.push(request.url());
  });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL(url).origin) return route.continue();
    recordError(run, {type: 'external-request', url: route.request().url()});
    return route.abort('blockedbyclient');
  });
  const session = await context.newCDPSession(page);
  await enableThreadMetrics(session);
  run.timeDomain = protocol.timeDomain;
  run.baselineMetrics = (await session.send('Performance.getMetrics')).metrics;
  let acceptMarker;
  const marker = new Promise(resolve => { acceptMarker = resolve; });
  session.on('Performance.metrics', event => {
    if (run.metricEvents.length >= 32) {
      if (!run.metricLimitExceeded) recordError(run, {type: 'metrics-limit', message: 'CDP metric event limit exceeded'});
      run.metricLimitExceeded = true;
      return;
    }
    run.metricEvents.push(event);
    if (event.title === protocol.marker) {
      run.entryRequests = [...run.requests];
      acceptMarker(event);
    }
  });
  const navigation = await page.goto(new URL(pagePath(run.variant), url).href,
    {waitUntil: 'commit', timeout: remaining()});
  const csp = navigation?.headers()['content-security-policy'];
  if (!navigation?.ok()) throw new Error('Entry response failed');
  requireEntryPolicy(csp, connectOrigins(process.env.SHARPFORGE_CONNECT_ORIGINS));
  run.entryEvent = await marker;
  Object.assign(run, entryDurations(run.baselineMetrics, run.entryEvent));
  // The metric was already captured synchronously at the wrapper marker. This check cannot extend its timed span.
  run.productReady = await page.evaluate(() => Boolean(window.sharpforge?.workbenchShell));
  run.deferredRequests = deferredModules.filter(path => run.entryRequests.some(value => new URL(value).pathname === '/' + path));
  run.completed = true;
  await session.detach();
}

/** One fresh browser process/profile per sample, closed before another sample starts. No warm-up or retries. */
export async function captureEvaluation(engine, url, run, {executablePath, timeoutMs = protocol.captureTimeoutMs} = {}) {
  // Reserve four seconds within the total capture limit for graceful/forced process cleanup.
  const deadline = Date.now() + timeoutMs - 4000;
  if (timeoutMs <= 4000) throw timeoutError();
  let server, timer;
  run.errors = [];
  run.requests = [];
  run.metricEvents = [];
  try {
    server = await engine.launchServer({headless: true, timeout: Math.min(15000, deadline - Date.now()),
      ...(executablePath ? {executablePath} : {})});
    const work = async () => {
      const browser = await engine.connect(server.wsEndpoint(), {timeout: Math.max(1, deadline - Date.now())});
      run.browserVersion = browser.version();
      await measure(browser, url, run, deadline);
    };
    await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutError()), Math.max(1, deadline - Date.now()));
    })]);
  } finally {
    clearTimeout(timer);
    await closeProcess(server);
  }
}
