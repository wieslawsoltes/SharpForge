import {Session} from 'node:inspector';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {CSharpDesignSession, probeDesignSource} from '@sharpforge/designer';

// CPU attribution only. Keep the acceptance benchmark unchanged and run this through scripts/limited.js.
const [destination, sampleCount = '512'] = process.argv.slice(2);
const iterations = Number(sampleCount);
if (!destination || !Number.isInteger(iterations) || iterations < 50 || iterations > 2000) {
  throw new RangeError('Usage: node tests/a18-session-probe-profile.js <profile.cpuprofile> [50..2000 iterations]');
}
const outputPath = resolve(destination);
const members = Array.from({length: 1992}, (_, index) => `    static int value${index} = ${index};`).join('\n');
const source = `class View\n{\n${members}\n    static Window Create()\n    {\n        var window = new Window();\n        return window;\n    }\n}`;
const expectedStart = source.indexOf('static Window Create');
const expectedEnd = source.lastIndexOf('    }') + 5;

function probe() {
  const result = probeDesignSource(source, 'View.cs');
  if (!result.compatible || result.methodName !== 'Create' || result.span.start !== expectedStart || result.span.end !== expectedEnd) {
    throw new Error('The production compatibility probe did not retain the fixture method and its exact span.');
  }
}

function summarize(profile) {
  const records = new Map(profile.nodes.map(node => [node.id, {node, self: 0, total: 0}]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  for (let index = 0; index < profile.samples.length; index++) {
    const duration = (profile.timeDeltas[index] ?? 0) / 1000;
    let id = profile.samples[index];
    records.get(id).self += duration;
    while (id !== undefined) {
      records.get(id).total += duration;
      id = parents.get(id);
    }
  }
  const format = ({node, self, total}) => ({
    name: node.callFrame.functionName || '(anonymous)',
    url: node.callFrame.url,
    line: node.callFrame.lineNumber + 1,
    selfMs: Number(self.toFixed(3)),
    inclusiveMs: Number(total.toFixed(3))
  });
  return [...records.values()].sort((left, right) => right.self - left.self).slice(0, 25).map(format);
}

// Match the original benchmark's heap/JIT history: 10 warmups plus 50 full sessions, then 10 probe warmups.
for (let iteration = 0; iteration < 60; iteration++) new CSharpDesignSession(source, {uri: 'View.cs'});
for (let iteration = 0; iteration < 10; iteration++) probe();
const timings = new Float64Array(iterations);
const session = new Session();
const post = (method, parameters = {}) => new Promise((resolvePost, rejectPost) => {
  session.post(method, parameters, (error, result) => error ? rejectPost(error) : resolvePost(result));
});
let profile;
session.connect();
try {
  await post('Profiler.enable');
  await post('Profiler.setSamplingInterval', {interval: 250});
  await post('Profiler.start');
  try {
    for (let iteration = 0; iteration < iterations; iteration++) {
      const start = performance.now();
      probe();
      timings[iteration] = performance.now() - start;
    }
  } finally {
    ({profile} = await post('Profiler.stop'));
  }
} finally {
  session.disconnect();
}

const serialized = JSON.stringify(profile);
await mkdir(dirname(outputPath), {recursive: true});
await writeFile(outputPath, serialized);
timings.sort();
console.log(JSON.stringify({
  purpose: 'CPU attribution; profiler timings do not replace the uninstrumented acceptance benchmark',
  runtime: process.version,
  platform: `${process.platform}/${process.arch}`,
  lines: source.split('\n').length,
  characters: source.length,
  priming: {fullDesignSessions: 60, probeWarmups: 10},
  iterations,
  samplingIntervalMicroseconds: 250,
  profiledTimings: {
    medianMs: timings[Math.floor(iterations / 2)],
    p95Ms: timings[Math.ceil(iterations * 0.95) - 1]
  },
  profile: {path: outputPath, bytes: Buffer.byteLength(serialized), sha256: createHash('sha256').update(serialized).digest('hex')},
  hottestSelfTime: summarize(profile)
}, null, 2));
