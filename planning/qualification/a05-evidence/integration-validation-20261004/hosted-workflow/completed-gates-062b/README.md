# Completed static, oracle-license and sparse-build checks — 2026-10-04

These records were produced at clean unchanged revision
`062b3b899d8dd36a696ee0e028e5951d86e98139`, tree
`a48712f9873d7c4948619ed6e3654d7e53e81d63`, using Node v24.19.0 and resource
controls 1/1/512. Each original execution journal retains the literal command,
working directory, before/after identity, timestamps and exit code.

| Check | Completed result | Original records |
| --- | --- | --- |
| `npm run check` | **Failed**, exit 1; one unreviewed dynamic import in `scripts/a05/hosted-reference-check.js:27` | [Journal](static-execution.json), [log](static.log) |
| Oracle license policy | **Passed**, exit 0; inventory covers 7 tools, 14 packages, 4 actions, 3 images and 17007 tracked paths | [Journal](license-execution.json), [log](license.log) |
| `npm run build` | **Passed**, exit 0; functional build on a sparse checkout | [Journal](build-execution.json), [log](build.log) |

The failed static run did pass registration inventory and syntax checks: 1335
Node test files, zero unassigned/duplicate files, and 4769 JavaScript modules
with zero syntax errors. Its import analysis inspected 4710 and linked 4757
modules, then reported the single dynamic-import failure. The later child-process
split at `bf48fd5c94487b862633de4cb88df6d439beb07e` is a follow-up source change;
these records do **not** include its retest or convert the original failure into
a pass.

The license result is specifically `scripts/conformance/oracle/license-policy.js`.
It does not establish a whole-repository license scan or release clearance.

The build journal explicitly limits its result to a functional sparse build,
not complete-asset size or pinned release-toolchain qualification. The stale
pre-build identity belongs to `7d7fac37a672d0961fa82c457b64910c0c97a7d6`; the
completed identity belongs to the tested `062b3b899` revision. Both are retained
without rewriting their provenance. The completed inventory also contains two
staging paths. Neither a clean source tree nor its `stable` flag proves that a
sparse checkout materialized every tracked release asset. Exact historical
sparse patterns are not included in the supplied journals.

The [manifest](manifest.json) records byte lengths and SHA-256 hashes for all
eight retained payloads. Six journals/logs are byte-identical originals. The two
larger identity JSON files use deterministic lossless gzip: level 9, modification
time zero and no embedded filename. Their original **and** compressed lengths
and hashes are recorded, and decompression was verified byte-for-byte against
the original files. For example:

```sh
gzip -dc completed-build-identity.json.gz > completed-build-identity.json
```

This additive archive resides under `planning/qualification/a05-evidence`, outside
shipped documentation assets. It preserves the failed check, stale identity and
build limitations. The earlier focused 48-test record remains a separate cohort;
no counts are added. No tests, builds, benchmarks or source edits were performed
during archival, and no later main merge or release qualification is covered.
