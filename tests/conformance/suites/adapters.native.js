// Requires the exact existing oracle SDK pins. Run separately from portable core.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { executeCase } from '../../../scripts/conformance/suites/shared/execute.js';
const shim = (
  await readFile(new URL('./libraries/XunitShim.cs', import.meta.url), 'utf8')
).replace(/^using System;$/m, '');
const row = (sourceText) => ({
  id: 'shim-native',
  kind: 'library',
  sourceText,
  target: 'exe',
  langVersion: '12',
  expected: { exitCode: 0 },
  unsupported: [],
});
test(
  'minimal xunit scalar assertions really execute on CLR, CIL and source VM',
  { timeout: 45000 },
  async () => {
    const actual = await executeCase(
      row(
        'using System; using Xunit; class P { static int Main() { Assert.Equal(42, 42); Assert.True(true); Assert.False(false); Assert.Null(null); return 0; } }\n' +
          shim,
      ),
    );
    assert.deepEqual(
      actual.map((result) => [result.engine, result.status]),
      [
        ['clr', 'pass'],
        ['cil-vm', 'pass'],
        ['source-vm', 'pass'],
      ],
    );
  },
);
test(
  'false xunit assertion cannot become successful no-op',
  { timeout: 45000 },
  async () => {
    const actual = await executeCase(
      row(
        'using System; using Xunit; class P { static int Main() { Assert.True(false); return 0; } }\n' +
          shim,
      ),
    );
    assert.equal(actual[0].engine, 'clr');
    assert.equal(actual[0].status, 'fail');
    assert.match(actual[0].stderr, /Assert.True/);
  },
);
test(
  'scalar-only shim explicitly rejects sequence-equality overload',
  { timeout: 45000 },
  async () => {
    const actual = await executeCase(
      row(
        'using System; using Xunit; class P { static int Main() { Assert.Equal(new int[0], new int[0]); return 0; } }\n' +
          shim,
      ),
    );
    assert.equal(actual[0].status, 'unsupported');
  },
);
