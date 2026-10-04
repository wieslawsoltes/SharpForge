import './fixtures/a05-memory/replay.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {readMemoryRecording} from './fixtures/a05-memory/recording.mjs';

for (const [name, content, expected] of [
  ['truncated JSON', '{', SyntaxError],
  ['incomplete pinned capture', '{}', /Pinned capture requires toolchain provenance/]
]) {
  test('memory replay does not fall back from ' + name, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sharpforge-memory-recording-'));
    try {
      await writeFile(join(directory, 'native.json'), content);
      await assert.rejects(readMemoryRecording(new URL('./', pathToFileURL(join(directory, 'placeholder')))), expected);
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });
}
