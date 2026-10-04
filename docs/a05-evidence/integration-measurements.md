# A05 integration measurements

These are retained measurements of the exact commits identified in each JSON
report. They include missed and inconclusive targets. They do not qualify later
commits or establish completion of Project 7. `integration-measurements.json`
records the SHA-256 digest of each unchanged report.

## Correctness and managed collection

`a05-byref-gc-stress-17f2620c.json` records 1,000 distinct generated CIL assemblies
at commit `17f2620c8cc1241748a00f1f913318903db883bc`, with a clean tracked tree.
Field, array, and box owners occur 334, 333, and 333 times. All 131,341 guest
instructions have a corresponding managed collection. The same report retains
96 source counterparts across source execution, canonical reload, and compiled
CIL, plus negative controls that deliberately remove the only owner root.
The corpus digest is
`18c91f4e6fabf4b7f28afd8e760ff33a3438ac301e1174811241c029f431f140`.

This is JavaScript VM and managed collector evidence. It is not a native CLR run.
Reproduce from the reported revision with:

```sh
SHARPFORGE_BYREF_STRESS_REPORT=/absolute/output/byref.json \
SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_TEST_CONCURRENCY=1 \
SHARPFORGE_MAX_OLD_SPACE_MB=512 \
node scripts/limited.js node --test --test-concurrency=1 tests/byref-gc-stress.test.js
```

## Timing targets

All timing reports use Node 24.19.0 on Linux x64, a 64-bit managed native width,
three retained warmup pairs, 20 measured pairs in alternating mode order, and
10,000 paired bootstrap resamples for 95% confidence intervals. Each original
fixture, reference mode, threshold, and observation remains in its JSON report.

| Target | Commit `9ab4a805` result | Required | Decision |
| --- | ---: | ---: | --- |
| Source integer loop | 1.8874x; CI 1.7889–1.9565x | 1.5x | Met |
| Source Fibonacci | 1.0029x; CI 0.8968–1.0633x | 1.5x | Missed |
| Virtual dispatch | 1.0075x; CI 0.9084–1.0642x | 3x | Missed |
| Int32 arithmetic | 6.1246x; CI 5.8200–6.3716x | 2x | Met |
| Small-long arithmetic | 6.0685x; CI 5.1945–6.3166x | 3x | Met |
| Scalar slot loads | 30.3833% reduction; CI 26.0083–32.8266% | 30% | Inconclusive |

Both frame-pool rows reported zero warm frame/storage allocations. Warm call
plans reported zero offset-map allocations, and warm field access reported zero
token resolutions. Those exact counters do not establish unrelated timing or
host-allocation targets.

The earlier `a05-targets-c8ff8c6f.json` remains available, including its missed
numeric, call, and source targets. Later selected-target reports at commit
`6cea3cb3368f06c31517092868e555d7f84b2391` measure the first prepared-call changes:

| Target | Observed | 95% interval | Required | Decision |
| --- | ---: | ---: | ---: | --- |
| Source Fibonacci | 1.0849x | 1.0322–1.1162x | 1.5x | Missed |
| Virtual dispatch | 1.6284x | 1.5750–1.7385x | 3x | Missed |

Run the original full target suite from its reported commit with:

```sh
SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 \
node scripts/limited.js node --expose-gc bench/vm/qualification.js \
  --runner a05-linux-x64-node24 --native-bits 64 --suite targets \
  --out /absolute/output/targets.json
```

The two selected runs add `--target source-fibonacci` or `--target virtual-cache`.
A selected report qualifies only its named row. Failed thresholds must remain
visible when assessing later implementation changes.
