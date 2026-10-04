import { readFile, writeFile } from 'node:fs/promises';

// This trusted qualification-only editor makes one exact native `git add -p` edit selection.
const path = process.argv.at(-1);
const before = await readFile(path, 'utf8');
const after = before.replace(/^\+middle-not-selected\r?\n/m, '');
if (before === after) throw new Error('Native partial-staging patch did not contain the expected unselected line');
await writeFile(path, after);
