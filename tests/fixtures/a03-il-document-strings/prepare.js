import { writeFileSync } from 'node:fs';
import { rebuiltStringFixture } from './input.js';
writeFileSync(process.argv[2], rebuiltStringFixture());
