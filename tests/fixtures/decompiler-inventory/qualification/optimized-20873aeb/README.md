# Optimized inventory qualification and performance decision

The once-only follow-up qualified product `20873aeb` at execution/tool head `5c14c79d`.
The unchanged four-file gate passed **25/25**, with zero failures, cancellations or skips.
This is Node qualification with retained SRM replay; no fresh oracle, browser or other-OS run is claimed.

The same predetermined cohort completed with all output guards and checksum `483708000` intact.
Independent Python recomputation matched all 90 timing and memory statistics from 1,000 measured
and 200 warmup samples. Each sample averages 20 calls. **p95/p99 below are batch-mean percentiles,
not individual-call latency percentiles.** No samples were removed beyond the original warmup rule.

## Existing whole-assembly API costs

| Fixture / input | Statistic | Unit | Baseline | Optimized candidate | Absolute change | Change |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Arithmetic / bytes | median | us/call | 67.657175000 | 167.953600003 | +100.296425003 | +148.242112% |
| Arithmetic / bytes | p95 | us/call | 140.376849999 | 355.096350002 | +214.719500003 | +152.959338% |
| Arithmetic / bytes | p99 | us/call | 232.955850000 | 465.524700000 | +232.568850000 | +99.833874% |
| Arithmetic / cachedInspector | median | us/call | 21.744475000 | 89.671999999 | +67.927524999 | +312.389814% |
| Arithmetic / cachedInspector | p95 | us/call | 42.109900000 | 176.999600000 | +134.889700000 | +320.327761% |
| Arithmetic / cachedInspector | p99 | us/call | 127.767749999 | 300.961350001 | +173.193600001 | +135.553455% |
| Native CFG / bytes | median | ms/call | 48.887095400 | 48.363249525 | -0.523845875 | -1.071542% |
| Native CFG / bytes | p95 | ms/call | 57.568348850 | 60.058032750 | +2.489683900 | +4.324744% |
| Native CFG / bytes | p99 | ms/call | 61.813160000 | 62.149138900 | +0.335978900 | +0.543539% |
| Native CFG / cachedInspector | median | ms/call | 46.243271400 | 48.166332000 | +1.923060600 | +4.158574% |
| Native CFG / cachedInspector | p95 | ms/call | 58.104930700 | 57.945586450 | -0.159344250 | -0.274235% |
| Native CFG / cachedInspector | p99 | ms/call | 62.375250950 | 67.115834050 | +4.740583100 | +7.600103% |

## New inventory stage and memory observations

| Fixture | Unit | Median | p95 batch mean | p99 batch mean |
| --- | --- | ---: | ---: | ---: |
| ArithmeticAssembly | us/call | 56.033075001 | 164.438700001 | 184.298300001 |
| NativeCfgAssembly | ms/call | 0.409056350 | 0.709965250 | 0.804649900 |

The raw report preserves every signed heap/ArrayBuffer observation. A batch retains 20 result
objects until memory is observed; these are neither allocation counts nor retained output sizes.
The shared host reported Node v24.19.0 / V8 13.6.233.17-node.51, Linux x64 6.18.44,
AMD EPYC 9V74, nine visible CPUs and 10,451,464,192 bytes of memory.
Initial load averages were 2.28/2.00/1.98. Imports, comparisons and memory observations
remain outside the timer. Full environment and both package graphs are pinned in the report.

## Automated performance exception

Primary agent `/root` accepts the explicitly measured existing-API regressions for this feature
and will record this decision in the PR. **This is automated reviewer sign-off, not human approval
or a threshold pass.** The additional owned census returns all physical rows and all 53 schemas,
validates bounds and cancellation, retains raw scalar values, and joins method results.
The three-method arithmetic fixture has only 15 rows, so the complete schema output adds fixed
work relative to the old method-only operation. The larger fixture has 38 methods and 341 rows.

The source review removed duplicate table layouts and repeated row-width reductions while
preserving the output, mutation and budget contracts. Reusing an exposed inventory across calls
would change those contracts. The second cohort still has substantial small-fixture regressions;
its native cached p99 also exceeds 5%. Both cohorts and their slower tails remain part of this
exception. The results do not establish that all observed cost is necessary or attributable to
the removed computations, and shared-host conditions do not justify discarding an observation.

Cross-cohort results are mixed: arithmetic byte-input candidate median rose from 154.3965 to
167.9536 us, while cached-input median fell from 93.54195 to 89.672 us. Those separate process
observations are not an isolated causal optimization measurement. No further rerun is requested.

## Retention

The original first cohort and its review remain byte-identical in the parent directory.
This directory retains all five new raw files, the exact measured driver, and independently
computed statistics/provenance in [summary.json](summary.json). The only benchmark-source change
from the first cohort is its implementation commit pin; sample counts, inputs, guards and
ordering are unchanged.

New raw report SHA-256: `601fcd2edbee99ad279380fd0b20264d2c74aabc753ee7dc15985a2ee597b391`.
