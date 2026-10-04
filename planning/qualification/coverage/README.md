# Per-area package coverage — SF-A29-T36

Implementation is available. Repository-wide measurement and floor review are
**deferred**; `coverage.json` records `not-run`, and `floors.json` has no fabricated
percentages. Empty floors mean no baseline has been established, not that packages
have met a zero-percent gate. This does not close full platform qualification.

```sh
node scripts/conformance/coverage.js --area A05
node scripts/conformance/coverage.js --proposal artifacts/coverage/floors-proposal.json
```

The runner resolves the existing area manifests, executes their exact Node test
files using `node --experimental-test-coverage`, and writes
`planning/qualification/coverage.json`. Raw per-area coverage events and bounded
process logs remain in `artifacts/coverage/`. Tests continue across area failures,
and the report is saved even if discovery, execution, collection, or floor checks
fail. Browser and native targets are explicitly unsupported by this instrument.
A package unobserved by a selected manifest is listed as unmeasured. Only loaded
`packages/*/src` files enter the package figures; these are **observed-file
coverage**, not an assertion that every source file was instrumented. Area results
are separate, with weighted line/branch counts; percentages are not averaged or
summed across overlapping area test suites. A zero denominator is null, not 100%.

Floors are keyed by area and package, bind the measured source commit and file
set, and require a review reference. A failed area, vanished measured file,
missing measured package, or lower line/branch percentage fails that floor.
Malformed or duplicate policy entries fail before execution. Running a selected
area does not claim to enforce floors for areas that were not selected.

`--proposal` writes a proposal containing the actual measurements, source commit
and `review: null`. It never changes policy. Review the measurements and their
file scope, add the review reference, then deliberately update `floors.json`.
The proposal cannot be used as policy until reviewed. Keep the prior floors when
measurements regress; fix the cause or review an explicit scope/baseline change.

The coverage workflow uploads the report and logs with `if: always()` on every
coverage run, including failures. It is manually dispatched, so ordinary
PRs retain the agreed single required core job. It does not publish measurements
to the repository or silently approve a new baseline.

The reporter uses the documented Node 22 `test:coverage` event:
https://nodejs.org/download/release/latest-jod/docs/api/test.html#event-testcoverage
Positive, negative and boundary tooling tests include a real tiny temporary Node
package; that fixture measurement does not qualify SharpForge package coverage.
