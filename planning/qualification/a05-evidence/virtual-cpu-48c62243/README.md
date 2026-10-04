# Current virtual-call CPU attribution

Eight candidate observations of the unchanged `virtual-cache` fixture at clean
`48c62243ef4cf614dfcafdb7af9a7ce360b643c4` produced 2,240,112 guest instructions
and correct output on every observation. Four warmup pairs preceded profiling.
The candidate uses the qualification harness's existing VM options; no fixture,
reference flag, or target threshold was changed. Raw profiles, the recorded driver,
log, full aggregate, guest-filtered aggregate, and file hashes are retained here.
The recorded driver imports the external qualification checkout and is evidence
of the executed script, not a standalone relocated command.

The complete command ran from `a05-numeric-qualification`:

```sh
SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 \
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/limited.js node --expose-gc \
../a05-virtual-profile-48c62243.mjs
```

The wrapper child exited 0. Profiling starts after exposed host GC and stops after
`runQualificationVM`; Inspector start/stop overhead can still enter raw profiles.
The guest aggregate therefore includes only samples with a `runQualificationVM`
ancestor: 9,624 samples and 1,704,022 sampled microseconds. These percentages
attribute profiled stacks; they are not end-to-end timing, causal speedup estimates,
or qualification results. The preceding unchanged 20-pair virtual qualification
remains a 2.153884× miss against 3×; see
[the paired reports](../slots-virtual-48c62243/README.md).

| Function | Self share | Inclusive share |
| --- | ---: | ---: |
| `executeCilStep` | 17.03% | 87.34% |
| `FramePool.flush` | 10.24% | 10.24% |
| `storeScalarSlot` | 7.12% | 8.21% |
| `runCilSlice` | 6.07% | 99.58% |
| `CilVirtualMachine.step` | 5.47% | 91.71% |
| `flushFramePool` | 1.98% | 12.22% |
| `tryPreparedVirtualCall` | 1.98% | 11.38% |
| `enterPreparedCilFrame` | 1.62% | 7.75% |
| `storageValue` | 1.06% | 8.07% |

Inclusive shares overlap and must not be summed. The current fixture has no field
access and its hot override has no parameters or locals; repeated argument/default
normalization is not its dominant cost. Unlike the earlier `000bbabd` diagnostic,
this profile follows the direct scalar-store optimization and used the required
limiter. The next candidate reuses prepared pool bindings and exact own-enumerable
cleanup for CIL calls. Any claimed gain requires a subsequent unchanged paired run.

The other SharpForge validation owners explicitly released the shared slot before
this run and no competing project job was scheduled. A process-list attempt failed
with the host utility's `fatal library error, lookup self`, so this run does not
claim independently verified host-wide idleness. Unrelated development services
were not altered. The linked qualification report retains the same host/runtime
fingerprint; no native-platform or browser result is inferred from this profile.
