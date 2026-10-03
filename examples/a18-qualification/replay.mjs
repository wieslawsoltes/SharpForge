import {firstSeed, sequenceCount, runSeededSequence} from '../../tests/fixtures/a18/fuzz.js';

const seedArgument = process.argv[2];
const seed = seedArgument === undefined ? firstSeed : Number(seedArgument);
if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Seed must be an unsigned 32-bit integer.');
const result = runSeededSequence(seed);
process.stdout.write(JSON.stringify({
  corpusFirstSeed: firstSeed, corpusSequences: sequenceCount,
  ...result,
}, null, 2) + '\n');
