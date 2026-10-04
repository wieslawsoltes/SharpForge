# A05 pending-work closeout — 2026-10-04

This is a historical report for the restricted closeout instruction and revisions
below. The subsequent request to implement all remaining Project 7 items
supersedes its deferral statement. Current criteria and unresolved obligations
are tracked in [the 83-issue acceptance audit](a05-project7-acceptance-audit.md).
Its original measurements and failures remain preserved as revision-scoped evidence.

This integration finishes the existing 20 PRs and four committed unpublished
leaves after the user requested no new work. It preserves every original head
as an ancestor and combines validation/merge to avoid twenty duplicate CI runs.
The rest of Project 7 remains incomplete and deferred.

Included PRs: #4309, #4315, #4320, #4327, #4330, #4337, #4355, #4356, #4358, #4366, #4375, #4381, #4384, #4386, #4399, #4403, #4408, #4410, #4412, #4415.
The additional committed leaves implement small CIL/source Math extrema,
reference-free explicit scalar layout storage, and typed instance-pointer locals.

## Validation

Product revision: `e849d6de6c531c09a03908d0fed7f19fba55a29c`.
Main integrated: `97a4e87ff65b12bd2f390402b28b00020373c49a`.
Node 24.21.0 on macOS arm64; one machine-wide run slot, one test worker,
512 MB old-space cap. [Exact command and summaries](a05-close-open-work-validation.json).

The serial pass covered 146 A05/ABI test files: **2,146 tests, 2,137 passed,
9 failed, none skipped**. Every failure reproduced on the integrated main
revision in a separate serial baseline run (75 tests, 66 passed, 9 failed).
No changed test file failed. This is not a claim that the entire suite is green.
Required repository CI separately checks the final PR revision.

Baseline failures concern generic aggregate diagnostic wording, two closed-field
signature aliases, constrained-prefix/EH diagnostic precedence, invalid rethrow
admission, unknown-opcode fault classification, two incomplete type-system seam
fixtures, and open-generic `ldtoken` admission. Their exact names are in the JSON.
They remain deferred with the original project scope.

## Integration adjustments and limits

Conflict resolutions retain prefix verification, virtual pointer dispatch and
typed local provenance together, and regenerate the ABI inventory including the
explicit byte carrier. Fixture repairs apply the allocation limit after PE
loading, respect canonical operand normalization, widen narrow standalone wire
results before Console output, and preserve NaN input bits when constructing a
JavaScript argument array. Malformed explicit layouts now expect TypeLoadException.

New tests initially assumed compiler capabilities outside these increments.
The final tests cover the implemented registrations and numeric behavior; these
existing limitations are recorded rather than expanding compiler work:

- Ambiguous mixed signed/UInt64 Math calls are rejected, but their diagnostics
  do not consistently use CS0121.
- Source semantic lowering rejects enum boxing. Enum/integer casts do not
  consistently preserve the intended representation. Registry identities,
  names, defaults, arrays and Round mode consumption are covered.
- The released Double source wire returns raw Numbers. Boxing an integral-valued
  result can report Int32. Mixed Double tests verify numeric results; the new
  small/Single registrations separately verify their declared result identity.

The two performance suites were excluded from this functional pass. No native,
browser, cross-platform or performance acceptance is claimed. Existing E01/E02
artifacts and failed performance evidence remain retained in their original
worktrees. No full epic or unfinished project item is marked complete.
