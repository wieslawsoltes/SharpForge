# Coded-index row bounds

`decodeCoded(kind, value)` accepts numeric unsigned 32-bit physical indices and rejects a decoded row above `0xffffff` before composing a token. Numeric zero remains nil. Reserved tags still reject. Other non-numeric, fractional, negative and out-of-range inputs throw `CilError`.

ECMA-335 sixth edition II.22 describes a metadata token as one table byte and three row bytes. The old decoder let row bits carry into the table byte: MemberRefParent `0x08000011` and signature TypeDefOrRef `0x04000009` became local TypeDef `0x02000002`.

Reference: https://www.ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf

## Validation

Product `34888c6c563290a14bbce29bbc028bf3a7cb720c`, baseline with new regression tests `f14693a1` (unchanged original decoder). `baseline-red.txt` retains three failures and one valid-input success. Candidate: 75/75 tests across coded-index, metadata, signature, type-adapter and Portable PDB scopes. Includes retained SRM and CoreCLR reference fixtures; no new native fixture is required for the token representation rule.

One machine-wide reservation ran installs, baseline regressions, candidate tests, benchmarks, static checks and structure checks sequentially. Test concurrency 1; Node heap cap 1024 MiB. Checks: 3189 syntax modules and 3185 static-import modules, zero errors; manifests 819 Node / 36 browser files, no unassigned or duplicates. Structure findings are pre-existing; none touch this change. Broader qualification remains staged.

## Performance

Command: `node packages/cil/tools/benchmark-coded-indices.mjs OUTPUT.json`, through the same parent `scripts/limited.js` reservation. Apple M3 Pro, macOS 26.6 arm64, Node 24.21.0; shared host, no quiet-machine claim. One million existing `TypeDefOrRef` decodes per sample; twelve chronological samples/process, first three warmups. Fixed twenty alternating baseline/candidate pairs; all forty raw process records are retained in chronological order. Each process reports median and nearest-rank p95 from nine retained samples; aggregate values below are medians of those process statistics.

| ms per million decodes | Baseline | Candidate | Change |
|---|---:|---:|---:|
| Median | 3.3696455 | 3.5015420 | +3.9143% |
| p95 | 3.4373750 | 3.5405625 | +3.0019% |

No new valid-input allocation is introduced: bounds checks are scalar. Allocation counts were not measured. The measured cost is reported without a speedup, significance or causal attribution claim. No benchmark was rerun to select a favorable result.
