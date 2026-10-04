/** An edit prepared against a stale version is never silently relocated. */
export class TextVersionError extends Error {
  constructor(expected, actual) {
    super(`Text version changed: expected ${expected}, received ${actual}`);
    this.name = 'TextVersionError';
    this.code = 'TEXT_VERSION_MISMATCH';
    this.expected = expected;
    this.actual = actual;
  }
}
