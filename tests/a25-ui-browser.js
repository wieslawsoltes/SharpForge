import { GitWorkerClient } from '@sharpforge/git';
import { renderGitRepository } from '../apps/studio/git-history-view.js';
import { renderGitDiff } from '../apps/studio/git-diff.js';

const status = document.querySelector('#status');
const history = document.querySelector('#history');
const comparison = document.querySelector('#comparison');
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const evidence = { rpc: [], errors: [], longTasks: [], workers: [], progress: [] };
let worker;
let client;
let workbench;
let disposeHistory;
let disposeComparison;
let longTaskObserver;

if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
  longTaskObserver = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) evidence.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
  });
  longTaskObserver.observe({ type: 'longtask', buffered: true });
}

function assert(value, message) { if (!value) throw new Error(message); }

function frameCapture() {
  const intervals = [];
  const started = performance.now();
  let previous;
  let handle;
  const tick = now => {
    if (previous !== undefined) intervals.push(now - previous);
    previous = now;
    handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(handle);
    const sorted = [...intervals].sort((left, right) => left - right);
    const at = quantile => sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? null;
    const elapsed = intervals.reduce((total, value) => total + value, 0);
    return { started, elapsedMs: performance.now() - started, intervalsMs: intervals,
      frameCount: intervals.length, observedFps: elapsed ? intervals.length * 1000 / elapsed : 0,
      p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99), maxMs: sorted.at(-1) ?? null,
      framesOver50Ms: intervals.filter(value => value > 50).length };
  };
}

async function until(predicate, message, timeout = 30000) {
  const deadline = performance.now() + timeout;
  while (!predicate()) {
    assert(!evidence.errors.length, evidence.errors.join('\n'));
    assert(performance.now() < deadline, message);
    await nextFrame();
  }
}

function reportError(error) {
  evidence.errors.push(error?.stack ?? String(error));
  status.textContent = `Failed: ${error.message ?? error}`;
}

function makeWorkbench() {
  return {
    repositoryId: 'graph-fixture', selection: null, historyOnly: true,
    async request(method, params = {}, options = {}) {
      const started = performance.now();
      const result = await client.request(method, { ...params, repositoryId: this.repositoryId }, options);
      const record = { method, elapsedMs: performance.now() - started };
      if (Array.isArray(result)) record.count = result.length;
      if (method === 'log') {
        record.uniqueCommits = new Set(result.map(commit => commit.oid)).size;
        record.first = result[0]?.oid;
        record.last = result.at(-1)?.oid;
        evidence.historyCount = result.length;
      }
      evidence.rpc.push(record);
      return result;
    },
    safe(action) { return Promise.resolve().then(action).catch(reportError); },
    run(action) { return action({}); },
    async refresh() {
      disposeHistory?.();
      disposeHistory = await renderGitRepository(history, this);
    },
    branchDialog() { reportError(new Error('Use the built Studio suite to qualify branch dialogs')); },
    host: {
      showPanel(id) {
        if (id !== 'git-diff') throw new Error(`The history fixture cannot open ${id}`);
        workbench.safe(async () => {
          disposeComparison?.();
          disposeComparison = await renderGitDiff(comparison, workbench);
        });
      }
    }
  };
}

async function runGraph({ count = 10000 } = {}) {
  assert(!worker, 'Dispose the previous graph fixture before starting another');
  assert(Number.isSafeInteger(count) && count >= 32 && count <= 10000, 'History count must be 32..10000');
  status.textContent = `Generating ${count} real commit objects in a worker`;
  const workerUrl = new URL('./a25-ui-browser-worker.js', import.meta.url);
  worker = new Worker(workerUrl, { type: 'module' });
  evidence.workers.push(workerUrl.href);
  client = new GitWorkerClient(worker);
  workbench = makeWorkbench();
  const opened = await workbench.request('init', { backend: 'memory', algorithm: 'sha1', defaultBranch: 'main' });
  assert(opened.backend === 'memory', 'The graph fixture must report its actual memory backend');
  const stopSeedFrames = frameCapture();
  let seeded;
  try {
    seeded = await workbench.request('fixture.seedHistory', { count }, { onProgress: progress => {
      evidence.progress.push(progress);
      status.textContent = `Generating commit ${progress.completed} of ${progress.total} in a worker`;
    } });
  } finally { evidence.seedFrames = stopSeedFrames(); }
  assert(seeded.generatedInWorker && seeded.count === count, 'Graph seed did not run in an actual worker');
  status.textContent = `Rendering ${count} verified commits`;
  const stopRenderFrames = frameCapture();
  const started = performance.now();
  try {
    disposeHistory = await renderGitRepository(history, workbench);
    await nextFrame();
    await nextFrame();
  } finally { evidence.mountFrames = stopRenderFrames(); }
  const log = evidence.rpc.find(record => record.method === 'log');
  assert(log?.count === count && log.uniqueCommits === count, 'Production log did not return every seeded commit exactly once');
  assert(log.first === seeded.head && log.last === seeded.first, 'Production history tips differ from the generated object graph');
  const viewport = history.querySelector('.git-history-viewport');
  assert(viewport?.clientHeight > 100, 'The production history viewport has no usable height');
  assert(history.querySelectorAll('.git-history-row').length > 0, 'History did not render any commit rows');
  evidence.seeded = seeded;
  evidence.mountMs = performance.now() - started;
  status.textContent = `Ready: ${count} verified commits from a real worker`;
  return { seeded, log, mountMs: evidence.mountMs, seedFrames: evidence.seedFrames, mountFrames: evidence.mountFrames,
    viewport: inspect().viewport };
}

async function scrollGraph({ steps = 120 } = {}) {
  assert(workbench && evidence.seeded, 'Initialize the graph fixture first');
  assert(Number.isSafeInteger(steps) && steps >= 60 && steps <= 1200, 'Scroll steps must be 60..1200');
  const viewport = history.querySelector('.git-history-viewport');
  const maximum = viewport.scrollHeight - viewport.clientHeight;
  assert(maximum > viewport.clientHeight, 'The fixture has no scrolling history');
  const rowCounts = [];
  const scrollPositions = [];
  const started = performance.now();
  const stopFrames = frameCapture();
  try {
    for (let position = 0; position < steps; position++) {
      viewport.scrollTop = maximum * position / (steps - 1);
      await nextFrame();
      await nextFrame();
      rowCounts.push(history.querySelectorAll('.git-history-row').length);
      scrollPositions.push(viewport.scrollTop);
    }
  } finally { evidence.scrollFrames = stopFrames(); }
  const finished = performance.now();
  const frames = evidence.scrollFrames;
  const maximumRows = Math.max(...rowCounts);
  assert(Math.min(...rowCounts) > 0, 'Virtualized scrolling exposed an empty viewport');
  assert(maximumRows <= Math.ceil(viewport.clientHeight / 30) + 10, 'Virtualized history mounted excessive DOM rows');
  assert(scrollPositions.at(-1) >= maximum - 1, 'Scroll did not reach the oldest commit');
  const target = { fps: 60, frameMs: 1000 / 60, timestampToleranceMs: 1, minimumObservedFps: 59 };
  const meetsTarget = frames.frameCount >= 100 && frames.observedFps >= target.minimumObservedFps
    && frames.p95Ms <= target.frameMs + target.timestampToleranceMs;
  evidence.scroll = { steps, frames, rowCounts, scrollPositions, maximumRows, target, meetsTarget,
    longTasks: evidence.longTasks.filter(entry => entry.startTime >= started && entry.startTime <= finished) };
  status.textContent = `Measured ${frames.observedFps.toFixed(2)} fps; p95 ${frames.p95Ms?.toFixed(2)} ms; ${maximumRows} live rows`;
  return evidence.scroll;
}

async function selectRoot() {
  const viewport = history.querySelector('.git-history-viewport');
  assert(viewport, 'History has not been rendered');
  viewport.scrollTop = viewport.scrollHeight;
  await nextFrame();
  await nextFrame();
  const oldest = [...history.querySelectorAll('.git-history-row')].find(row => row.textContent.includes('Graph fixture commit 00000'));
  assert(oldest, 'The oldest commit is not visible after scrolling');
  oldest.click();
  await until(() => [...history.querySelectorAll('.git-commit-detail .git-path')].some(button => button.textContent.includes('Program.cs')),
    'Selecting the root commit did not expose its real changed file');
  history.querySelector('.git-commit-detail .git-path').click();
  await until(() => comparison.querySelector('.git-diff-row')?.textContent.includes('class Program'),
    'Opening the selected commit did not show its real blob diff');
  const result = { selectedOid: workbench.selection?.commit,
    changedFiles: [...history.querySelectorAll('.git-commit-detail .git-path')].map(button => button.textContent),
    renderedDiff: comparison.querySelector('.git-diff-row').textContent };
  assert(result.selectedOid === evidence.seeded.first, 'Displayed root diff belongs to a different commit');
  return result;
}

function inspect() {
  const viewport = history.querySelector('.git-history-viewport');
  return { historyCount: evidence.historyCount, rpc: evidence.rpc, errors: evidence.errors,
    viewport: viewport ? { height: viewport.clientHeight, scrollHeight: viewport.scrollHeight, scrollTop: viewport.scrollTop,
      liveRows: history.querySelectorAll('.git-history-row').length } : null,
    detail: history.querySelector('.git-commit-detail')?.textContent ?? '',
    visibleMessages: [...history.querySelectorAll('.git-history-message')].map(element => element.textContent) };
}

async function dispose() {
  disposeHistory?.();
  disposeComparison?.();
  longTaskObserver?.disconnect();
  try { await client?.dispose(); }
  finally { worker?.terminate(); worker = null; client = null; workbench = null; }
  status.textContent = 'Disposed';
}

window.gitUiAcceptance = { runGraph, scrollGraph, selectRoot, inspect, dispose };
status.textContent = 'Ready';
