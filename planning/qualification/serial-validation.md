# Staged serial validation

This policy follows the requested implementation-first schedule. A workflow file
or merged harness is not qualification evidence. Retained failures, unsupported
platforms and unmeasured obligations remain open until actual captures exist.

Ordinary pull requests and main pushes run the existing single `core` job:
static and manifest checks, impact planning, quarantine expiry checks, build,
checkout integrity, and PR preview upload. PRs also retain the contract-change
and seam-lock review gates. Ordinary runs do not execute Node tests, including
impacted subsets; a green ordinary `core` is not unit qualification evidence.
Central full qualification is staged until the completed scope is ready and is
explicit: `ci.yml` manual dispatch, a PR carrying `full-ci`, a merge-group event,
or a reusable release call passing `qualification: true`. These modes execute
the complete Node manifest suite once per platform through the serial `npm test`
runner. That suite already includes the conformance Node regressions; Python
infrastructure regressions retain their separate lane.
A reusable workflow observes its caller's event,
so release qualification uses that boolean instead of testing for
`event_name == 'workflow_call'`. Release packaging still requires the strict
`ci-ok` aggregate and the existing approval/payload verification gates.

The central job order is core → other core platforms → browser build → packages
→ browser suites → native IL → native MSBuild → CLR Wasm exclusion → aggregate.
Each matrix has `max-parallel: 1`; job dependencies prevent simultaneous matrix
families. A failed prerequisite stops later dependent families, and `ci-ok`
rejects their skipped results. `fail-fast: false` retains every cell within the
currently executing matrix. No missing cell becomes a pass.

Specialized browser, native, oracle, differential, inventory, performance,
coverage, GC, supply/CodeQL, planning, area-manifest and Rust workflows are
manually dispatched, with pre-existing reusable entries retained. They no longer
start together from a `full-ci` label, main push, schedule or merge group. The
central merge-group workflow still validates the actual combined tree; extra
planning/area/Rust checks must be dispatched separately when required. This
policy does not configure branch protection or claim that manual specialties ran.
Product release publication retains the separate reproducibility trigger;
`evidence-archive-*` releases are excluded. External documentation links use the
repro workflow's explicit `external_links` input instead of a weekly test run.
The initial performance baseline review uses the explicit `baseline_reviewed`
input, which remains false by default.

The validation owner submits one workflow, waits for it to finish, records its
run and exact source, then submits the next. Wait for the automatic main core
run after merging before submitting another test batch. Apply `full-ci` only
when its central qualification can own this slot. Do not dispatch specialty
workflows in a batch or publish a release while another qualification is active.
Other teams' ordinary PR core checks retain independent concurrency groups.
There is deliberately no repository-wide concurrency key: GitHub concurrency
allows replacement of pending runs and is not a durable FIFO queue. Local tests,
checks, builds and hosted submissions share the same team scheduling discipline.

Manifest and historical npm task runners enforce `--test-concurrency=1` and
reject explicit concurrent overrides. Direct qualification Node invocations,
coverage and retry subprocesses use the same setting. Rust jobs set one Cargo
build job and one test thread. Browser/native target matrices execute one cell
at a time. This scheduling does not remove intentional concurrency scenarios
inside an individual test, such as competing application instances or workers.

Metadata-only lease reconciliation, CI-stat collection and specification watching
retain their separate schedules. Pages deployment remains managed by its own
workflow; its full browser qualification is an explicit manual option.

This policy changes scheduling, not evidence status. Broad qualification remains
staged until the integrated scope is ready. No qualification run, environment
configuration, provider authentication, release or deployment is claimed here.
