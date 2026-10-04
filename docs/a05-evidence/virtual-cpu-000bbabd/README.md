# Virtual call CPU diagnostic at 000bbabd

This is CPU attribution for the unchanged `virtual-cache` fixture at clean commit
`000bbabd8ff00a4ea630523a3ad33b0428a7daf3`. It is **not** a new performance target
result. The last paired virtual-cache qualification before direct scalar stores
measured 1.7945× at `e5802c2e`, below the required 3× target. That miss is unchanged
by this diagnostic.

The recorded driver used the real qualification fixture, VM options and
`runQualificationVM` function. The reference had `inlineCaches:false`; the
candidate had `inlineCaches:true`. Four alternating warmup pairs preceded
20 profiled observations per mode. Each observation required the expected guest
result. Both modes executed 5,600,280 guest instructions across their 20 profiles.
The candidate produced 30,099 raw samples and the reference 59,465.

V8 Inspector sampled at 100 microseconds. The profiler started after reentry and
exposed host GC, and stopped after guest execution. Inspector start/stop still
introduces large boundary samples, so the guest attribution retains only samples
with `runQualificationVM` in their ancestor chain. Percentages below use that
filtered sampled time as their denominator. They describe sampled call stacks;
compiler inlining and sampling bias limit function-level precision. They are not
independent elapsed-time measurements or proof of an optimization's causal size.

| Candidate function/path | Attribution | Share of filtered guest sampled time |
|---|---|---:|
| Ordinary load/store handler | Inclusive | 37.66% |
| `storageValue` | Inclusive | 23.67% |
| Managed-address dereference | Inclusive | 21.96% |
| `executeCilStep` | Self | 14.80% |
| Virtual invocation | Inclusive | 9.33% |
| `FramePool.flush` | Self | 7.44% |
| `substituteTypeArguments` | Self | 5.25% |
| `normalizeCallType` | Self | 3.24% |

Inclusive rows overlap and must not be added. Reference virtual invocation
accounted for 49.23% of its filtered guest sampled time. The diagnostic indicates
that the prepared virtual entry removed much of the call setup cost, while
ordinary scalar stores continued to allocate addresses and normalize storage.
That finding motivated the shared guarded scalar-store change. Both cache modes
receive that change; the fixture and reference flags remain unchanged.

`summary.json` is the unmodified aggregate written by the driver.
`guest-summary.json` contains the filtered attribution. `driver.as-run.mjs` records
the exact script, including its original checkout-relative imports and output
path; it is evidence of the run, not a relocated standalone command.
`manifest.json` records command, heap cap, hashes and original profile locations.
The 40 individual `.cpuprofile` files remain in the original workspace directory;
this repository retains their hashes and both aggregates, not those raw files.
The recorded diagnostic command did not use the repository's required
`scripts/limited.js` wrapper. Its profiler shares remain diagnostic evidence;
this run does not satisfy the required wrapper provenance or qualify a target.

New performance qualification must use a clean committed integrated tree, the
machine-wide limited wrapper, and the original acceptance thresholds. Direct
scalar-store correctness passed separately at `7a088bfed` (73 focused tests), but
that does not establish the 30% scalar-slot or 3× virtual-call requirements.
