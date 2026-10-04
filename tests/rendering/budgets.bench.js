import {readFile} from 'node:fs/promises';
import {pathToFileURL, fileURLToPath} from 'node:url';

const comparable = result => ({adapter: result.adapter, browserVersion: result.browserVersion, actualTier: result.actualTier,
  actualBackend: result.actualBackend, fixture: result.fixture, pixelDimensions: result.pixelDimensions, captureMode: result.captureMode});

/** Qualification needs actual finite measurements; regression baselines must identify the same scene and environment. */
export function verifyRenderingBudget(result, limits, baseline = null, {requireBaseline = false} = {}) {
  const failures = [];
  if (result.mockGpu || result.actualBackend !== 'webgpu' || !['hardware', 'software'].includes(result.actualTier)) {
    failures.push('Real WebGPU adapter tier was not identified');
  }
  if (!['rendered', 'passed'].includes(result.status)) failures.push('Fixture rendering or comparison did not pass');
  if (!limits || !Object.keys(limits).length) failures.push('No budget exists for this adapter tier');
  for (const [name, limit] of Object.entries(limits ?? {})) {
    const value = result.metrics?.[name];
    if (!Number.isFinite(limit) || limit < 0) failures.push(name + ' has an invalid budget');
    else if (!Number.isFinite(value) || value < 0) failures.push(name + ' was not measured');
    else if (value > limit) failures.push(`${name} ${value} exceeds ${limit}`);
  }
  if (requireBaseline && !baseline) failures.push('Regression baseline is missing this fixture');
  if (baseline) {
    if (baseline.mockGpu || JSON.stringify(comparable(result)) !== JSON.stringify(comparable(baseline))) {
      failures.push('Regression baseline must match fixture, resolution, adapter, driver, backend and browser');
    } else for (const name of ['cpuMedianMs', 'cpuP95Ms']) {
      const previous = baseline.metrics?.[name], current = result.metrics?.[name];
      if (!Number.isFinite(previous) || previous < 0 || !Number.isFinite(current) || current < 0) {
        failures.push(name + ' has an invalid regression measurement');
      } else if (current > previous * 1.05) failures.push(name + ' exceeds the 5% regression budget');
    }
  }
  return {passed: !failures.length, failures};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new TypeError('Usage: node tests/rendering/budgets.bench.js artifacts/rendering/report.json [baseline.json]');
  const report = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const baseline = process.argv[3] ? JSON.parse(await readFile(process.argv[3], 'utf8')) : null;
  const budgets = JSON.parse(await readFile(fileURLToPath(new URL('./budgets.json', import.meta.url)), 'utf8'));
  const results = report.tests.map(row => {
    const result = {...row, mockGpu: report.mockGpu || row.mockGpu};
    const previous = baseline?.tests.find(entry => entry.id === result.id);
    const reference = previous && {...previous, mockGpu: baseline.mockGpu || previous.mockGpu};
    return {id: result.id, ...verifyRenderingBudget(result,
      budgets[result.actualTier]?.[result.fixture?.benchmark ? 'large' : 'default'], reference, {requireBaseline: !!baseline})};
  });
  process.stdout.write(JSON.stringify({adapter: report.tests[0]?.adapter, results}, null, 2) + '\n');
  process.exitCode = !report.runnerError && results.length && results.every(result => result.passed) ? 0 : 1;
}
