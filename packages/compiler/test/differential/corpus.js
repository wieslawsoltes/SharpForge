/**
 * The former hand-maintained fixture registry of the Roslyn differential harness (SF-A02-T40).
 *
 * Fixtures are discovered from `fixtures/` and stored by `corpus-store.js`; this module only re-exports it, so that
 * the tests that import the corpus from here keep working. New code imports `corpus-store.js`.
 */
export * from './corpus-store.js';
