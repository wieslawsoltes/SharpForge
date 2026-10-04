# Boolean product ownership observation

The product is a field-only prerequisite for #783 / SF-A07-T21. It is published at `d6c6eb24eae3a7116b4bb5497c68b40b90aa3d2c`, whose tree is identical to the measured `af29812a6b0ca0184a79cc6bcddd01bf0a02fb6a` tree. Publication and successful tests do not establish a task claim.

At the 2026-10-04 17:42 UTC read, the authoritative `agent/SF-A07-T21` ref returned 404. An independent contents read returned “No commit found for the ref agent/SF-A07-T21.” Issue #783 is open, with no assignees and no comments; its labels include `state:blocked`. Current Project Agent, Lease and Status fields for #783 were not exposed by the connector and were not inferred from labels.

Therefore no authoritative `codex-p9-bcl-core` task lease or same-owner continuation is established by this evidence. Before promotion, reconcile the actual Project item/owner, task scope and applicable path reservations through the existing process. Do not fill the PR template with an invented claimant, lease, formal Ready state or absent-lock authorization.

## Exact path and hot-file evidence

`boolean-path-ownership-mapping.json` contains all 47 product paths, their baseline/current Git blobs and SHA256 values, area-glob matches, protected-lock matches and immutable published source URLs. The 47-file manifest exactly equals the baseline-to-measured diff. Zero changed paths match the checked-in hot-lock patterns, and all 60 checked protected/public-facade paths are unchanged, including root manifests, protected indexes, VM dispatchers, parser and CI paths.

Registered area write/evidence coverage is A02: 5 paths, A03: 1, A04: 1, A05: 10 and A07: 17. Thirteen paths do not match those registered area globs:

- docs/bcl-api.md
- docs/readonly-string-fields.md
- packages/bytecode/src/numeric/source-profile.js
- packages/bytecode/src/readonly-field-constants.js
- packages/cil/src/analysis-types.js
- packages/cil/src/emit/constants.js
- packages/cil/src/emit/emission-context.js
- packages/cil/src/load/field-span.js
- packages/framework/README.md
- packages/framework/src/readonly-fields.js
- packages/runtime/README.md
- scripts/benchmarks/a07-boolean-string-fields.mjs
- tests/fixtures/a07/boolean-string-fields.js

This is a static mapping, not an executed ownership gate or proof that the 13 unmatched paths are prohibited. The mixed product change does not qualify for the docs-only exception. Semantic ownership and any preserved legacy reservations require explicit reconciliation separately from hot-file preservation. The nine proposed A00 files are not in the 47-file product and remain unapplied.

The normalized issue/ref evidence is in `../claims/issue-783-ownership-observation.json`; the path mapping SHA256 is `0028618585b3ee4caa0cc0cf071024854c254d202c6b768ab46d8218cdd4d496`.
