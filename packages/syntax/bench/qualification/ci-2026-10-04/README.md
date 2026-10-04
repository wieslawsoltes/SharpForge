# Parser CI registration and historical-baseline disposition

This batch adds the missing parser job to the existing manually dispatched performance workflow for
[SF-A01-T12.4 / #1277](https://github.com/wieslawsoltes/SharpForge/issues/1277). It starts from published main
`4ad2d1096244a95b411baa8def4d4a8e9b7fbd0b` and applies the reviewed 32-line workflow contribution.
Parser code, corpus, driver, comparator, baseline bytes and the 15-percent threshold are unchanged.

## CI behavior

The independent `syntax` job uses Ubuntu 24.04, Node 24.21.0, a 2,048 MiB old-space cap and a 15-minute deadline.
It runs the existing two parser benchmark test files and then the existing full parser driver with
`--expose-gc --check --output`. All eleven cases, including the ten-megabyte document, participate.
The existing clean-checkout checker runs afterward, and the JSON artifact uploads even if the check fails.
A regression remains a failed job; no quick/update mode, failure suppression or baseline rewrite is added.

The job has no dependency on `paired`, so a failure against the retained historical baseline cannot suppress
the existing paired and browser jobs. The workflow remains manual/staged; its existing trigger, permissions,
action pins and other jobs are preserved.

## Concrete invocation route — not dispatched by this batch

After publication, open the repository's
[Performance regression service workflow](https://github.com/wieslawsoltes/SharpForge/actions/workflows/perf.yml),
choose **Run workflow**, select the published feature branch or merged `main`, and set:

- `base`: `4ad2d1096244a95b411baa8def4d4a8e9b7fbd0b` for the first publication comparison.
- `baseline_reviewed`: false. This exact base already contains `planning/qualification/size-budgets.json`,
  so the existing paired policy resolver uses the committed base policy without creating a new policy.

This dispatch starts the whole existing performance workflow, including paired and browser work, as well as
the new syntax job. There is no syntax-only dispatch input. Retain the actual workflow run URL, resolved head
SHA, syntax job/step logs and `performance-syntax-<run_id>` artifact. Verify the report's source identity and
baseline digest before interpreting the result.

Capability inspection found no workflow-dispatch operation in the connected GitHub toolset and no local `gh`
executable. The connector can read repository Actions runs and existing jobs/logs/artifacts, and can rerun
existing jobs; rerunning an old run does not execute this new source. Workflow-file-specific REST fetches were
rejected by the connector's endpoint allowlist. The permitted repository manual-run query returned four runs,
none for `perf.yml`; its actual response is retained in `ci-capabilities.json`. No workflow or rerun was started.

## Historical failure remains an actual failure observation

`historical-cross-host-failure.json` is the unmodified earlier capture:

- Capture SHA-256: `c28aad19848972ebf6d571c5ea97ad5ac229e79b691693934cb66ab14314f240`.
- Clean source: `60e000787912434100cb7dac83c4fdb0893c13d9`.
- Shared Linux x64 host, Node 24.19.0, AMD EPYC 9V74; quiet-host isolation was not established.
- Historical baseline: Node 24.21.0, Darwin arm64, SHA-256
  `816f4875798f97551fe42d3dcfa0488b277691f249d9fde3f696266f6838aeb2`.

| Case | Retained calibrated increase |
|---|---:|
| small | 103.08% |
| oneMegabyte | 114.80% |
| hugeString | 179.52% |
| hugeVerbatimString | 70.31% |
| hugeRawString | 78.79% |
| hugeInterpolatedString | 137.13% |
| hugeNumber | 135.56% |
| hugeArrayInitializer | 141.08% |
| hugeComment | 350.00% |
| longBinaryChain | 133.20% |
| tenMegabytes | 128.39% |

All eleven cases failed; none is reclassified as a pass. Calibration does not establish that different
operating systems, architectures or Node versions have equivalent performance characteristics. The new
Ubuntu job may therefore fail the unchanged historical baseline, and must retain that result honestly.

The baseline first appears at `ea012f434cfeba428392d61afd371e3fa65ba5a4`, but records no actual capture source
SHA, CPU/OS release, host load or individual timing samples. That introduction commit is a reproducible
historical source candidate, not proof of which source produced the numbers.

The retained failed source and the reviewed main `f009e294` had identical entire syntax and text package trees
and identical driver bytes; the source-proposal provenance records their exact Git objects. The current
workflow-only batch does not change their executable modules. Repeating those graphs merely to obtain a
different result would not resolve the historical provenance. No full historical rerun or forty-capture A/A
benchmark is performed for this batch.

## Comparable-host disposition and remaining acceptance

No comparable-host performance pass is claimed. A meaningful next qualification must record actual source,
Node binary/version, OS/architecture/CPU, input and driver hashes, activity context, and complete outputs on one
runner. It must distinguish unchanged-source control observations from a historical-source comparison. A
historical source comparison needs the same reviewed driver protocol; an older driver with the former
two-millisecond exception cannot supply the current acceptance verdict.

If the original capture environment cannot be established, a future runner-specific baseline is a separately
reviewed policy change with genuine captures and the original baseline/failures retained. It is not an
automatic response to this failing gate. Matching only `darwin arm64` and the Node version is insufficient to
reconstruct the missing original CPU/source provenance. Do not relabel the current Ubuntu observation as a
portable or historical-machine pass.

The driver performs zero warmups, three samples per ordinary case and one sample for the ten-megabyte case.
Its p95/p99 describe those samples, not stable tails. The earlier process peak RSS was 1,581.77 MiB;
`peakHeapMB` is sampled after synchronous parses, and cannot measure an unsampled intra-parse allocation peak.
Retained heap, sampled heap and process-lifetime RSS remain separately labeled. Allocation counts, true
per-parse peak heap, browser/Rust/Wasm timing and hardware-independent throughput are not qualified here.

#1277 remains open for an actual CI run, evidence-based comparable-host baseline disposition and the stated
throughput/memory/platform scope. A registered workflow and passing comparator tests alone do not close it.

## Focused local qualification

The only authorized local execution for this batch is the existing two-test-file command, once, from the
frozen source commit through the normal machine-wide limiter:

```sh
node scripts/limited.js node --test --test-concurrency=1 \
  tests/syntax-parse-qualification.test.js tests/syntax-parse-bench.test.js
```

The single run passed **8/8 tests, zero failures/skips**, in 5.234 seconds on Node 24.19.0 at frozen source
`8666b64e104753d3edb066ddd1c1c629ea18d6cc`, tree `680c4d1383d30d8a2b09169e736d30eb43199996`.
Tracked and untracked status were clean before and after; all captured file hashes and both own-checkout
package aliases were unchanged. `focused-results.json`, preflight/postflight records and `focused-tests.log`
retain the exact command, Node binary hash and actual result.

These tests include an existing quick measurement over ten cases; that is test coverage, not a new full
historical-baseline qualification or a retained performance comparison. This evidence-only commit changes no
workflow, parser, comparator, test or baseline source. Local Node24.19 is not an executed CI Node24.21 result.
No full npm install was used: the narrow checkout uses its own syntax/text package aliases. Unknown or restored
files were not removed to obtain a clean result. No full benchmark/A/A rerun or workflow dispatch occurred.
