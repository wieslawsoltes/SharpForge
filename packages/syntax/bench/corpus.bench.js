/**
 * Parse-speed comparison over the repository's C# sources (examples and templates, repeated eight times: about 600 KB).
 *
 *   node --expose-gc packages/syntax/bench/corpus.bench.js [root]
 *
 * `root` is a checkout whose packages/syntax and packages/text are measured (default: this one), so two commits can be
 * compared on the same corpus: export the other commit with `git archive <commit> packages/syntax packages/text`.
 * Prints the median and 95th percentile of 40 runs after 5 warm-up runs, and the heap retained by one result.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const root = resolve(process.argv[2] ?? repository);
const skippedDirectories = new Set(['node_modules', '.git', 'bin', 'obj']);

function sourceFiles(directory, found = []) {
  for (const entry of readdirSync(directory).sort()) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (!skippedDirectories.has(entry)) sourceFiles(path, found);
    } else if (entry.endsWith('.cs')) found.push(path);
  }
  return found;
}

function measure(name, kilobytes, run, runs = 40) {
  for (let warmup = 0; warmup < 5; warmup++) run();
  const times = [];
  for (let index = 0; index < runs; index++) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[times.length >> 1];
  const p95 = times[Math.floor(times.length * 0.95)];
  let retainedText = 'n/a (run with --expose-gc)';
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
    const before = process.memoryUsage().heapUsed;
    const result = run();
    globalThis.gc();
    retainedText = ((process.memoryUsage().heapUsed - before) / 1_048_576).toFixed(1) + ' MB';
    if (!result) throw new Error('the benchmark body must return its result');
  }
  const perKilobyte = (median / kilobytes).toFixed(4);
  console.log(`${name.padEnd(36)} median ${median.toFixed(1)} ms  p95 ${p95.toFixed(1)} ms  ${perKilobyte} ms/KB  retained ${retainedText}`);
}

const load = path => import(pathToFileURL(join(root, path)).href);
const { parse, SyntaxTree } = await load('packages/syntax/src/index.js');
const { SourceText } = await load('packages/text/src/index.js');
const files = [...sourceFiles(join(repository, 'examples')), ...sourceFiles(join(repository, 'packages/templates'))];
const text = Array(8).fill(files.map(file => readFileSync(file, 'utf8')).join('\n')).join('\n');
const kilobytes = text.length / 1024;

console.log(`${root}: ${files.length} files x 8, ${text.length} characters, ${process.version} on ${process.platform} ${process.arch}`);
measure('parse() with the legacy AST', kilobytes, () => parse(new SourceText(text)));
measure('SyntaxTree.parseText (lossless)', kilobytes, () => SyntaxTree.parseText(text));
const oracle = join(repository, 'tests/support/legacy-syntax/parser.js');
if (root === repository && existsSync(oracle)) {
  const legacy = await import(pathToFileURL(oracle).href);
  measure('pre-refactor parser (test oracle)', kilobytes, () => legacy.parse(new SourceText(text)));
}
