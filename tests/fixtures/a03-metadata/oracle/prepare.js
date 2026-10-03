import { writeFileSync } from 'node:fs';
import { metadataFixture } from '../fixture.js';

if (!process.argv[2]) throw new Error('Pass the output metadata root path');
writeFileSync(process.argv[2], metadataFixture().builder.finish());
