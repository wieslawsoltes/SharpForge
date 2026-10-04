# Explicit reviewed a5 performance baseline profile

Work-IDs: SF-A19-T11.4 (#1581), SF-A20-T12.3 (#1643).

The root integration reviewer explicitly accepts the two pinned, successful a5
captures as comparative inputs for a future compatible Ubuntu/Chromium run.
This is integration review, not human approval or a claim that a5 passed overall:
[a5 completed 16 scopes, with 11 passed and five failed](project16-hosted-qualification.md).
The editor browser and workbench performance captures themselves completed and
passed their correctness/absolute assessments. The original run was capture-only;
it had no prior-baseline regression verdict, and that historical outcome remains
unchanged.

## Explicit selection

Create one fresh branch at the completed, qualified source using either form:

```text
codex/project16/qualify-ubuntu-chromium-all-compare-a5-20261004-a6
codex/project16/qualify-ubuntu-chromium-performance-compare-a5-20261004-a6
```

These are examples, not instructions to trigger both. Keep the existing serial
qualification schedule and [immutable-ref contract](project16-qualification-trigger.md).
The complete nonce, including `compare-a5-`, remains bounded to 64 characters.
The suffix must start and end with a lowercase letter or digit; internal hyphens
are allowed. Unknown or malformed `compare-` profiles, another runner or engine,
and `node`/`browser` stages are rejected before build or capture. Default create
nonces remain capture-only. Manual dispatch continues accepting explicit baseline
paths as before; this profile adds no implicit manual selection.

| Mode | Baseline inputs | Relative outcome |
|---|---|---|
| Ordinary create | Empty | Capture-only, `regressionVerdict: null`; absolute gates still apply |
| Explicit `compare-a5-` create | Both pinned reports after verification | Existing strict relative and absolute gates |
| Manual dispatch | The supplied paths, or empty | Existing preflight and comparison/capture behavior |

`source.json` records `baselineProfile: "a5"`, the chosen paths and
`captureOnly: false` for the explicit profile. Other modes record a null profile.
An unverified request cannot write qualification environment values. Changed,
missing or incompatible inputs fail explicitly; no capture-only fallback or
replacement baseline is chosen.

## Pinned evidence and source

All three files are existing archived bytes; the profile does not rewrite,
normalize or regenerate them. `scripts/project16-baseline-profiles.js` pins their
byte counts and SHA-256 values and invokes the existing report schema validators.

| Archived path under `docs/evidence/project16-hosted/a5/` | Bytes | SHA-256 |
|---|---:|---|
| `editor-browser.json` | 38,079 | `d514882e71ede3ec24fabec5337a3a89381d0ca0ced192aac0bdac4aacee42b8` |
| `workbench-large-trace.json` | 29,341 | `4f0c0583e184d63ff58ff1972ed833383d151d3e9aacdb4259900526fe523d83` |
| `source.json` | 473 | `96a4d8ab7806700ec9539048a6eb8b2b71483fb79bcb013b3c06086475378237` |

The pinned source envelope identifies commit
`c13aa0fd9d27df28b3708bb83d914a04c20a5c7c`, tree
`29023ed8b962b6d91671bdb0c0359d905ef2659e`, workflow run `37178840757`,
Ubuntu/Linux, Chromium and the original `all` create-trigger capture.
The editor report embeds the same commit. The workbench report uses the archived
source envelope for its source identity; no embedded field is invented.

The editor data contains 25 browser rows: five operations at five sizes from
1 KiB through 200 MiB, with 20 retained samples per row and three warmups.
The workbench capture has 126 samples across three independent rounds of fixture
`workbench-501-csharp-v2`, hash
`9296f1fca9909280fd92a7242eba2c794909f8727077e1e973769c28ced2874e`.

## Compatibility and failure placement

Profile activation checks fixed bytes, source identity and schemas. It does not
move live host checks into the trigger. Existing performance preflight rejects
known Node/CPU/OS/architecture mismatches before performance captures; preceding
independent Node/browser scopes in an `all` run can still finish, and later
independent scopes continue through the existing serial outcome collector.

The editor comparator requires exact Node, platform, architecture, CPU, browser
and browser-version matches. For a5 those are **v24.21.0**, **linux**, **x64**,
**AMD EPYC 7763 64-Core Processor**, **chromium**, **153.0.8010.12**. The report
also retains V8 `13.6.233.17-node.53` and four logical CPUs; these are disclosed
metadata, not additional comparator keys. Selecting `ubuntu-latest` alone cannot
guarantee compatibility with the recorded host.

The workbench comparator requires deep equality of the entire environment and
fixture, including Linux `6.17.0-1022-azure`, hardware concurrency 4, device memory
16, DPR 1, viewport 1440×1000, `http-static`, `fresh-context-paint-v2` and the
shared-browser/fresh-context launch protocol. Browser-version or workbench
environment/fixture mismatches discovered after capture remain failures. An
editor incompatibility can retain editor raw output while preventing the
dependent workbench capture; it is not silently marked comparable.

No `--allow-environment-change`, comparator change, threshold relaxation or
source-specific exception is added. The existing relative gates reject p95
regressions above 20%; editor typing and workbench absolute budgets also remain
in force. This profile does not change the separate contribution-guideline 5%
review policy or the previously recorded performance exceptions.

## Completed local validation

The complete targeted four-file cohort passed **35/35 tests**, with zero failed,
canceled, skipped or todo cases. The parent integration ran it at exact source
`876baeb099c9697f20fd09e7ffa39ebda284770e`, tree
`bb8661834ea08234b6cbf499dbdd7b8c53322cb9`, using Node **v24.19.0**. The retained
timestamps are **2026-10-04 06:28:50.308925–06:28:50.964269 UTC**; the Node test
runner reported **510.205138 ms**. Tracked source was clean, the untracked-file
inventory was empty, and the recorded source remained unchanged.

```sh
node scripts/limited.js node --test --test-reporter=tap \
  tests/a19-qualification-profiles.test.js \
  tests/a19-qualification-trigger.test.js \
  tests/a19-qualification-preflight.test.js \
  tests/a19-qualification-outcomes.test.js
```

This cohort covers allowed/rejected routing, pinned bytes and missing files,
source-envelope integrity, no silent fallback, delayed host rejection and the
unchanged strict comparators. The ten new profile cases are included in the
35-test total and are not added again. All four files use the existing A19
manifest ownership.

Independent reviewer `/root/text_engine` inspected the completed profile,
trigger/workflow wiring, ten new fixtures and documentation without executing
tests, builds or measurements. The review found no concrete blocker and confirmed
that exact pins precede environment output while live compatibility remains in
the performance stage.

A read-only dimension inspection covered the four changed JavaScript source/test
files. No introduced line exceeds 160 characters, and every file is below the
500-line/40 KiB limits:

| File | Lines | Bytes | Longest line |
|---|---:|---:|---:|
| `scripts/project16-baseline-profiles.js` | 78 | 4,661 | 145 |
| `scripts/project16-trigger.js` | 154 | 7,760 | 146 |
| `tests/a19-qualification-profiles.test.js` | 147 | 9,147 | 141 |
| `tests/a19-qualification-trigger.test.js` | 154 | 8,374 | 131 |

The [unaltered test log](evidence/project16-a5-baseline-profile/tests.log) and
[source/timing summary](evidence/project16-a5-baseline-profile/summary.json)
are archived with a [SHA-256 manifest](evidence/project16-a5-baseline-profile/manifest.json):
two raw files, **9,219 bytes**. The test-log SHA-256 is
`fc285ea68ecf380504b050be8cb7310e539a098a2e5db9a3c0c0c7579e5effec`.
Copies were read back and compared byte for byte; no test, build or capture was
rerun for this evidence update.

**Hosted comparative execution remains pending.** These local tests qualify the
profile and orchestration behavior; they do not establish a hosted environment
match, a new browser capture or a relative performance verdict.
