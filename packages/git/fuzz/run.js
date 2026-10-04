import { GitError } from '../src/errors.js';
import { bytesToHex } from '../src/object-format.js';
import { MutationRandom, mutateBytes, sameBytes } from './mutate.js';
import { createPackFuzzer } from './pack.fuzz.js';
import { createDeltaFuzzer } from './delta.fuzz.js';
import { createIndexFuzzer } from './index.fuzz.js';
import { createObjectsFuzzer } from './objects.fuzz.js';
import { createPktlineFuzzer } from './pktline.fuzz.js';

export const DEFAULT_FUZZ_SEED = 0x0a250c0d;
export const DEFAULT_FUZZ_INPUTS = 1_000_000;

async function validControls(targets) {
  for (const target of targets) {
    for (const seed of target.corpus) if (seed.valid) await target.parse(seed.bytes, seed, 0);
  }
}

/** Exactly one million deterministic mutations by default; unexpected native errors retain a reproducer. */
export async function runGitParserFuzz({ seed = DEFAULT_FUZZ_SEED, inputs = DEFAULT_FUZZ_INPUTS, onProgress } = {}) {
  if (!Number.isSafeInteger(inputs) || inputs < 0 || inputs > 10_000_000) throw new RangeError('Invalid fuzz input budget');
  const targets = [await createPackFuzzer(), createDeltaFuzzer(), await createIndexFuzzer(), createObjectsFuzzer(), createPktlineFuzzer()];
  await validControls(targets);
  const random = new MutationRandom(seed);
  const families = Object.fromEntries(targets.map(target => [target.name, { inputs: 0, accepted: 0, errors: {}, maxInputBytes: 0 }]));
  for (let iteration = 0; iteration < inputs; iteration++) {
    const target = targets[iteration % targets.length];
    const corpus = target.corpus[random.integer(target.corpus.length)];
    let bytes = mutateBytes(corpus.bytes, random);
    if (target.repair) bytes = await target.repair(bytes, iteration, corpus);
    if (bytes.length > 4096) bytes = bytes.slice(0, 4096);
    if (sameBytes(bytes, corpus.bytes)) bytes = mutateBytes(bytes, random);
    const counts = families[target.name];
    counts.inputs++;
    counts.maxInputBytes = Math.max(counts.maxInputBytes, bytes.length);
    try { await target.parse(bytes, corpus, iteration); counts.accepted++; }
    catch (error) {
      if (!(error instanceof GitError)) {
        const failure = new Error(`Unexpected ${error.name} in ${target.name} parser at deterministic input ${iteration}: ${error.message}`);
        failure.reproducer = { seed, iteration, family: target.name, inputHex: bytesToHex(bytes) };
        failure.cause = error;
        throw failure;
      }
      counts.errors[error.code] = (counts.errors[error.code] ?? 0) + 1;
    }
    if (iteration % 10000 === 9999) onProgress?.({ inputs: iteration + 1, seed });
  }
  return { schema: 'sharpforge.git.fuzz.v1', seed, inputs, families, limits: { inputBytes: 4096, objectBytes: 4096, objects: 32 } };
}
