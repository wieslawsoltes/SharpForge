import { writeFileSync } from 'node:fs';
import { layoutFixture } from './input.js';

writeFileSync(process.argv[2], layoutFixture());
