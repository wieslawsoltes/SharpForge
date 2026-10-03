import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const { writePE } = await import(process.argv[2]);
const section = Uint8Array.from({ length: 96 }, (_, index) => index < 72 ? 0 : index * 7 & 255);
const metadataOffset = 72, metadataLength = 24, entryToken = 0x06000001;
const bytes = writePE(section, metadataOffset, metadataLength, entryToken);
writeFileSync(process.argv[3], JSON.stringify({ sourceCommit: process.argv[4], section: [...section], metadataOffset, metadataLength,
  entryToken, sha256: createHash('sha256').update(bytes).digest('hex') }, null, 2) + '\n');
