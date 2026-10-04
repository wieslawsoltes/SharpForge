# Lexical scopes and typed local slots

The `packages/symbols/interop/ScopeTree` Debug C# fixture contains nested and
sibling scopes and primitive/array/constructed local types.
The executable reads its own Portable PDB with System.Reflection.Metadata,
uses `LocalScope.GetChildren()` to establish nesting, and decodes the PE's local
StandAloneSig through `DecodeLocalSignature`. The fixture provider supports its
observed type forms; other forms fail rather than fabricate reference names.

Capture passed: four SRM scopes and local types, SDK 10.0.201 / compiler
5.3.0-2.26153.122 / CoreCLR 10.0.5. Full compiler/source/DLL/PDB hashes are in
`reference.json`. Command (both concurrency limits set to 1):

```sh
SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_PARALLEL_RUNS=1 \
DOTNET_PATH=/Users/wieslawsoltes/.dotnet/dotnet \
node scripts/limited.js node scripts/validate-pdb-scope-tree.mjs \
  --capture tests/fixtures/portable-pdb-scope-tree
```

Only explicit capture writes reference JSON/binaries. Offline focused tests
read captured data and separately exercise hidden flags, exact AST ownership,
missing signatures, invalid slots, nesting/order and aggregate bounds. No IDE,
Windows PDB, runtime-value or external-assembly qualification is claimed.

## Focused validation

Final product/capture revision: `1223143986c6d8da2b91d5b72c70e38ed60adaed`.
Eight new scope tests passed. The oversized-RID regression first failed on
`2eac2882f103a82dda146e444c67eb8c65031bc7` with “Missing expected exception”;
the guard now checks the original RID before token construction. No native
rebuild was needed for that malformed-input guard.

Another 49 affected tests passed (57 total): effective imports, existing
imports/constants, native CDI and Portable PDB. No unchanged broader suites or
full matrix were rerun. Both commands used the limiter and concurrency 1:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a13-04-scope-tree.test.js
node scripts/limited.js node --test --test-concurrency=1 \
  tests/a13-04-effective-imports.test.js tests/a13-01-imports-constants.test.js \
  tests/a13-01-native-cdi.test.js tests/portable-pdb.test.js
```

The affected command, comparison and checks ran as sequential child processes
of one limiter-owned driver without nested acquisition. `npm run check` passed
3,128 syntax / 3,124 static modules with zero errors; 30 manifests / 799 Node
files / 32 browser scripts, zero unassigned/duplicate tests. Structure exited 0
with 268 existing findings and none in changed files. Install and native/proof
commands initially waited on the host limiter; all local jobs are terminal.

## One fixed load comparison

Existing LocalConstants control (18 constants), before
`4249049378bf2c26b93758bd9843bd5c1c391645`, after the product revision above.
Complete load startup includes the new bounded scope/type snapshots. Thirty
warmups per revision, 20 AB/BA pairs, 100 loads/sample, GC before each sample;
median is mean of sorted positions 10/11 and p95 is nearest-rank position 19.
The host was shared, with only this team's sole scheduled job authorized.
No repeats, allocation measurements, speedup, significance or noise-causality
claim; this does not measure query throughput.

| Per-load milliseconds | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Median | 0.527846880 | 0.560509795 | +0.032662915 (+6.18795%) |
| p95 | 0.600042910 | 0.607968750 | +0.007925840 (+1.32088%) |

Root reviewer explicitly accepts the +0.032662915 ms / +6.18795% median
and +0.007925840 ms / +1.32088% p95 tradeoff. Bounded owned lexical trees and
declared local-type snapshots provide the requested debugger API without
retaining PE/borrowed AST state; the RID guard rejects malformed aliasing.
This is a quantified feature/correctness disposition, not a causal attribution.

Host: darwin arm64 Apple M3 Pro; Node v24.21.0; started 2026-10-04T04:00:34.178Z.
Control DLL 12,800 bytes SHA-256
`2bc24dbbe692eea3cabc20af34808395d8f3c649ff955b1116edc85cf7b33226`;
PDB 12,180 bytes SHA-256
`4c4b2edea79e17147cec25dc25dc0543223525c69560b93ce203a855fec9b48e`.

Reuses the [committed exact host harness](../portable-pdb-effective-imports/README.md#exact-host-harness),
with these literal substitutions only: `sharpforge-a13-imports-base` →
`sharpforge-a13-scopes-base`, `SharpForge-a13-effective-imports` →
`SharpForge-a13-scope-tree`, the before/after full revisions shown above, and
workload text `recorded import scopes` → `recorded lexical scopes`.
The before package was archived from its exact revision with private workspace
links. Command: `node --expose-gc /tmp/sharpforge-a13-scopes-interleaved.mjs`
inside the sole limiter-owned driver. Harness SHA-256:
`cae42d3054b128dbbb21d8119e6cc3faf326a80a11479b359623a19ad722782a`.

Chronological raw samples:

| Pair | Revision | Start offset ms | Elapsed ms | Per load ms |
| ---: | --- | ---: | ---: | ---: |
| 0 | before | 1.8672499999999843 | 60.24933300000001 | 0.60249333 |
| 0 | after | 64.15312499999999 | 63.29320800000002 | 0.6329320800000002 |
| 1 | after | 129.58116699999997 | 55.508583000000044 | 0.5550858300000004 |
| 1 | before | 187.584333 | 59.61425000000003 | 0.5961425000000002 |
| 2 | before | 250.11916699999998 | 60.00429100000002 | 0.6000429100000002 |
| 2 | after | 312.48637499999995 | 56.66141700000003 | 0.5666141700000003 |
| 3 | after | 371.16949999999997 | 58.44891699999994 | 0.5844891699999993 |
| 3 | before | 431.6005 | 55.019874999999956 | 0.5501987499999995 |
| 4 | before | 488.9812079999999 | 53.013209000000074 | 0.5301320900000007 |
| 4 | after | 543.949625 | 59.37491699999998 | 0.5937491699999998 |
| 5 | after | 605.360042 | 56.25041599999997 | 0.5625041599999997 |
| 5 | before | 663.6595 | 54.554666999999995 | 0.5455466699999999 |
| 6 | before | 720.2513329999999 | 53.469625000000065 | 0.5346962500000007 |
| 6 | after | 775.82425 | 60.796875 | 0.60796875 |
| 7 | after | 839.6212079999999 | 55.234292000000096 | 0.552342920000001 |
| 7 | before | 896.868208 | 54.31762499999991 | 0.543176249999999 |
| 8 | before | 953.440583 | 47.33050000000003 | 0.4733050000000003 |
| 8 | after | 1002.695333 | 56.871624999999995 | 0.5687162499999999 |
| 9 | after | 1061.483958 | 55.6907920000001 | 0.556907920000001 |
| 9 | before | 1119.3265000000001 | 49.72762499999999 | 0.49727624999999986 |
| 10 | before | 1171.2414170000002 | 46.16954099999998 | 0.4616954099999998 |
| 10 | after | 1219.327667 | 55.21558300000015 | 0.5521558300000016 |
| 11 | after | 1276.732 | 49.64416700000015 | 0.4964416700000015 |
| 11 | before | 1328.4171250000002 | 53.37966699999993 | 0.5337966699999993 |
| 12 | before | 1384.4895000000001 | 47.14379199999985 | 0.4714379199999985 |
| 12 | after | 1433.5605830000002 | 56.17987499999981 | 0.5617987499999981 |
| 13 | after | 1492.4198330000002 | 49.79958399999987 | 0.4979958399999987 |
| 13 | before | 1544.359917 | 53.445916000000125 | 0.5344591600000013 |
| 14 | before | 1600.069375 | 47.52412500000014 | 0.4752412500000014 |
| 14 | after | 1649.5705830000002 | 55.92208399999981 | 0.5592208399999982 |
| 15 | after | 1708.009 | 50.362082999999984 | 0.5036208299999998 |
| 15 | before | 1760.32975 | 52.55616699999996 | 0.5255616699999996 |
| 16 | before | 1815.1195 | 46.56908300000009 | 0.4656908300000009 |
| 16 | after | 1863.621625 | 57.97170800000026 | 0.5797170800000027 |
| 17 | after | 1923.9678330000002 | 50.993124999999964 | 0.5099312499999996 |
| 17 | before | 1977.228917 | 50.18187500000022 | 0.5018187500000022 |
| 18 | before | 2029.6251670000001 | 47.39637499999981 | 0.4739637499999981 |
| 18 | after | 2079.439875 | 56.725832999999966 | 0.5672583299999997 |
| 19 | after | 2138.410792 | 50.35024999999996 | 0.5035024999999996 |
| 19 | before | 2191.155583 | 50.33262500000001 | 0.5033262500000001 |
