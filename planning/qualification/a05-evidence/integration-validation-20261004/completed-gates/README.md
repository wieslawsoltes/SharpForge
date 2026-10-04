# Completed A00, browser-contract and build gates — 2026-10-04

This additive archive contains only completed commands. The ten original logs
and journals are unchanged; [manifest.json](manifest.json) records their sizes,
SHA-256 hashes, original paths, results and exact revision/tree identities. The
active broad-A05 log and journal were deliberately excluded. These overlapping
cohorts must not be summed or described as a full repository qualification.

| Command scope | Recorded revision | Result |
| --- | --- | --- |
| Full manifest-selected A00 area | `c45e90c6a3882c87e67dbec37a445dd216801d17` | 482 passed; zero failed, cancelled or skipped; 82,790.508622 ms Node test duration |
| Browser heap, Node Wasm bridge and native-plan contracts | `0e27de9250478583c769d7daf59ed1fe721af242` | 24 passed; zero failed or skipped; 2,715.387749 ms |
| Python browser-harness contracts | `0e27de9250478583c769d7daf59ed1fe721af242` | Six passed; reported test duration 0.002 seconds |
| Repository static checks | `0e27de9250478583c769d7daf59ed1fe721af242` | Manifest, syntax and static-import checks passed |
| Browser observer cleanup contracts | `7d7fac37a672d0961fa82c457b64910c0c97a7d6` | Eight passed; zero failed or skipped; 1,717.664294 ms |
| Oracle license policy | `7d7fac37a672d0961fa82c457b64910c0c97a7d6` | Passed |
| Strict repository build | `7d7fac37a672d0961fa82c457b64910c0c97a7d6` | `npm run build` passed and produced `dist/` |

The A00 runner reports 482 tests, including nested subtests; its top-level TAP
plan is 463. The 482/482 claim is the original Node aggregate, not an added count.
It ran the full selected A00 manifest through the ordinary limiter and runner
after [the nested lease repair](../run-slot-inheritance/README.md). The earlier
[interrupted A00 attempt](../a00-contracts/README.md), its deadlock evidence,
81/81 focused selection and 2/2 compatibility selection remain separate and
unchanged. A completed A00 area does not establish a completed A05 area or every
repository core step.

The browser-related selections are Node and Python contract tests. The Node
bridge tests include actual Node Wasm execution, while the harness tests cover
configuration, observations and cleanup after compilation refusal. They do not
establish a new Chromium, Firefox or WebKit execution of the added heap/GC case,
nor a new native CLR run. The earlier published browser reports remain scoped
to their seven original cases and product revision.

`npm run check` records 1,318 assigned Node files, 38 browser scripts, zero
unassigned or duplicate files, 4,702 JavaScript modules checked with zero syntax
errors, and 4,647 inspected modules / 4,690 linked modules with zero import
errors. License validation records seven tools, 14 packages, four actions,
three images and 15,350 tracked paths. The successful build does not measure
before/after output-size growth or satisfy a performance threshold. The original
npm proxy-configuration warnings are retained in the raw outputs.

Every journaled command used `node scripts/limited.js` with explicit
`SHARPFORGE_MAX_PARALLEL_RUNS=1`, `SHARPFORGE_TEST_CONCURRENCY=1` and
`SHARPFORGE_MAX_OLD_SPACE_MB=512`. The journals preserve expanded argv, commit,
tree, start/end timestamps, exit status, unchanged final revision and clean
working-tree status. Runtime-version strings were not captured in those journals
and are not inferred. The archive verifies all revision/tree pairs and requires
completed successful journal entries; it does not reconstruct a later run from
earlier output.

The [earlier repair checkpoint](../ci-repair-checkpoint/README.md) retains the
216/208/8 and 308/306/2 outcomes and separate passing fixture/harness runs. No
historical failure, original issue criterion or acceptance status was rewritten.
