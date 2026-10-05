import assert from 'node:assert/strict';

/** Package-owned smoke for the published foundation surface. */
export async function smoke({ api, report }) {
  assert.equal(Object.isFrozen(api.GitErrorCode), true);
  const failure = new api.GitError('Corrupt', 'Fixture error', { fixture: true });
  assert.deepEqual(JSON.parse(JSON.stringify(failure)), failure.toJSON());
  report.git = { surface: 'error-contract', codes: Object.keys(api.GitErrorCode) };
}
