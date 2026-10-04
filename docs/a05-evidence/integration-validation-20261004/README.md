# Integration validation checkpoint — 2026-10-04

These are byte-for-byte logs of completed focused runs. The
[manifest](manifest.json) retains the full tested revisions and SHA-256 digests.
The cohorts overlap and must not be summed into a full-suite result. Later code
changes require their affected checks; these logs retain their original scope.

| Tested revision | Cohort | Passed | Failed | Skipped |
| --- | --- | ---: | ---: | ---: |
| `8cc82866` | Main-merge repairs and profiler reference | 146 | 0 | 0 |
| `7a088bfe` | Callback index, scalar stores/loads, prepared virtual calls | 73 | 0 | 0 |
| `b70703e4` | Native protocol, generic callbacks/type identities, tokens | 45 | 0 | 0 |
| `b70703e4` | Python browser-harness contract | 4 | 0 | 0 |
| `d9453a97` | Ref indexer, Swap/out/in, examples, generic boxing, profiler audit | 40 | 0 | 7 |
| `5909d54f` | Nested CLI generics, logical identity admission, calls, native plan | 28 | 0 | 0 |

The seven skipped cases are existing compiler reference-binding tests requiring a
.NET reference pack. The source ref-indexer case in that same file ran and passed.
The native-plan tests deliberately exercise failed/blocked synthetic case records;
those expected output lines do not claim execution by an installed CLR.

All Node cohorts used `node scripts/limited.js node --test --test-concurrency=1`
with `SHARPFORGE_MAX_PARALLEL_RUNS=1`, `SHARPFORGE_TEST_CONCURRENCY=1`, and
`SHARPFORGE_MAX_OLD_SPACE_MB=512`. The Python cohort used the same wrapper and limits
with `python -m unittest discover -s tests/fixtures/a05-browser -p test_contract.py`.

The separate [source frame-pool evidence](../source-fibonacci-2026-10-04/README.md)
retains its 122-test lifecycle/fusion run at `48c62243`. Earlier failing full-suite
and integration checkpoints remain in the acceptance audit. No new full-suite,
native SDK, actual browser, or Speedscope UI pass is implied by this checkpoint.
