import assert from 'node:assert/strict';

/** The package verifier invokes this in an isolated offline install. */
export async function smoke({api}) {
  assert.ok(Object.keys(api).length > 0);
}
