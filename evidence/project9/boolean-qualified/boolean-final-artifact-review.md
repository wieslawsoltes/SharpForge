# Boolean final artifact-size review

**Decision: accept all six package-size results and the final browser-size result at `af29812a6b0ca0184a79cc6bcddd01bf0a02fb6a`. No size-budget exception is required. The previously accepted performance exceptions remain unchanged.**

Independent Codex agent review; not human review. Baseline `af5450dacbdc2734432b13dffa63efb10eb93145`; candidate tree `d934a12e448fc825ad49a535ced67a801e98e57c`.

## Actual npm tarballs

Independently opened all 12 actual archives and verified 2,264 regular-file payloads against reported SHA256 and the exact Git blob/path at each recorded revision. Archive sizes, unpacked sums, counts and percentage calculations match. No links, fixtures, benchmarks, scripts, tests, artifacts or node_modules are packed. Every package.json is byte-identical across revisions, so this batch adds no package dependency or packaging-policy change.

| Package | Packed bytes baseline → final | Packed growth | Unpacked bytes baseline → final | Unpacked growth | Decision |
|---|---:|---:|---:|---:|---|
| @sharpforge/bcl-core | 67,931 → 68,398 | +467 / +0.687462% | 250,817 → 252,196 | +1,379 / +0.549803% | Accept within budget |
| @sharpforge/bytecode | 23,795 → 24,274 | +479 / +2.013028% | 82,246 → 83,877 | +1,631 / +1.983075% | Accept within budget |
| @sharpforge/cil | 232,083 → 232,882 | +799 / +0.344273% | 826,065 → 828,903 | +2,838 / +0.343556% | Accept within budget |
| @sharpforge/compiler | 1,064,667 → 1,064,983 | +316 / +0.029681% | 4,049,731 → 4,051,077 | +1,346 / +0.033237% | Accept within budget |
| @sharpforge/framework | 22,295 → 22,695 | +400 / +1.794124% | 70,967 → 71,961 | +994 / +1.400651% | Accept within budget |
| @sharpforge/runtime | 177,316 → 179,162 | +1,846 / +1.041079% | 627,002 → 633,338 | +6,336 / +1.010523% | Accept within budget |

Growth comprises the Boolean descriptor, closed readonly-field carrier validation, compiler/CIL field handling, runtime string-initialization and result guards, and documentation. No avoidable bundled evidence or third-party dependency was found.

## Fresh browser output

Baseline **112,935,639 bytes  / 5,547 files**; final **112,989,490 bytes  / 5,554 files**. Change **+53,851 bytes /+0.0476829108%**, with 7 new files and 0 removed. All 11,101 actual baseline/candidate assets were rehashed against complete manifest path sets. Thirty changed source leaves plus 3 changed worker bundles account for the entire 33-asset byte delta.

The 30 source leaves comprise 15 byte-equal committed files and 15 files matching only the documented browser package-import rewrite. The final runtime worker is 3,349,493 bytes, SHA256 `e0e99a062a278006f5a1778e495e35d26f9d67f34d50422208bee63b7aff6b56`, and contains the final optimized literal lookup, scalar-cache fast path and readonly-string initializer. This verifies actual emitted contents and final implementation markers; it is not an independent rebundling proof.

Evidence hashes:

- `boolean-artifact-qualification.json`: `f02ff8aa9d54358b22b13f985ae5753a2b7569ad61b55aa876a6e2094c36be2c`
- `boolean-final-asset-provenance.json`: `e8ab8728a369e46101606d92a45fbd3ab0e1e2acb44e8c5029fd5ea65fd6784d`
- `boolean-baseline-assets.json`: `4e5203107e8a30a7e40d089b6e39ff39a776e20267ba3d43421532342f99a6da`
- `boolean-candidate-final-assets.json`: `3db2de7746a498b62df7c988502df04de25c82cf575da36c40c6ebebf432df58`
- `boolean-optimized-performance-review.md`: `2cd0a8d308b6710d2b96d0ca87351a8a29f0f29af6150f8964a23d51cae27ad3`
- `boolean-optimized-performance-review.json`: `ce85d47d8edad0b58b2f724e519b9f33ecae45fe93e26957873202af6102ba3a`

## Qualification boundary

- Read-only artifact/hash/archive/Git inspection; no product commands, tests, builds, installs, native captures or benchmarks executed by reviewers.
- Actual tarballs correspond to exact recorded revisions; package qualification does not imply a newly repeated offline install/smoke matrix.
- Actual browser manifests/leaves and bundled final-helper markers verified; no independent byte-for-byte rebundling was performed.
- Initial rejected timing cohort remains retained; no general speedup or averaging offsets claimed.
- Size approval does not imply unrelated A00/schema ownership clearance or broader platform qualification.
