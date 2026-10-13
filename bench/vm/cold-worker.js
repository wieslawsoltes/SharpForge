import {readFileSync} from 'node:fs';
import {deserialize} from 'node:v8';
import {coldSample} from './cold-sample.js';
import {isMain} from './evidence.js';

if (isMain(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('Use bench/vm/harness.js; this worker requires serialized input');
    const at = performance.now();
    const input = deserialize(readFileSync(process.argv[2]));
    const inputReadDeserializeMs = performance.now() - at;
    process.stdout.write(JSON.stringify({...await coldSample(input), inputReadDeserializeMs}));
  } catch (error) {
    process.stderr.write(error.stack + '\n');
    process.exitCode = 1;
  }
}
