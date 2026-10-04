import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { compactFixture } from './input.js';

const output = process.argv[2];
mkdirSync(output, { recursive: true });
for (const compact of [false, true]) writeFileSync(join(output, compact ? 'compact.dll' : 'wide.dll'), compactFixture(compact));
