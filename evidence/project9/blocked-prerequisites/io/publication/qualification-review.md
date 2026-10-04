Independent IO qualification review

Final local and replay-tested revision: fe8288772be85395909d5de582c444db3d605ca3; tree: 541c835f876aefd506ec55ee30511929f131accd. Product measured: f8414bfcadbab039280d580a8152ac21f9fe6452. Baseline: 726fbd8303042c7634a057807b51adeaddffa9a8.

Reviewer: independent Codex review agent /root/review_insert_repeat. This is explicit agent sign-off, not human review.

All 15 median exceptions and all 18 p95 increases above 5% below are accepted individually for this completed batch. The avoidable parameterless scalar lookup and repeated descriptor checks were removed. Required native disposal/newline ordering, live newline reads, partial progress, roots and typed formatting remain intact. Existing output-sensitive algorithms and every measured allocation/byte/slot-write sample are unchanged. No further concrete avoidable source work was identified. Acceptance does not attribute ordinary Write or unchanged buffer movement to the disposal gate, dismiss results as noise, offset regressions with faster rows, or claim a general speedup.

The largest median increase is 1.549092 ms per 256 calls; the largest p95 increase is 3.496769 ms, to 5.725454 ms. Causes are not fully isolated. Pooled p95 is the maximum of ten retained observations, not a precise population-tail estimate.

Median exceptions (all times in milliseconds):

| Engine | Existing case | Baseline median | Final median | Change | Decision |
| --- | --- | ---: | ---: | ---: | --- |
| source | whole-buffer-write-control | 4.841600 | 6.204146 | +28.142% | Accept |
| source | scalar-int-Write-string-control | 1.463880 | 1.709443 | +16.775% | Accept |
| source | scalar-ulong-WriteLine-string-control | 2.703022 | 2.845887 | +5.285% | Accept |
| source | scalar-float-WriteLine-string-control | 2.483689 | 2.629064 | +5.853% | Accept |
| source | scalar-decimal-Write-string-control | 1.726762 | 1.877339 | +8.720% | Accept |
| cil | character-control | 1.641492 | 2.116275 | +28.924% | Accept |
| cil | character-line-control | 2.973329 | 4.522421 | +52.100% | Accept |
| cil | whole-buffer-write-control | 5.789979 | 6.816611 | +17.731% | Accept |
| cil | slice-buffer-write-control | 5.664649 | 6.179595 | +9.091% | Accept |
| cil | scalar-bool-WriteLine-string-control | 2.703046 | 2.987215 | +10.513% | Accept |
| cil | scalar-int-Write-string-control | 1.461728 | 1.852067 | +26.704% | Accept |
| cil | scalar-long-WriteLine-string-control | 2.327825 | 2.791067 | +19.900% | Accept |
| cil | scalar-float-WriteLine-string-control | 2.731404 | 3.836177 | +40.447% | Accept |
| cil | scalar-double-Write-string-control | 1.839528 | 2.142102 | +16.448% | Accept |
| cil | scalar-decimal-WriteLine-string-control | 2.364255 | 3.102139 | +31.210% | Accept |

P95 exceptions, including those whose median remains within budget:

| Engine | Existing case | Baseline p95 | Final p95 | Change | Decision |
| --- | --- | ---: | ---: | ---: | --- |
| source | string-control | 4.018596 | 4.311456 | +7.288% | Accept |
| source | character-control | 2.674230 | 3.746326 | +40.090% | Accept |
| source | character-line-control | 3.652297 | 4.725564 | +29.386% | Accept |
| source | whole-buffer-write-control | 7.372183 | 10.266166 | +39.255% | Accept |
| source | scalar-bool-Write-string-control | 2.228685 | 5.725454 | +156.898% | Accept |
| source | scalar-int-WriteLine-string-control | 2.404323 | 4.039005 | +67.989% | Accept |
| source | scalar-uint-WriteLine-string-control | 3.086455 | 3.298707 | +6.877% | Accept |
| source | scalar-float-Write-string-control | 3.664015 | 4.016582 | +9.622% | Accept |
| source | scalar-double-Write-string-control | 2.692326 | 2.864038 | +6.378% | Accept |
| cil | string-control | 3.113345 | 4.822227 | +54.889% | Accept |
| cil | string-line-control | 5.229915 | 7.675308 | +46.758% | Accept |
| cil | slice-buffer-write-control | 7.352494 | 9.634588 | +31.038% | Accept |
| cil | scalar-bool-WriteLine-string-control | 3.489328 | 3.890618 | +11.500% | Accept |
| cil | scalar-int-Write-string-control | 1.805583 | 2.307891 | +27.820% | Accept |
| cil | scalar-uint-WriteLine-string-control | 3.505661 | 4.980980 | +42.084% | Accept |
| cil | scalar-long-WriteLine-string-control | 3.600200 | 3.968853 | +10.240% | Accept |
| cil | scalar-double-WriteLine-string-control | 4.584977 | 5.085303 | +10.912% | Accept |
| cil | scalar-decimal-WriteLine-string-control | 3.453545 | 3.821796 | +10.663% | Accept |

Final package-size decision: Accept compressed 9,439 → 11,460 bytes (+2,021 / +21.4111664%) and unpacked 29,892 → 36,133 bytes (+6,241 / +20.8784959%); files 12 → 13. The increase is 1,879 source bytes and 4,362 documentation bytes, with no added dependencies or packed fixtures/benchmarks. All final tarball entries match the final committed contents. Final SHA256: bf9615f0da254b2d6cc58054475e4362a8d56c9a2c7ace0c0d4a6c851ced9973.

Browser decision: Accept fresh 110,064,607 → 110,073,130 bytes (+8,523 / +0.0077436337%), 5,269 → 5,270 assets. All 5,270 final asset hashes and current writer/builder leaves were verified. The sole later README change does not change browser inputs or product code.

Pre-refactor and original mixed-order reports remain separate historical cohorts; they are not pooled with the final result. The rejected pre-refactor state had 23 median exceptions and motivated the one concrete dispatch cleanup. The reduction in exception count does not itself prove a speedup.

Qualification does not resolve the failed final npm ci / protected root-lockfile blocker. No human approval, clean source installation, final-head hosted core pass, native/Wasm execution, general browser execution parity, or all-project completion is claimed.
