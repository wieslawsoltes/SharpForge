import { writeFileSync } from 'node:fs';
import { rebuiltLayoutFixture } from './input.js';
writeFileSync(process.argv[2], rebuiltLayoutFixture());
