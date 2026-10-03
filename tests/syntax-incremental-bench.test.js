import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './support/syntax-reference.js';
import { measure, benchmarkDocument } from '../packages/syntax/bench/incremental.bench.js';

// SF-A01-T03.5: the incremental benchmark has a committed baseline for a million-character input, and a keystroke
// reparses in well under 5 percent of a full parse.
test('incremental bench: the committed baseline covers a million characters and meets the 5 percent bound', () => {
  const baseline = JSON.parse(readFileSync(join(repoRoot, 'packages/syntax/bench/incremental.baseline.json'), 'utf8'));
  assert(baseline.characters >= 1_000_000); assert(baseline.keystrokePercentOfFull < 5 && baseline.scatteredPercentOfFull < 5, JSON.stringify(baseline));
  for (const key of ['fullParseMs', 'keystrokeMs', 'scatteredKeystrokeMs', 'reusedNodesPerKeystroke', 'retainedHeapFullParseMB', 'retainedHeapPerKeystrokeKB', 'node', 'platform']) assert(baseline[key] !== undefined && baseline[key] !== null, key);
  assert(benchmarkDocument().length >= 1_000_000);
});
test('incremental bench: a keystroke in a 250,000-character document costs under 5 percent of a full parse', () => {
  const result = measure({ size: 250_000, keystrokes: 30 });
  assert(result.characters >= 250_000); assert(result.reusedNodesPerKeystroke > 50, JSON.stringify(result));
  assert(result.keystrokePercentOfFull < 5, JSON.stringify(result)); assert(result.scatteredPercentOfFull < 5, JSON.stringify(result));
});
