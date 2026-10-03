/**
 * Incremental parse benchmark: keystroke edits on a million-character document.
 *   node packages/syntax/bench/incremental.bench.js            prints the measurements
 *   node packages/syntax/bench/incremental.bench.js --update   rewrites incremental.baseline.json
 *   node --expose-gc packages/syntax/bench/incremental.bench.js --check
 *       fails when a keystroke costs 5 percent or more of a full parse
 * Times are medians in milliseconds; heap figures need --expose-gc and are reported as null without it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SyntaxTree } from '../src/index.js';
const baselinePath = fileURLToPath(new URL('./incremental.baseline.json', import.meta.url));
/** A deterministic document of at least `size` characters: classes of methods with locals, loops, strings and comments. */
export function benchmarkDocument(size = 1_000_000) {
  const parts = ['using System;\nusing System.Collections.Generic;\n\nnamespace Bench\n{\n']; let length = parts[0].length;
  for (let type = 0; length < size; type++) {
    const lines = [`    /// <summary>Type ${type}.</summary>\n    public class Service${type} : Base, IDisposable\n    {\n        private readonly List<int> items = new List<int>();\n        public int Count { get; private set; }\n`];
    for (let method = 0; method < 40; method++) lines.push(`        public int Method${method}(int a, string name)\n        {\n            var total = a * ${method} + items.Count; // running total\n            for (int i = 0; i < a; i++) { if (i % 2 == 0 && name != null) total += i; else total -= ${type}; }\n`
      + `            var label = $"{name}:{total:D4}";\n            return label.Length > ${method} ? total : Count;\n        }\n\n`);
    lines.push('    }\n\n'); const text = lines.join(''); parts.push(text); length += text.length;
  }
  parts.push('}\n'); return parts.join('');
}
const median = values => [...values].sort((a, b) => a - b)[values.length >> 1];
const heap = () => { if (typeof globalThis.gc !== 'function') return null; globalThis.gc(); return process.memoryUsage().heapUsed; };
export function measure({ size = 1_000_000, keystrokes = 60 } = {}) {
  const text = benchmarkDocument(size), before = heap(), fullTimes = []; let tree;
  for (let run = 0; run < 5; run++) { const start = performance.now(); tree = SyntaxTree.parseText(text); fullTimes.push(performance.now() - start); }
  const afterFull = heap(), fullMs = median(fullTimes);
  // Keystrokes typed one after another inside a statement in the middle of the document, then at scattered positions.
  const typed = [], scattered = [], anchor = text.indexOf('var total', text.length >> 1) + 4; let current = tree, reused = 0;
  for (let k = 0; k < keystrokes; k++) { const start = performance.now(); current = current.withChangedText([{ start: anchor + k, length: 0, text: 'x' }]); typed.push(performance.now() - start); reused = current.reusedNodeCount; }
  const afterTyping = heap();
  for (let k = 0; k < keystrokes; k++) {
    const at = current.source.text.indexOf('total', Math.floor(current.source.length * ((k * 37 % keystrokes) + 0.5) / keystrokes)), start = performance.now();
    current = current.withChangedText([{ start: at, length: 0, text: 'y' }]); scattered.push(performance.now() - start);
  }
  if (current.toFullString() !== current.source.text) throw new Error('round-trip failed');
  const keystrokeMs = median(typed), scatteredMs = median(scattered), round = value => Math.round(value * 1000) / 1000, megabytes = (a, b) => a === null || b === null ? null : Math.round((b - a) / 104857.6) / 10;
  return { characters: text.length, fullParseMs: round(fullMs), keystrokeMs: round(keystrokeMs), keystrokeMaxMs: round(Math.max(...typed.slice(1))), scatteredKeystrokeMs: round(scatteredMs), keystrokePercentOfFull: round(keystrokeMs / fullMs * 100),
    scatteredPercentOfFull: round(scatteredMs / fullMs * 100), reusedNodesPerKeystroke: reused, retainedHeapFullParseMB: megabytes(before, afterFull), retainedHeapPerKeystrokeKB: afterFull === null ? null : Math.round((afterTyping - afterFull) / keystrokes / 102.4) / 10 };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = measure(); console.log(JSON.stringify(result, null, 1));
  if (process.argv.includes('--update')) writeFileSync(baselinePath, JSON.stringify({ node: process.version, platform: `${process.platform} ${process.arch}`, ...result }, null, 1) + '\n');
  if (process.argv.includes('--check')) {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    if (result.keystrokePercentOfFull >= 5) { console.error(`keystroke reparse is ${result.keystrokePercentOfFull}% of a full parse (limit 5%, baseline ${baseline.keystrokePercentOfFull}%)`); process.exitCode = 1; }
  }
}
