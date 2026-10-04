import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {numericOracle} from './support/numeric-differential.js';

test('fresh native numeric artifacts retain SDK, width and content-hash validation outside tracked fixtures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge numeric oracle '));
  const previous = process.env.SHARPFORGE_NUMERIC_ORACLE_DIR;
  try {
    const bytes = Buffer.from('42\n');
    await writeFile(join(directory, 'sample.txt'), bytes);
    await writeFile(join(directory, 'provenance.json'), JSON.stringify({format: 'SharpForge.NativeNumericOracle/1',
      sdk: '10.0.201', nativeIntBits: 64, files: {'sample.txt': {
        bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')
      }}}));
    process.env.SHARPFORGE_NUMERIC_ORACLE_DIR = directory;
    assert.equal(numericOracle('sample.txt').text, '42\n');
    await writeFile(join(directory, 'sample.txt'), '43\n');
    assert.throws(() => numericOracle('sample.txt'), /Native oracle hash/);
  } finally {
    if (previous === undefined) delete process.env.SHARPFORGE_NUMERIC_ORACLE_DIR;
    else process.env.SHARPFORGE_NUMERIC_ORACLE_DIR = previous;
    await rm(directory, {recursive: true, force: true});
  }
});
