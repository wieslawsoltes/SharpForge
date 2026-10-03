import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  corpus,
  root,
  json,
  sha256,
} from '../../../scripts/conformance/suites/shared/store.js';

test('imported cases are pinned, unique, byte-hashed and explicitly unmeasured', async () => {
  const pins = await json(
    path.join(root, 'planning/qualification/suites/pins.json'),
  );
  const sources = new Map(pins.sources.map((row) => [row.repository, row]));
  const features = new Set(
    (
      await json(
        path.join(
          root,
          'planning/qualification/inventory/csharp-features.json',
        ),
      )
    ).rows.map((row) => row.id),
  );
  for (const suite of ['roslyn', 'runtime-il', 'libraries', 'spec']) {
    const manifest = await json(path.join(corpus, suite, 'manifest.json')),
      identities = new Set();
    assert.equal(manifest.qualification, 'unmeasured');
    if (suite === 'roslyn') assert(manifest.imported >= 2000);
    for (const entry of manifest.entries) {
      const bytes = await readFile(path.join(corpus, suite, entry.file)),
        row = JSON.parse(bytes);
      assert.equal(sha256(bytes), entry.sha256);
      assert.equal(sha256(row.sourceText), row.sourceSHA256);
      assert.equal(row.qualification, 'unmeasured');
      assert.equal(
        row.provenance.commit,
        sources.get(row.provenance.repository).commit,
      );
      assert.match(row.provenance.sha256, /^[0-9a-f]{64}$/);
      assert(!identities.has(row.id));
      identities.add(row.id);
      assert(Array.isArray(row.unsupported));
      if (suite === 'spec') assert(features.has(row.featureId));
      if (suite === 'roslyn') assert(Array.isArray(row.expected.diagnostics));
    }
    assert.equal(identities.size, manifest.imported);
  }
});
