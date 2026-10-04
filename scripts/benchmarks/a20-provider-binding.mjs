import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {cpus, totalmem, loadavg} from 'node:os';
import {performance} from 'node:perf_hooks';
import {getHeapStatistics} from 'node:v8';
import {compile, Compilation, SourceSemanticModel} from '@sharpforge/compiler';
import {parse} from '@sharpforge/syntax';
import {SourceText} from '@sharpforge/text';

const options = Object.freeze({outputKind: 'library', pipeline: 'bound'});
const hash = value => createHash('sha256').update(value).digest('hex');
const queryPhases = Object.freeze({'signature-first-query': 1, 'signature-repeated-query': 64, 'compiled-model-first-query': 1});
const caseNames = Object.freeze({instance: 'instance-overloads', generic: 'constructed-generic-receiver',
  local: 'local-functions', incomplete: 'incomplete-instance-call'});

function argumentsOf(values) {
  const result = {calls: 96, samples: 15, warmups: 5, case: null, output: null};
  const ranges = {calls: [2, 1024], samples: [9, 101], warmups: [3, 50]};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index]?.replace(/^--/, '');
    const value = values[index + 1];
    if (name === 'output' && value) result.output = value;
    else if (name === 'case') {
      if (!Object.values(caseNames).includes(value)) throw new RangeError(`Invalid --case; expected ${Object.values(caseNames).join(', ')}`);
      result.case = value;
    } else if (ranges[name] && /^\d+$/.test(value ?? '')) {
      result[name] = Number(value);
      if (result[name] < ranges[name][0] || result[name] > ranges[name][1]) throw new RangeError(`Invalid --${name}`);
    } else throw new Error('Usage: a20-provider-binding.mjs [--case name] [--calls N] [--samples N] [--warmups N] [--output file]');
  }
  return result;
}

function fixtures(count) {
  const receiver = 'class Receiver { public int F(int value){return value+1;} public int F(string value){return 0;} }\n';
  const start = receiver + 'class Calls { public int Run(){Receiver receiver=new Receiver();int total=0;\n';
  const instanceCalls = Array.from({length: count}, (_, index) => `total+=receiver.F(${index % 17});\n`).join('');
  const genericCalls = Array.from({length: count}, (_, index) =>
    `total+=receiver.Echo(${index % 17});total+=receiver.Identity<int>(${index % 17});\n`).join('');
  const localCalls = Array.from({length: count}, (_, index) => `total+=Next(${index % 17});\n`).join('');
  const rows = [
    {name: caseNames.instance, text: start + instanceCalls + 'return total;}}', invocationSites: count, probe: 'receiver.F('},
    {name: caseNames.generic, text:
      'class Receiver<T>{public T Echo(T value){return value;}public U Identity<U>(U value){return value;}}\n' +
      'class Calls{public int Run(){Receiver<int> receiver=new Receiver<int>();int total=0;\n' + genericCalls + 'return total;}}',
    invocationSites: count * 2, probe: 'receiver.Echo('},
    {name: caseNames.local, text:
      'class Calls{public static int Run(){int Next(int value){return value+1;}int total=0;\n' + localCalls + 'return total;}}',
    invocationSites: count, probe: 'Next('},
    {name: caseNames.incomplete, text: start + instanceCalls + 'total+=receiver.F(', invocationSites: count + 1,
      probe: 'receiver.F(', incomplete: true}
  ];
  return rows.map(row => {
    const probeStart = row.text.lastIndexOf(row.probe);
    const callStart = probeStart + row.probe.length - 1;
    return {...row, uri: row.name + '.cs', sha256: hash(row.text), utf16Length: row.text.length,
      utf8Bytes: Buffer.byteLength(row.text), probeOffset: probeStart + row.probe.lastIndexOf('.') + 1,
      callStart, queryOffset: callStart + 1, signatureName: row.probe.slice(row.probe.lastIndexOf('.') + 1, -1)};
  });
}

function summarize(values) {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return {median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1], minimum: sorted[0], maximum: sorted.at(-1)};
}

function prepare(fixture, phase) {
  if (phase === 'compile') return {execute: () => compile([{uri: fixture.uri, text: fixture.text}], options)};
  // Fresh syntax and Compilation preparation are excluded from source-model binding time and retained-heap deltas.
  const source = new SourceText(fixture.text, fixture.uri);
  const compilation = new Compilation([parse(source)], options);
  if (phase === 'source-model-bind') return {execute: () => compilation.getSourceModel()};
  if (phase === 'compiled-model-first-query') compilation.build();
  const model = compilation.getSourceModel();
  const queryOptions = {callStart: fixture.callStart};
  const queryCount = queryPhases[phase];
  if (phase === 'signature-repeated-query') model.signatureHelp(fixture.uri, fixture.queryOffset, queryOptions);
  return {model, execute: () => {
    let result;
    for (let index = 0; index < queryCount; index++) result = model.signatureHelp(fixture.uri, fixture.queryOffset, queryOptions);
    return result;
  }};
}

function observe(result, fixture, phase) {
  if (phase === 'compile') {
    const diagnostics = result.diagnostics.map(item => [item.code, item.severity, item.start, item.end ?? item.length]);
    if (fixture.incomplete && !diagnostics.some(item => item[1] === 'error')) {
      throw new Error('Incomplete source unexpectedly produced no compilation error');
    }
    return {success: result.success, diagnostics, symbolCount: result.symbols.length,
      methodCount: result.image?.methods.length ?? 0,
      instructionWords: result.image?.methods.reduce((total, method) => total + method.code.length, 0) ?? 0};
  }
  const symbols = result.documentSymbols(fixture.uri);
  if (!symbols.some(symbol => symbol.name === 'Calls')) throw new Error('Source-model benchmark did not bind the Calls type');
  const target = result.symbolAt(fixture.uri, fixture.probeOffset);
  return {declarations: symbols.map(symbol => [symbol.kind, symbol.name, symbol.start, symbol.end]),
    probe: target ? [target.kind, target.name, target.uri] : null};
}

function observeSignature(result, model, fixture) {
  if (!result?.signatures?.some(signature => signature.label.includes(fixture.signatureName + '('))) {
    throw new Error(`Signature query did not resolve ${fixture.name}/${fixture.signatureName}`);
  }
  return {binding: observe(model, fixture, 'source-model-bind'), signature: result};
}

function sample(fixture, phase) {
  const prepared = prepare(fixture, phase);
  globalThis.gc();
  const before = process.memoryUsage();
  const started = performance.now();
  const retained = prepared.execute();
  const elapsedMs = performance.now() - started;
  const uncollected = process.memoryUsage();
  globalThis.gc();
  const collected = process.memoryUsage();
  // Observations keep both the returned result and, for a query, the prepared model alive during heap measurements.
  const evidence = prepared.model ? observeSignature(retained, prepared.model, fixture) : observe(retained, fixture, phase);
  return {elapsedMs, uncollectedHeapDeltaBytes: uncollected.heapUsed - before.heapUsed,
    ...(queryPhases[phase] ? {elapsedPerQueryMs: elapsedMs / queryPhases[phase]} : {}),
    retainedHeapDeltaBytes: collected.heapUsed - before.heapUsed,
    retainedArrayBufferDeltaBytes: collected.arrayBuffers - before.arrayBuffers,
    retainedExternalDeltaBytes: collected.external - before.external,
    rssAfterBytes: collected.rss, evidence};
}

function measure(fixture, phase, settings) {
  const queryCount = queryPhases[phase];
  if (queryCount && typeof SourceSemanticModel.prototype.signatureHelp !== 'function') {
    return {phase, queryCount, available: false, reason: 'This revision has no public SourceSemanticModel.signatureHelp API.'};
  }
  for (let index = 0; index < settings.warmups; index++) sample(fixture, phase);
  const samples = Array.from({length: settings.samples}, () => sample(fixture, phase));
  const evidenceJson = JSON.stringify(samples[0].evidence);
  if (samples.some(row => JSON.stringify(row.evidence) !== evidenceJson)) throw new Error(`Unstable output for ${fixture.name}/${phase}`);
  const metrics = ['elapsedMs', 'uncollectedHeapDeltaBytes', 'retainedHeapDeltaBytes',
    'retainedArrayBufferDeltaBytes', 'retainedExternalDeltaBytes', 'rssAfterBytes'];
  if (queryCount) metrics.push('elapsedPerQueryMs');
  return {phase, available: true, ...(queryCount ? {queryCount} : {}),
    metrics: Object.fromEntries(metrics.map(name => [name, summarize(samples.map(row => row[name]))])),
    evidence: samples[0].evidence, evidenceSha256: hash(evidenceJson),
    samples: samples.map(({evidence, ...measurements}) => measurements)};
}

function main() {
  if (typeof globalThis.gc !== 'function') throw new Error('Heap measurements require node --expose-gc');
  const settings = argumentsOf(process.argv.slice(2));
  const exportInfo = JSON.parse(readFileSync(new URL('./a20-provider-binding-export.json', import.meta.url), 'utf8'));
  const scriptSha256 = hash(readFileSync(new URL(import.meta.url)));
  if (scriptSha256 !== exportInfo.benchmarkSha256) throw new Error('Benchmark source changed after the commit export was prepared');
  const startedAt = new Date().toISOString();
  const initialLoadAverage = loadavg();
  const corpus = fixtures(settings.calls).filter(fixture => settings.case === null || fixture.name === settings.case);
  const cases = corpus.map(fixture => ({name: fixture.name, sourceSha256: fixture.sha256,
    utf16Length: fixture.utf16Length, utf8Bytes: fixture.utf8Bytes, syntacticInvocationSites: fixture.invocationSites,
    phases: ['compile', 'source-model-bind'].map(phase => measure(fixture, phase, settings))}));
  // Run common phases first, so candidate-only query work cannot prime later compile/bind families.
  for (let index = 0; index < corpus.length; index++) {
    for (const phase of Object.keys(queryPhases)) cases[index].phases.push(measure(corpus[index], phase, settings));
  }
  const report = {schemaVersion: 2, benchmark: 'SF-A20-T14-bound-invocations', revision: exportInfo.revision,
    benchmarkSha256: scriptSha256, packages: exportInfo.packages, startedAt, completedAt: new Date().toISOString(),
    settings: {calls: settings.calls, samples: settings.samples, warmups: settings.warmups, case: settings.case,
      compilerOptions: options, queryPhases},
    environment: {node: process.version, v8: process.versions.v8, platform: process.platform, architecture: process.arch,
      cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem(), execArgv: process.execArgv,
      nodeOptions: process.env.NODE_OPTIONS ?? '', heapSizeLimitBytes: getHeapStatistics().heap_size_limit,
      initialLoadAverage, finalLoadAverage: loadavg()},
    notes: ['Timing excludes import/startup, explicit GC, observations, serialization and phase-specific preparation.',
      'Compile measures public compile including parsing, execution-profile binding/emission and any semantic fallback.',
      'Source-model-bind measures public Compilation.getSourceModel on fresh parsed input, including binding and eager indexes.',
      'Signature-first-query uses a freshly bound model; its timing and retained heap include any deferred document-index construction.',
      'Signature-repeated-query primes that model once outside timing, then measures 64 queries; per-query time divides the total by 64.',
      'Compiled-model-first-query builds and prepares the model before timing, then includes any capture needed by its first signature query.',
      'Query heap baselines already retain the bound model; post-GC query deltas retain that model and the last signature result.',
      'A revision without the signature API reports those phases unavailable; candidate-only results are not before/after comparisons.',
      'Retained heap is the post-GC live result delta; uncollected heap is a GC-dependent proxy, not total allocated bytes.',
      'Heap deltas can be negative. No allocation-count, allocation-rate, noise-free or statistical-significance claim is made.',
      'Valid source may be outside the executable profile; exact compiler results are retained and must match before/after.'], cases};
  const json = JSON.stringify(report, null, 2) + '\n';
  if (settings.output) writeFileSync(settings.output, json, {flag: 'wx'});
  else process.stdout.write(json);
}

main();
