import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createBenchmarkServer } from './server.js';
import { distribution, environment, schemaVersion, validateOptions } from './common.js';
import { searchMarker } from './fixtures.js';
import { waitForBenchmarkReady } from './browser-ready.js';

export function loadPlaywright() {
  const explicit = process.env.SHARPFORGE_PLAYWRIGHT_MODULE;
  if (explicit) return createRequire(import.meta.url)(resolve(explicit));
  const roots = [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, process.cwd()].filter(Boolean);
  for (const root of roots) {
    try { return createRequire(resolve(root, 'sharpforge-benchmark.cjs'))('playwright'); }
    catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw Object.assign(new Error('Playwright is required for real browser measurements; install the existing browser-test dependency'), {
    code: 'EDITOR_BENCH_BROWSER_UNAVAILABLE'
  });
}

export async function benchmarkEditorBrowser(options = {}) {
  const settings = validateOptions(options);
  const playwright = loadPlaywright();
  const engineName = options.browser ?? 'chromium';
  if (!['chromium', 'firefox', 'webkit'].includes(engineName)) throw new Error('Unsupported browser engine');
  const engine = playwright[engineName];
  const executablePath = options.executablePath ?? process.env[`${engineName.toUpperCase()}_EXECUTABLE`];
  if (!existsSync(executablePath ?? engine.executablePath())) {
    throw Object.assign(new Error(`Missing ${engineName} executable; no browser latency was measured`), { code: 'EDITOR_BENCH_BROWSER_UNAVAILABLE' });
  }
  const server = await createBenchmarkServer();
  let browser;
  try {
    browser = await engine.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    await page.goto(server.url);
    await waitForBenchmarkReady(page, { signal: options.signal });
    const rows = [];
    for (const sizeBytes of settings.sizes) {
      options.onProgress?.(`${engineName} DOM ${sizeBytes} bytes`);
      const setup = await page.evaluate(size => window.editorBenchmark.create(size), sizeBytes);
      for (const operation of ['keystroke', 'paste', 'undo', 'find', 'scroll']) {
        const samples = [];
        let coldMs = 0;
        let evidence;
        for (let index = 0; index < settings.samples + settings.warmups + 1; index++) {
          if (options.signal?.aborted) throw new Error('Editor benchmark cancelled');
          await page.evaluate(name => window.editorBenchmark.prepare(name), operation);
          if (operation === 'keystroke') await page.keyboard.press('x');
          if (operation === 'paste') await page.evaluate(() => window.editorBenchmark.paste());
          if (operation === 'undo') await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
          if (operation === 'find') await page.locator('[aria-label="Find in current file"]').fill(searchMarker);
          if (operation === 'scroll') await page.evaluate(() => window.editorBenchmark.scroll());
          const sample = await page.evaluate(() => window.editorBenchmark.finish());
          evidence = { metrics: sample.metrics, searchBackend: sample.searchBackend, scroll: sample.scroll };
          if (index === 0) coldMs = sample.elapsedMs;
          else if (index > settings.warmups) samples.push(sample.elapsedMs);
        }
        rows.push({ operation: `browser.${operation}ToPaint`, backend: `browser-${engineName}`, sizeBytes, coldMs,
          ...distribution(samples), rawSamplesMs: samples, createToPaintMs: setup.createToPaintMs,
          evidence,
          correctness: { passed: true }, measurement: 'input/keydown/scroll event to two requestAnimationFrame callbacks',
          input: operation === 'paste' ? 'synthetic ClipboardEvent paste through editor handler; clipboard permissions excluded'
            : operation === 'scroll' ? 'DOM scroll event' : 'Playwright browser keyboard input' });
      }
      if (failures.length) throw new Error(`Browser errors: ${failures.join('; ')}`);
    }
    await page.evaluate(() => window.editorBenchmark.dispose());
    return { schemaVersion, kind: 'sharpforge-editor-latency', generatedAt: new Date().toISOString(),
      environment: { ...environment(), browser: engineName, browserVersion: browser.version() }, configuration: settings,
      methodology: 'Real headless browser; event-to-two-RAF upper bound, including frame scheduling; no OS input-to-display or native claim.',
      correctness: { passed: true }, rows, unsupported: ['native-desktop', 'physical-display-present', 'system-clipboard-permission-latency'] };
  } finally {
    await browser?.close();
    await server.close();
  }
}
