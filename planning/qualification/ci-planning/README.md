# A29 E03 planning and CI batch

Tasks [#483](https://github.com/wieslawsoltes/SharpForge/issues/483)–[#490](https://github.com/wieslawsoltes/SharpForge/issues/490)
extend merged A00/A29 APIs from source `9ef76da4447eeb7ddd223bd0ec81ef0a3eee3f04`. Each leaf has an atomic claim/lock on
`codex/a29-ci-planning`. Existing contract IDs, runtime/compiler code and release producers are unchanged.

| Leaf | Implementation and retained boundary |
| --- | --- |
| T13 | `planning-gates.yml` calls a runner using authoritative task/claim/lock identity, ownership/hot-file APIs, DAG, manifests and contract gate. Every subprocess outcome is retained in JSON and the job summary. |
| T14 | Existing `ci.yml` merge-group execution is preserved. Planning gates and `merge-queue.yml` operate on GitHub's queued combined tree. Existing actual incompatible-branch fixture is reused. |
| T15 | Hourly lease workflow reuses `Claims.reap`, `snapshotBacklog` and `syncReady`. Labels expiry/readiness, preserves ownership and suppresses optional comments; no automatic reassignment. |
| T16 | Core computes changed-module consumers using the existing import graph, ownership and manifest matrix. Selected owner/consumer areas plus A00/A29 shared tests run in one Node invocation; unknown impact falls back to `npm test`. Queue/manual area workflow runs the full manifest-derived Node/browser matrix. |
| T17 | Failure detector retains every attempt; failure then pass is `flaky`, never silent green. Quarantines require an issue, reason and expiry; expired entries fail core. An explicit manual workflow input can measure named files. |
| T18 | PR template carries resolvable Task identity and evidence/ownership fields. Task/bug forms render the existing lint-required sections and preserve existing owner IDs. |
| T19 | Pinned Rust workflow requires fmt/clippy/tests/Wasm/cargo-deny/Miri if `rust/` exists. Missing workspace is explicitly not applicable and not qualified. No Rust workspace or safety implementation is invented. |
| T20 | Weekly API capture records attempt-specific jobs, exact commits, queue/total p50/p95 and configured PR budgets. Missing samples remain unknown; breaches fail and appear in the summary. |

## Current CI policy takes precedence

Ordinary PRs have exactly one core job, retaining `npm run check`, build, test registration and shared contract/infrastructure
fixtures. The test step chooses either impacted Node files or the full `npm test` fallback; it never runs both. Non-JS,
configuration, missing/deleted/unresolved modules and non-PR events select the full suite. Full-ci PRs also select full.
Selection uses the existing static ESM dependency model plus owning areas, not a claim of browser/native impact coverage.

Older T13/T16 requirements predate the user's core-only PR policy. Additional planning/Rust lanes require manual dispatch,
`full-ci` or a merge group; existing browser/native/release qualifications remain separate. Queue area jobs prepare the built IDE and pinned Playwright dependencies whenever their manifests contain Python/browser scripts, then execute `--browser`; browser-only areas cannot become empty passing cells. Required workflow status configuration is an administrator action;
this batch does not claim to have changed branch protection or enabled a merge queue.

## Credentials and trust

PR/queue workflows have read-only repository tokens and never use `pull_request_target`. Event text passes through environment
variables or JSON, never interpolated into shell code. PR planning gates require access to the user Project's metadata;
if the ordinary read-only workflow token cannot read it, the gate fails rather than accepting self-declared PR locks.
No broader Project secret is exposed to PR code by this workflow. Missing access is an explicit configuration limit.

The lease workflow runs only on the default branch, hourly or by manual dispatch. Configure `PLANNING_PROJECT_READ_TOKEN`
with read access to this Project and repository issue metadata. It is used only for read-only GraphQL requests.
The separate repository `GITHUB_TOKEN` has `issues:write` for the two label families and `contents:write` for the existing
claim protocol's temporary `agent-ops/*` mutex refs. The wrapper rejects writes to implementation/claim refs, record updates,
Project fields and arbitrary labels. Optional issue comments are suppressed. No real credentials were created or used in
this implementation. Missing credentials fail clearly.

`syncReady` currently synchronizes **issue labels**, not Project Status. The current full-backlog duplicate Work IDs remain
real errors; readiness reports failure and leaves labels unchanged. Expiry processing happens first and still records its
outcome. The wrapper does not rename/collapse IDs, steal leases or reinterpret Backlog as Ready.

The explicit permission-registry addition is only
`.github/workflows/lease-reaper.yml#reconcile: [contents, issues]`. No release/security job permissions change.

## Rust and timing policy

The Rust lane reads `rust/rust-toolchain.toml` or the root `rust-toolchain.toml` with Python's standard TOML parser. It rejects
floating channels, overriding legacy files, absent lockfiles and absent `rust/deny.toml` policy. The workspace's exact channel
controls fmt/clippy/test/Wasm; cargo-deny is pinned to [0.18.3](https://github.com/EmbarkStudios/cargo-deny/releases/tag/0.18.3)
and Miri to `nightly-2025-08-01`. These installation commands are implemented but have not been executed here.
See the official [toolchain file contract](https://rust-lang.github.io/rustup/overrides.html#the-toolchain-file) and
[Miri CI guidance](https://github.com/rust-lang/miri#running-miri-on-ci). The future Rust workspace must keep these pins compatible;
installation failures remain failures. This lane does not implement later T35 Rust safety policy.

The initial CI budget is 20 minutes total p95 and 10 minutes queue p95 for the core workflow, with at least five completed
PR samples. These are explicit proposed limits, not measured results. The weekly capture includes failures/cancellations
among completed runs and preserves raw run/job metadata. It does not claim historical budget compliance without a capture.

## Reproduction and qualification

The implementation and fixtures are complete before local validation. Only focused regressions and required core are in scope;
no broad browser/native, Rust installation, live scheduled mutation, credential setup or hosted merge-queue run is claimed.

```sh
node --test tests/conformance/ci-planning/*.test.js tests/conformance/leases/*.test.js tests/conformance/flaky/*.test.js tests/conformance/rust/*.test.js tests/conformance/ci-stats.test.js tests/conformance/planning-templates.test.js
node scripts/conformance/flaky/detect.js --check-quarantine
node scripts/conformance/ci-stats.js --input path/to/retained-runs.json --output artifacts/ci-stats.json
python scripts/conformance/rust/qualify.py --plan
```

The flake detector defaults to the requested `planning/qualification/flaky.json` for explicit local measurements; CI overrides
that path into `artifacts/`. The checked-in record says `not-measured` and the quarantine list is empty. Raw reports contain
failed attempts, not only the final retry. Focused fixtures use fake GitHub/process results and temporary real Git repositories;
they are not live scheduling, native Rust or provider-access evidence.
