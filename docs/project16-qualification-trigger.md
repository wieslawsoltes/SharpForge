# Explicit Project16 qualification triggers

The dedicated `.github/workflows/project16-qualification.yml` retains its manual
`workflow_dispatch` runner, engine, stage and reviewed baseline inputs. It also
accepts one deliberately named **new branch** as a fallback when a client cannot
invoke workflow dispatch. The ordinary pull-request and central CI workflows
are unchanged.

GitHub documents the `create` event with the created ref's last commit as
`GITHUB_SHA` and the created branch/tag as `GITHUB_REF`:
[Events that trigger workflows — create](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#create).
The job accepts branch creation only. A normal branch or any tag creation skips
this job before entering its concurrency group.

## Name and source contract

Use this exact branch grammar:

```text
codex/project16/qualify-(ubuntu|windows|macos)-(chromium|firefox|webkit)-(all|node|browser|performance)-<nonce>
```

The nonce is **8–64 lowercase ASCII letters, digits or internal hyphens**, starts
and ends with a letter or digit, and must name a branch that does not already
exist. For example:

```text
codex/project16/qualify-ubuntu-chromium-browser-20261004-a1
```

The platform selects exactly `ubuntu-latest`, `windows-latest` or `macos-latest`;
there is no runner matrix or user-defined runner label. Engine and stage come
from the same complete grammar. A name starting with the qualification prefix
but failing the full grammar is rejected immediately after checkout/setup-node,
before Python setup, dependency installation, build or capture.

The workflow checks out **`${{ github.sha }}` explicitly**, not the branch's
possibly newer head. `scripts/project16-trigger.js` then validates the event
kind, event ref, full `GITHUB_REF`, selected runner OS and immutable 40-character
`GITHUB_SHA` against the actual checked-out `HEAD`. It records the actual tree
SHA. The resolver reads at most 256 KiB of event data and only writes validated,
single-line, fixed-key values to `GITHUB_ENV`. Baseline paths cannot inject an
extra environment record.

## One explicit run

1. Finish the entire intended source scope, merge it to `main`, and wait for both
   the relevant PR core check and merged-main core check to pass. The merged
   workflow must contain this trigger before the branch is created.
2. Capture that completed merged-main commit's full immutable SHA. Choose one
   runner, engine and stage, and a fresh safe nonce.
3. Create **one** Git branch ref at that exact SHA through the GitHub branch/ref
   API. For a raw REST ref request, the ref is `refs/heads/` followed by the full
   name above, and `sha` is the captured completed-main SHA. Do not move an
   existing branch or create several qualification branches together.
4. Observe the dedicated workflow's single selected job to completion and keep
   its artifact before scheduling another explicit qualification run.

Creating the branch requests one chosen platform/scope. Pushing to an existing
branch, updating its target or deleting it is not a `create` event. The job's
concurrency group remains `project16-qualification` with
`cancel-in-progress: false`; unrelated create events cannot enter that group.
GitHub concurrency is not an unlimited queue, so explicit requests must remain
one at a time.

Ordinary branch-triggered runs have **empty editor and workbench baselines** and
use capture-only comparison mode. Their relative regression verdict remains
null; existing absolute correctness/latency checks still apply. An explicit
`compare-a5-` nonce prefix opts into the
[pinned, reviewed a5 baseline profile](project16-a5-baseline-profile.md):

```text
codex/project16/qualify-ubuntu-chromium-all-compare-a5-20261004-a6
```

This profile permits only Ubuntu/Chromium with `all` or `performance`. The
`compare-` namespace is reserved: malformed or unknown profile requests fail
instead of falling back to capture-only. Profile bytes, source identity and
schemas are verified before environment output; live host compatibility stays
in the existing performance preflight. Manual dispatch continues to preserve its
exact baseline path inputs and use that same preflight before capture.

## Recorded provenance and scope

Subsequent step conditions and artifact names use the resolver's runner, engine
and stage. `source.json` records the immutable commit and tree, trigger event,
full ref, optional nonce, runner label/OS, stage, engine, capture-only flag,
baseline paths, nullable `baselineProfile` and workflow run ID. The evidence and artifact steps run only if
the resolver succeeded, including when a later build or qualification step
fails. An invalid trigger cannot upload a misleading qualification artifact.

The focused regression sources are `tests/a19-qualification-trigger.test.js`
and `tests/a19-qualification-profiles.test.js`. They cover platform/engine/stage
choices, manual defaults/baselines, unrelated or malformed events, ref/SHA and
runner mismatches, bounded event reads, environment injection rejection, pinned
profile integrity, reserved prefixes and preserved performance-stage failures.
These tests exercise no browser, benchmark, dependency install or remote action.
They were authored for the next consolidated affected validation; no execution
or successful remote qualification is claimed by this source change.
