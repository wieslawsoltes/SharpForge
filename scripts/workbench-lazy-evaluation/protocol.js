import {sha256} from '../conformance/build-identity.js';

export const protocol = Object.freeze({id: 'studio-lazy-evaluation-v1', pairs: 12, timeDomain: 'threadTicks',
  captureTimeoutMs: 60000, totalTimeoutMs: 900000, marker: 'SharpForge.entry.evaluated'});
export const deferredModules = Object.freeze([
  'designer-tools.js', 'assembly-workbench.js', 'disassembly-tool.js', 'msbuild-tools.js', 'project-wizard.js'
]);
export const variants = Object.freeze(['lazy', 'eager']);
export const entryPath = variant => `/_sf-${variant}-entry.js`;
export const pagePath = variant => `/_sf-${variant}.html`;
export const pairOrder = pair => pair % 2 === 0 ? variants : [...variants].reverse();

/** Identical entry scaffolding; only the eager counterfactual imports the five deferred module graphs. */
export function entryModule(variant) {
  if (!variants.includes(variant)) throw new Error('Unknown lazy-evaluation variant');
  const imports = variant === 'eager' ? deferredModules : [];
  return [...imports, 'studio.js'].map(path => `import './${path}';`).join('\n')
    + `\nconsole.timeStamp('${protocol.marker}');\n`;
}

/** Replace the single shipped entry, preserving all other HTML and the production CSP. */
export function overlayAssets(html) {
  const entry = '<script type="module" src="./studio.js"></script>';
  if (html.split(entry).length !== 2 || [...html.matchAll(/<script\b/gi)].length !== 1) {
    throw new Error('Expected the single production Studio module entry');
  }
  return variants.flatMap(variant => [
    {path: pagePath(variant), type: 'text/html; charset=utf-8',
      body: html.replace(entry, `<script type="module" src=".${entryPath(variant)}"></script>`)},
    {path: entryPath(variant), type: 'text/javascript; charset=utf-8', body: entryModule(variant)}
  ]).map(asset => ({...asset, bytes: Buffer.byteLength(asset.body), sha256: sha256(asset.body)}));
}

/** CDP values are cumulative seconds; retain the complete vector and reject duplicate/invalid fields. */
export function metricValues(metrics) {
  if (!Array.isArray(metrics) || !metrics.length || metrics.length > 256) throw new Error('Missing or oversized CDP metrics');
  const values = new Map();
  for (const metric of metrics) {
    if (typeof metric.name !== 'string' || values.has(metric.name) || !Number.isFinite(metric.value) || metric.value < 0) {
      throw new Error('Invalid CDP metric');
    }
    values.set(metric.name, metric.value);
  }
  for (const name of ['ScriptDuration', 'V8CompileDuration', 'Timestamp']) {
    if (!values.has(name)) throw new Error('Missing CDP metric: ' + name);
  }
  return values;
}

export function entryDurations(baseline, event) {
  if (event?.title !== protocol.marker) throw new Error('Missing exact entry marker/title');
  const before = metricValues(baseline), after = metricValues(event.metrics);
  const delta = name => (after.get(name) - before.get(name)) * 1000;
  const scriptDurationMs = delta('ScriptDuration'), compileDurationMs = delta('V8CompileDuration');
  if (![scriptDurationMs, compileDurationMs, delta('Timestamp')].every(value => Number.isFinite(value)
    && value >= 0 && value <= protocol.captureTimeoutMs) || !(scriptDurationMs > 0) || delta('Timestamp') <= 0) {
    throw new Error('Invalid cumulative entry metric delta');
  }
  return {scriptDurationMs, compileDurationMs};
}
