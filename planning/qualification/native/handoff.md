# T10 implementation handoff

Parent #406 and all five atomic leaves #1180–#1184 are implemented together on
`codex/a29-native`, stacked on T09 `codex/a29-repro` (`971c3e2`). Exact ownership:
new `.github/workflows/native.yml`, `scripts/conformance/native/**`,
`tests/conformance/native/**`, `planning/qualification/native/**`, and
`planning/qualification/platform-matrix.json`. No compiler, runtime, native
workspace/MSBuild service, `ci.yml`, release or root package edits are included.

The shared workflow owner is independently composing T08/T09 release producers
and T11 preview reuse. T10 adds separate gated native/Node jobs; ordinary PR core
remains a single job and reproducible artifact producers keep their own exact
Node 24.21.0/npm 11.19.0 pin. SDK 10 matches the existing native oracle pin.

Implementation covers all sixty declared capability obligations with twelve
SDK cells and twelve Node cells. The committed matrix has zero captures: every
obligation is unknown. No task is marked Done and no platform pass is claimed.
The only executed generation command writes that empty denominator; source
formatting is also complete. Tests, syntax/actionlint checks, builds, actual
SDK/permission/cancellation runs and benchmarks have deliberately not run, under
the user's instruction to validate a larger integrated epic after implementation.

Next batch, from the final reviewed integration commit:

1. Run core check/test/build, native contract/filesystem/process regressions and
   actionlint. These can expose new product gaps; preserve their failing evidence.
2. Run each actual OS/architecture/SDK and Node cell in `native.yml`; collect its
   environment/report/bundle even on installation or test failure.
3. Verify cancellation leaves no actual child processes and that POSIX/Windows
   permission controls are effective. Root processes explicitly cannot qualify
   POSIX discretionary permissions; Windows POSIX signals remain unsupported.
4. Capture the implemented cold/warm p95/p99 and CLR managed-allocation fixtures.
   MSBuild allocation and actual Node allocated bytes remain unknown without an
   allocation profiler; retained heap deltas do not fill those gaps.
5. Aggregate only matching commit/run evidence. Review every unknown/unsupported
   capability and real OS/image version before promoting the matrix artifact to
   the committed planning file. No new OS version is inferred as tested.

The matrix is a native qualification artifact, not a board-wide parity rollup.
The later [consolidation](consolidation.md) integrates the additive capability IDs
and `sharpforge-native-platform-v1` into the shared registry under the integration
owner's explicit narrow authorization. Every registration remains unknown, with
empty evidence and artifact-index inputs. Parser tests do not manufacture proofs.
